import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import path from "node:path"
import { Schema } from "effect"

export namespace SupervisorChannels {
  const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/))
  const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256_000))
  export const Origin = Schema.Struct({
    channel: Schema.Literals(["x", "discord", "local"]),
    threadID: Schema.optional(Schema.String),
    author: Schema.optional(Schema.String),
    replyBudget: Schema.optional(Schema.Int),
    replyMaxChars: Schema.optional(Schema.Int),
  })
  export type Origin = typeof Origin.Type
  export const Operation = Schema.Union([
    Schema.Struct({
      type: Schema.Literal("inbox.note"),
      id: ID,
      text: Text,
      source: Schema.Literals(["operator", "relay", "voice"]),
      origin: Schema.optional(Origin),
      trusted: Schema.optional(Schema.Boolean),
    }),
    Schema.Struct({
      type: Schema.Literal("inbox.list"),
      state: Schema.optional(Schema.Literals(["pending", "notified", "delivered", "handled"])),
    }),
    Schema.Struct({ type: Schema.Literal("inbox.ack"), id: ID }),
    Schema.Struct({ type: Schema.Literal("inbox.dismiss"), id: ID }),
    Schema.Struct({
      type: Schema.Literal("inbox.dismiss.reconcile"),
      id: ID,
      outcome: Schema.Literals(["sent", "not-sent"]),
    }),
    Schema.Struct({
      type: Schema.Literal("channel.configure"),
      id: ID,
      kind: Schema.Literals(["local", "relay", "voice", "command"]),
      enabled: Schema.Boolean,
      automaticReplies: Schema.optional(Schema.Boolean),
      endpoint: Schema.optional(Schema.String),
      directory: Schema.optional(Schema.String),
      command: Schema.optional(Schema.Array(Schema.String)),
    }),
    Schema.Struct({ type: Schema.Literal("channel.list") }),
    Schema.Struct({
      type: Schema.Literal("reply.promise"),
      id: ID,
      sourceID: ID,
      text: Schema.optional(Text),
      dueAt: Schema.optional(Schema.Number),
      workID: Schema.optional(ID),
      taskID: Schema.optional(ID),
      handoffID: Schema.optional(ID),
    }),
    Schema.Struct({ type: Schema.Literal("reply.list"), sourceID: Schema.optional(ID), workID: Schema.optional(ID) }),
    Schema.Struct({ type: Schema.Literal("reply.get"), id: ID }),
    Schema.Struct({ type: Schema.Literal("reply.retire"), id: ID, reason: Text }),
    Schema.Struct({
      type: Schema.Literal("reply.rechain"),
      id: ID,
      newID: ID,
      workID: ID,
      taskID: Schema.optional(ID),
      handoffID: Schema.optional(ID),
    }),
    Schema.Struct({
      type: Schema.Literal("reply.send"),
      id: ID,
      text: Text,
      imagePath: Schema.optional(Schema.String),
    }),
    Schema.Struct({ type: Schema.Literal("reply.ack"), id: ID }),
    Schema.Struct({ type: Schema.Literal("reply.reconcile"), id: ID, outcome: Schema.Literals(["sent", "not-sent"]) }),
    Schema.Struct({ type: Schema.Literal("channel.poll") }),
    Schema.Struct({ type: Schema.Literal("channel.flush") }),
    Schema.Struct({
      type: Schema.Literal("knowledge.put"),
      id: ID,
      scope: Schema.Literals(["preferences", "shared", "fleet", "project", "task"]),
      scopeID: Schema.optional(ID),
      title: Text,
      content: Text,
      tier: Schema.optional(Schema.Literals(["pinned", "aging", "perishable"])),
      evidence: Schema.optional(Text),
      expiresAt: Schema.optional(Schema.Number),
      expiryCondition: Schema.optional(Text),
    }),
    Schema.Struct({ type: Schema.Literal("knowledge.get"), id: ID }),
    Schema.Struct({
      type: Schema.Literal("knowledge.list"),
      scope: Schema.optional(Schema.Literals(["preferences", "shared", "fleet", "project", "task"])),
      scopeID: Schema.optional(ID),
    }),
  ])
  export type Operation = typeof Operation.Type

  export type Note = {
    id: string
    text: string
    source: "operator" | "relay" | "voice"
    origin?: Origin
    trusted: boolean
    state: "pending" | "notified" | "delivered" | "handled"
    dismissal?: { state: "attempting" | "unknown" | "rejected" | "dismissed"; receipt?: Schema.Json }
    createdAt: number
    updatedAt: number
  }
  export type Channel = {
    id: string
    kind: "local" | "relay" | "voice" | "command"
    enabled: boolean
    automaticReplies: boolean
    endpoint?: string
    directory?: string
    command?: string[]
    createdAt: number
    updatedAt: number
  }
  export type Reply = {
    id: string
    sourceID: string
    origin: Origin
    text?: string
    image?: { mediaType: string; bytes: number; sha256: string }
    mode: "answer" | "followup"
    dueAt?: number
    workID?: string
    taskID?: string
    handoffID?: string
    terminal?: { outcome: "succeeded" | "failed" | "cancelled"; at: number; notified: boolean }
    retired?: { at: number; reason: string }
    rechainTo?: string
    state: "promised" | "ready" | "attempting" | "unknown" | "rejected" | "sent" | "acked"
    readyAt?: number
    sentAt?: number
    receipt?: Schema.Json
    createdAt: number
    updatedAt: number
  }
  export type Away = { enabled: boolean; until?: number; note?: string; updatedAt?: number }
  export type Knowledge = {
    id: string
    scope: "preferences" | "shared" | "fleet" | "project" | "task"
    scopeID?: string
    title: string
    content: string
    tier: "pinned" | "aging" | "perishable"
    evidence?: string
    reinforcedAt: number
    expiresAt?: number
    expiryCondition?: string
    sourceHome?: string
    sourceID?: string
    sourceVersion?: number
    createdAt: number
    updatedAt: number
  }
  export type KnowledgeArchive = Knowledge & { source: string; archivedAt: number; reason: string }
  export type StowChange =
    | {
        action: "upsert"
        id: string
        scope: Knowledge["scope"]
        scopeID?: string
        title: string
        content: string
        tier?: Knowledge["tier"]
        evidence: string
        expiresAt?: number
        expiryCondition?: string
      }
    | { action: "reinforce"; id: string; evidence: string }
    | { action: "archive"; id: string; evidence: string; reason: string }

  export type NoteRow = {
    id: string
    source: Note["source"]
    text: string
    origin: string | null
    trusted: number
    state: Note["state"]
    dismiss_state: "none" | "attempting" | "unknown" | "rejected" | "dismissed"
    dismiss_receipt: string | null
    intake: string
    created_at: number
    updated_at: number
  }
  export type ChannelRow = {
    id: string
    kind: Channel["kind"]
    enabled: number
    automatic_replies: number
    endpoint: string | null
    directory: string | null
    command: string | null
    created_at: number
    updated_at: number
  }
  export type ReplyRow = {
    id: string
    source_id: string
    origin: string
    text: string | null
    image_media_type: string | null
    image_base64: string | null
    image_sha256: string | null
    mode: Reply["mode"]
    due_at: number | null
    work_id: string | null
    task_id: string | null
    handoff_id: string | null
    terminal_outcome: "succeeded" | "failed" | "cancelled" | null
    terminal_at: number | null
    terminal_notified: number
    retired_at: number | null
    retire_reason: string | null
    rechain_to: string | null
    state: Reply["state"]
    ready_at: number | null
    sent_at: number | null
    receipt: string | null
    intake: string
    created_at: number
    updated_at: number
  }
  export type KnowledgeRow = {
    id: string
    scope: Knowledge["scope"]
    scope_id: string | null
    title: string
    content: string
    tier: Knowledge["tier"]
    evidence: string | null
    reinforced_at: number
    expires_at: number | null
    expiry_condition: string | null
    source_home: string | null
    source_id: string | null
    source_version: number | null
    created_at: number
    updated_at: number
  }

  /** Shares the workflow writer's SQLite connection and lifetime. */
  export function open(db: DatabaseSync, home = "local") {
    db.exec(`
      CREATE TABLE IF NOT EXISTS supervisor_channel_inbox (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('operator', 'relay', 'voice')),
        text TEXT NOT NULL,
        origin TEXT,
        trusted INTEGER NOT NULL CHECK (trusted IN (0, 1)),
        state TEXT NOT NULL CHECK (state IN ('pending', 'notified', 'delivered', 'handled')),
        dismiss_state TEXT NOT NULL DEFAULT 'none' CHECK (dismiss_state IN ('none', 'attempting', 'unknown', 'rejected', 'dismissed')),
        dismiss_receipt TEXT,
        intake TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supervisor_channel_config (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('local', 'relay', 'voice', 'command')),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        automatic_replies INTEGER NOT NULL DEFAULT 0 CHECK (automatic_replies IN (0, 1)),
        endpoint TEXT,
        directory TEXT,
        command TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supervisor_channel_reply (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES supervisor_channel_inbox(id),
        origin TEXT NOT NULL,
        text TEXT,
        image_media_type TEXT,
        image_base64 TEXT,
        image_sha256 TEXT,
        mode TEXT NOT NULL CHECK (mode IN ('answer', 'followup')),
        due_at INTEGER,
        work_id TEXT,
        task_id TEXT,
        handoff_id TEXT,
        terminal_outcome TEXT CHECK (terminal_outcome IN ('succeeded', 'failed', 'cancelled')),
        terminal_at INTEGER,
        terminal_notified INTEGER NOT NULL DEFAULT 0 CHECK (terminal_notified IN (0, 1)),
        retired_at INTEGER,
        retire_reason TEXT,
        rechain_to TEXT,
        state TEXT NOT NULL CHECK (state IN ('promised', 'ready', 'attempting', 'unknown', 'rejected', 'sent', 'acked')),
        ready_at INTEGER,
        sent_at INTEGER,
        receipt TEXT,
        intake TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS supervisor_channel_reply_ready ON supervisor_channel_reply(state, due_at, ready_at);
      CREATE TABLE IF NOT EXISTS supervisor_channel_away (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        until_at INTEGER,
        note TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supervisor_channel_knowledge (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('preferences', 'shared', 'fleet', 'project', 'task')),
        scope_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'aging' CHECK (tier IN ('pinned', 'aging', 'perishable')),
        evidence TEXT,
        reinforced_at INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        expiry_condition TEXT,
        source_home TEXT,
        source_id TEXT,
        source_version INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supervisor_knowledge_archive (
        archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tier TEXT NOT NULL,
        evidence TEXT,
        reinforced_at INTEGER NOT NULL,
        expires_at INTEGER,
        expiry_condition TEXT,
        source_home TEXT,
        source_id TEXT,
        source_version INTEGER,
        source TEXT NOT NULL DEFAULT 'local',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS supervisor_knowledge_archive_lookup ON supervisor_knowledge_archive(id, archived_at);
      CREATE TABLE IF NOT EXISTS supervisor_knowledge_shared (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        source_home TEXT,
        source_id TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        synced_at INTEGER
      );
      INSERT OR IGNORE INTO supervisor_knowledge_shared (id, source_home, version, synced_at) VALUES (1, NULL, 0, NULL);
      CREATE TABLE IF NOT EXISTS supervisor_knowledge_home (id INTEGER PRIMARY KEY CHECK (id = 1), uuid TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supervisor_knowledge_budget (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tokens INTEGER NOT NULL CHECK (tokens > 0),
        updated_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO supervisor_knowledge_budget (id, tokens, updated_at) VALUES (1, 7500, 0);
    `)
    db.prepare("INSERT OR IGNORE INTO supervisor_knowledge_home (id, uuid) VALUES (1, ?)").run(crypto.randomUUID())
    const knowledgeSchema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'supervisor_channel_knowledge'")
      .get() as { sql: string }
    if (!knowledgeSchema.sql.includes("'shared'"))
      db.exec(`
        SAVEPOINT supervisor_knowledge_schema;
        CREATE TABLE supervisor_channel_knowledge_next (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL CHECK (scope IN ('preferences', 'shared', 'fleet', 'project', 'task')),
          scope_id TEXT,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          tier TEXT NOT NULL DEFAULT 'aging' CHECK (tier IN ('pinned', 'aging', 'perishable')),
          evidence TEXT,
          reinforced_at INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          expiry_condition TEXT,
          source_home TEXT,
          source_id TEXT,
          source_version INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO supervisor_channel_knowledge_next
          (id, scope, scope_id, title, content, tier, reinforced_at, created_at, updated_at)
        SELECT id, scope, scope_id, title, content,
          CASE WHEN scope = 'preferences' THEN 'pinned' ELSE 'aging' END,
          updated_at, created_at, updated_at FROM supervisor_channel_knowledge;
        DROP TABLE supervisor_channel_knowledge;
        ALTER TABLE supervisor_channel_knowledge_next RENAME TO supervisor_channel_knowledge;
        RELEASE supervisor_knowledge_schema;
      `)
    const knowledgeColumns = db.prepare("PRAGMA table_info(supervisor_channel_knowledge)").all() as { name: string }[]
    if (!knowledgeColumns.some((column) => column.name === "tier"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN tier TEXT NOT NULL DEFAULT 'aging'")
    if (!knowledgeColumns.some((column) => column.name === "evidence"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN evidence TEXT")
    if (!knowledgeColumns.some((column) => column.name === "reinforced_at"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN reinforced_at INTEGER NOT NULL DEFAULT 0")
    if (!knowledgeColumns.some((column) => column.name === "expires_at"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN expires_at INTEGER")
    if (!knowledgeColumns.some((column) => column.name === "expiry_condition"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN expiry_condition TEXT")
    if (!knowledgeColumns.some((column) => column.name === "source_home"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN source_home TEXT")
    if (!knowledgeColumns.some((column) => column.name === "source_id"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN source_id TEXT")
    if (!knowledgeColumns.some((column) => column.name === "source_version"))
      db.exec("ALTER TABLE supervisor_channel_knowledge ADD COLUMN source_version INTEGER")
    const archiveColumns = db.prepare("PRAGMA table_info(supervisor_knowledge_archive)").all() as { name: string }[]
    if (!archiveColumns.some((column) => column.name === "source"))
      db.exec("ALTER TABLE supervisor_knowledge_archive ADD COLUMN source TEXT NOT NULL DEFAULT 'local'")
    if (!archiveColumns.some((column) => column.name === "source_id"))
      db.exec("ALTER TABLE supervisor_knowledge_archive ADD COLUMN source_id TEXT")
    const sharedColumns = db.prepare("PRAGMA table_info(supervisor_knowledge_shared)").all() as { name: string }[]
    if (!sharedColumns.some((column) => column.name === "source_id"))
      db.exec("ALTER TABLE supervisor_knowledge_shared ADD COLUMN source_id TEXT")
    db.exec("UPDATE supervisor_channel_knowledge SET reinforced_at = updated_at WHERE reinforced_at = 0")
    db.exec(
      "UPDATE supervisor_channel_knowledge SET tier = 'pinned' WHERE scope = 'preferences' AND tier = 'aging' AND evidence IS NULL",
    )
    // The first pilot reply table allowed only one answer per inbox source.
    // Rebuild it once so completion follow-ups can share the original request.
    const replyColumns = db.prepare("PRAGMA table_info(supervisor_channel_reply)").all() as { name: string }[]
    const inboxColumns = db.prepare("PRAGMA table_info(supervisor_channel_inbox)").all() as { name: string }[]
    if (!inboxColumns.some((column) => column.name === "dismiss_state"))
      db.exec("ALTER TABLE supervisor_channel_inbox ADD COLUMN dismiss_state TEXT NOT NULL DEFAULT 'none'")
    if (!inboxColumns.some((column) => column.name === "dismiss_receipt"))
      db.exec("ALTER TABLE supervisor_channel_inbox ADD COLUMN dismiss_receipt TEXT")
    const configColumns = db.prepare("PRAGMA table_info(supervisor_channel_config)").all() as { name: string }[]
    if (!configColumns.some((column) => column.name === "directory"))
      db.exec("ALTER TABLE supervisor_channel_config ADD COLUMN directory TEXT")
    if (!configColumns.some((column) => column.name === "automatic_replies"))
      db.exec("ALTER TABLE supervisor_channel_config ADD COLUMN automatic_replies INTEGER NOT NULL DEFAULT 0")
    if (!replyColumns.some((column) => column.name === "mode"))
      db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE supervisor_channel_reply_next (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES supervisor_channel_inbox(id),
          origin TEXT NOT NULL,
          text TEXT,
          mode TEXT NOT NULL CHECK (mode IN ('answer', 'followup')),
          due_at INTEGER,
          state TEXT NOT NULL CHECK (state IN ('promised', 'ready', 'attempting', 'unknown', 'rejected', 'sent', 'acked')),
          ready_at INTEGER,
          sent_at INTEGER,
          receipt TEXT,
          intake TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO supervisor_channel_reply_next
          (id, source_id, origin, text, mode, due_at, state, ready_at, sent_at, receipt, intake, created_at, updated_at)
          SELECT id, source_id, origin, text, 'answer', due_at, state, ready_at, sent_at, receipt, intake, created_at, updated_at
          FROM supervisor_channel_reply;
        DROP TABLE supervisor_channel_reply;
        ALTER TABLE supervisor_channel_reply_next RENAME TO supervisor_channel_reply;
        CREATE INDEX supervisor_channel_reply_ready ON supervisor_channel_reply(state, due_at, ready_at);
        COMMIT;
      `)
    const currentReplyColumns = db.prepare("PRAGMA table_info(supervisor_channel_reply)").all() as { name: string }[]
    if (!currentReplyColumns.some((column) => column.name === "work_id"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN work_id TEXT")
    if (!currentReplyColumns.some((column) => column.name === "task_id"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN task_id TEXT")
    if (!currentReplyColumns.some((column) => column.name === "handoff_id"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN handoff_id TEXT")
    if (!currentReplyColumns.some((column) => column.name === "terminal_outcome"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN terminal_outcome TEXT")
    if (!currentReplyColumns.some((column) => column.name === "terminal_at"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN terminal_at INTEGER")
    if (!currentReplyColumns.some((column) => column.name === "terminal_notified"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN terminal_notified INTEGER NOT NULL DEFAULT 0")
    if (!currentReplyColumns.some((column) => column.name === "retired_at"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN retired_at INTEGER")
    if (!currentReplyColumns.some((column) => column.name === "retire_reason"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN retire_reason TEXT")
    if (!currentReplyColumns.some((column) => column.name === "rechain_to"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN rechain_to TEXT")
    if (!currentReplyColumns.some((column) => column.name === "image_media_type"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN image_media_type TEXT")
    if (!currentReplyColumns.some((column) => column.name === "image_base64"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN image_base64 TEXT")
    if (!currentReplyColumns.some((column) => column.name === "image_sha256"))
      db.exec("ALTER TABLE supervisor_channel_reply ADD COLUMN image_sha256 TEXT")

    function note(input: {
      id: string
      text: string
      source: Note["source"]
      origin?: Origin
      trusted?: boolean
    }): Note {
      validateID(input.id)
      validateText(input.text)
      if (!["operator", "relay", "voice"].includes(input.source)) throw new Error("Invalid inbox source")
      if (input.origin) validateOrigin(input.origin)
      const intake = {
        id: input.id,
        text: input.text,
        source: input.source,
        origin: input.origin,
        trusted: input.trusted ?? false,
      }
      const existing = db.prepare("SELECT intake FROM supervisor_channel_inbox WHERE id = ?").get(input.id) as
        | { intake: string }
        | undefined
      if (existing) {
        if (same(JSON.parse(existing.intake), intake)) return getNote(input.id)!
        throw new Error(`Conflicting inbox note ID: ${input.id}`)
      }
      const now = Date.now()
      db.prepare(
        `INSERT INTO supervisor_channel_inbox
        (id, source, text, origin, trusted, state, intake, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).run(
        input.id,
        input.source,
        input.text,
        input.origin ? JSON.stringify(input.origin) : null,
        Number(intake.trusted),
        JSON.stringify(intake),
        now,
        now,
      )
      return getNote(input.id)!
    }

    function getNote(id: string): Note | undefined {
      const row = db.prepare("SELECT * FROM supervisor_channel_inbox WHERE id = ?").get(id) as NoteRow | undefined
      return row ? noteFromRow(row) : undefined
    }

    function listNotes(options?: { state?: Note["state"] }): Note[] {
      return (
        db
          .prepare("SELECT * FROM supervisor_channel_inbox WHERE (? IS NULL OR state = ?) ORDER BY created_at, id")
          .all(options?.state ?? null, options?.state ?? null) as NoteRow[]
      ).map(noteFromRow)
    }

    function pendingNotes(): Note[] {
      return listNotes({ state: "pending" })
    }

    function advanceNote(id: string, state: Note["state"]): Note {
      const current = getNote(id)
      if (!current) throw new Error(`Unknown inbox note: ${id}`)
      const order = ["pending", "notified", "delivered", "handled"]
      if (order.indexOf(current.state) >= order.indexOf(state)) return current
      db.prepare("UPDATE supervisor_channel_inbox SET state = ?, updated_at = ? WHERE id = ?").run(
        state,
        Date.now(),
        id,
      )
      return getNote(id)!
    }

    function markDismissAttempting(id: string): Note {
      const current = getNote(id)
      if (!current || current.source !== "relay" || !current.origin?.threadID || current.origin.channel === "local")
        throw new Error(`Dismiss requires an original Relay request: ${id}`)
      if (current.dismissal) throw new Error(`Dismiss outcome requires reconciliation: ${id}`)
      if (listReplies({ sourceID: id }).length) throw new Error(`A reply already owns the Relay request: ${id}`)
      db.prepare("UPDATE supervisor_channel_inbox SET dismiss_state = 'attempting', updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      )
      return getNote(id)!
    }

    function markDismissUnknown(id: string): Note {
      const current = getNote(id)
      if (current?.dismissal?.state !== "attempting") throw new Error(`Dismiss was not attempted: ${id}`)
      db.prepare("UPDATE supervisor_channel_inbox SET dismiss_state = 'unknown', updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      )
      return getNote(id)!
    }

    function markDismissRejected(id: string, reason: string): Note {
      const current = getNote(id)
      if (current?.dismissal?.state !== "attempting") throw new Error(`Dismiss was not attempted: ${id}`)
      db.prepare(
        "UPDATE supervisor_channel_inbox SET dismiss_state = 'rejected', dismiss_receipt = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify({ error: reason }), Date.now(), id)
      return getNote(id)!
    }

    function markDismissed(id: string, receipt: Schema.Json): Note {
      const current = getNote(id)
      if (current?.dismissal?.state === "dismissed") return current
      if (!current || !["attempting", "unknown"].includes(current.dismissal?.state ?? ""))
        throw new Error(`Dismiss was not attempted: ${id}`)
      db.prepare(
        "UPDATE supervisor_channel_inbox SET dismiss_state = 'dismissed', dismiss_receipt = ?, state = 'handled', updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(receipt), Date.now(), id)
      return getNote(id)!
    }

    function reconcileDismiss(id: string, outcome: "sent" | "not-sent"): Note {
      const current = getNote(id)
      if (!current || !["attempting", "unknown", "rejected"].includes(current.dismissal?.state ?? ""))
        throw new Error(`Dismiss has no uncertain send: ${id}`)
      if (outcome === "sent") {
        if (current.dismissal?.state === "rejected") throw new Error("A rejected dismiss cannot be reconciled as sent")
        return markDismissed(id, { operatorReconciled: true })
      }
      db.prepare(
        "UPDATE supervisor_channel_inbox SET dismiss_state = 'none', dismiss_receipt = NULL, updated_at = ? WHERE id = ?",
      ).run(Date.now(), id)
      return getNote(id)!
    }

    function configure(input: {
      id: string
      kind: Channel["kind"]
      enabled: boolean
      automaticReplies?: boolean
      endpoint?: string
      directory?: string
      command?: string[]
    }): Channel {
      validateID(input.id)
      if (!["local", "relay", "voice", "command"].includes(input.kind) || typeof input.enabled !== "boolean")
        throw new Error("Invalid channel configuration")
      if (input.endpoint) {
        const endpoint = new URL(input.endpoint)
        if (
          !["http:", "https:"].includes(endpoint.protocol) ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash
        )
          throw new Error("Channel endpoint must not contain credentials or query parameters")
      }
      if (input.kind === "relay" && !input.endpoint) throw new Error("Relay channel requires an endpoint")
      if (input.kind === "voice" && (!input.directory || !path.isAbsolute(input.directory)))
        throw new Error("Voice channel requires an absolute inbox directory")
      if (input.directory && input.kind !== "voice") throw new Error("Only voice channels accept an inbox directory")
      if (
        input.kind === "command" &&
        (!input.command?.length || input.command.some((part) => !part || part.includes("\0")))
      )
        throw new Error("Command channel requires a fixed argv")
      if (input.command && input.kind !== "command") throw new Error("Only command channels accept argv")
      const now = Date.now()
      db.prepare(
        `INSERT INTO supervisor_channel_config
        (id, kind, enabled, automatic_replies, endpoint, directory, command, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, enabled = excluded.enabled,
        automatic_replies = excluded.automatic_replies, endpoint = excluded.endpoint, directory = excluded.directory, command = excluded.command, updated_at = excluded.updated_at`,
      ).run(
        input.id,
        input.kind,
        Number(input.enabled),
        Number(input.automaticReplies ?? false),
        input.endpoint ?? null,
        input.directory ?? null,
        input.command ? JSON.stringify(input.command) : null,
        now,
        now,
      )
      return getChannel(input.id)!
    }

    function getChannel(id: string): Channel | undefined {
      const row = db.prepare("SELECT * FROM supervisor_channel_config WHERE id = ?").get(id) as ChannelRow | undefined
      return row ? channelFromRow(row) : undefined
    }

    function listChannels(): Channel[] {
      return (db.prepare("SELECT * FROM supervisor_channel_config ORDER BY id").all() as ChannelRow[]).map(
        channelFromRow,
      )
    }

    function promise(input: {
      id: string
      sourceID: string
      text?: string
      dueAt?: number
      workID?: string
      taskID?: string
      handoffID?: string
    }): Reply {
      validateID(input.id)
      validateID(input.sourceID)
      if (input.workID) validateID(input.workID)
      if (input.taskID) validateID(input.taskID)
      if (input.handoffID) validateID(input.handoffID)
      if (
        (input.workID || input.taskID || input.handoffID) &&
        (!input.workID || Boolean(input.taskID) === Boolean(input.handoffID))
      )
        throw new Error("A work-bound reply requires a work ID and exactly one task or handoff ID")
      if (input.text !== undefined) validateText(input.text)
      validateTime(input.dueAt)
      const source = getNote(input.sourceID)
      if (!source?.origin) throw new Error("Reply requires an inbox note with an explicit origin")
      if (source.dismissal) throw new Error("Dismissed or uncertain Relay requests cannot receive a reply")
      const intake = {
        id: input.id,
        sourceID: input.sourceID,
        text: input.text,
        dueAt: input.dueAt,
        workID: input.workID,
        taskID: input.taskID,
        handoffID: input.handoffID,
      }
      const existing = getReply(input.id)
      if (existing) {
        const row = db.prepare("SELECT intake FROM supervisor_channel_reply WHERE id = ?").get(input.id) as {
          intake: string
        }
        if (same(JSON.parse(row.intake), intake)) return existing
        throw new Error(`Conflicting reply ID: ${input.id}`)
      }
      if (input.workID) {
        const channel = getChannel(source.origin.channel)
        if (
          !channel?.enabled ||
          channel.kind !== "relay" ||
          source.origin.channel === "local" ||
          !source.origin.threadID
        )
          throw new Error("Bound final reply requires an enabled Relay channel and original public thread")
      }
      const prior = listReplies({ sourceID: input.sourceID })
      if (prior.at(-1)?.retired) throw new Error("A retired public loop cannot be reopened")
      if (prior.some((reply) => !["sent", "acked"].includes(reply.state)))
        throw new Error(`Inbox source already has a promised reply: ${input.sourceID}`)
      if (prior.length && prior[0]?.mode !== "answer") throw new Error("Source has no initial answer")
      const mode = prior.length ? "followup" : "answer"
      const now = Date.now()
      db.prepare(
        `INSERT INTO supervisor_channel_reply
        (id, source_id, origin, text, mode, due_at, work_id, task_id, handoff_id, state, intake, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'promised', ?, ?, ?)`,
      ).run(
        input.id,
        input.sourceID,
        JSON.stringify(source.origin),
        input.text ?? null,
        mode,
        input.dueAt ?? null,
        input.workID ?? null,
        input.taskID ?? null,
        input.handoffID ?? null,
        JSON.stringify(intake),
        now,
        now,
      )
      return getReply(input.id)!
    }

    function getReply(id: string): Reply | undefined {
      const row = db.prepare("SELECT * FROM supervisor_channel_reply WHERE id = ?").get(id) as ReplyRow | undefined
      return row ? replyFromRow(row) : undefined
    }

    function listReplies(options?: { sourceID?: string; state?: Reply["state"] }): Reply[] {
      return (
        db
          .prepare(
            `SELECT * FROM supervisor_channel_reply WHERE (? IS NULL OR source_id = ?)
        AND (? IS NULL OR state = ?) ORDER BY created_at, id`,
          )
          .all(
            options?.sourceID ?? null,
            options?.sourceID ?? null,
            options?.state ?? null,
            options?.state ?? null,
          ) as ReplyRow[]
      ).map(replyFromRow)
    }

    function send(id: string, text: string, options?: { now?: number; imagePath?: string }): Reply {
      validateText(text)
      const image = options?.imagePath ? readImage(options.imagePath) : undefined
      const current = requireReply(id)
      if (current.state !== "promised") {
        if (current.text === text && current.image?.sha256 === image?.sha256) return current
        throw new Error(`Reply already has different final text: ${id}`)
      }
      if (current.workID && !current.terminal) throw new Error("Bound work has no terminal result")
      const channel = getChannel(current.origin.channel)
      if (!channel?.enabled) throw new Error(`No enabled reply channel for ${current.origin.channel}`)
      if (current.origin.channel === "local") throw new Error("Local channel has no outbound reply transport")
      if (
        (current.origin.channel === "x" || current.origin.channel === "discord") &&
        (channel.kind !== "relay" || !current.origin.threadID)
      )
        throw new Error("Public reply requires a relay channel and original thread")
      const now = options?.now ?? Date.now()
      if (current.mode === "followup") {
        const answer = listReplies({ sourceID: current.sourceID }).find((reply) => reply.mode === "answer")
        if (!answer?.sentAt || now >= answer.sentAt + 7 * 24 * 60 * 60 * 1000)
          throw new Error("Public follow-up window has expired")
        const budget = Math.min(3, current.origin.replyBudget ?? 3)
        const recent = listReplies().filter(
          (reply) =>
            reply.mode === "followup" &&
            reply.origin.channel === current.origin.channel &&
            reply.origin.threadID === current.origin.threadID &&
            reply.readyAt !== undefined &&
            reply.readyAt >= now - 7 * 24 * 60 * 60 * 1000,
        )
        if (recent.length >= budget) throw new Error("Public reply limit reached for this thread (3 per 7 days)")
      }
      db.prepare(
        `UPDATE supervisor_channel_reply SET text = ?, image_media_type = ?, image_base64 = ?, image_sha256 = ?, state = 'ready', ready_at = ?, updated_at = ?
        WHERE id = ?`,
      ).run(text, image?.mediaType ?? null, image?.dataBase64 ?? null, image?.sha256 ?? null, now, now, id)
      return getReply(id)!
    }

    function image(id: string) {
      const row = db
        .prepare("SELECT image_media_type, image_base64 FROM supervisor_channel_reply WHERE id = ?")
        .get(id) as { image_media_type: string | null; image_base64: string | null } | undefined
      if (!row?.image_media_type || !row.image_base64) return undefined
      return { media_type: row.image_media_type, data_base64: row.image_base64 }
    }

    function readyReplies(options?: { now?: number }): Reply[] {
      const now = options?.now ?? Date.now()
      return listReplies({ state: "ready" }).filter((reply) => reply.dueAt === undefined || reply.dueAt <= now)
    }

    function markAttempting(id: string): Reply {
      const current = requireReply(id)
      if (current.state !== "ready") throw new Error(`Reply is not ready: ${id}`)
      db.prepare("UPDATE supervisor_channel_reply SET state = 'attempting', updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      )
      return getReply(id)!
    }

    function markUnknown(id: string): Reply {
      const current = requireReply(id)
      if (current.state === "unknown") return current
      if (current.state !== "attempting") throw new Error(`Reply has not been attempted: ${id}`)
      db.prepare("UPDATE supervisor_channel_reply SET state = 'unknown', updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      )
      return getReply(id)!
    }

    function markRejected(id: string, reason: string): Reply {
      const current = requireReply(id)
      if (current.state !== "attempting") throw new Error(`Reply has not been attempted: ${id}`)
      db.prepare(
        "UPDATE supervisor_channel_reply SET state = 'rejected', receipt = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify({ error: reason }), Date.now(), id)
      return getReply(id)!
    }

    function markSent(id: string, receipt: Schema.Json): Reply {
      const current = requireReply(id)
      if (current.state === "sent" || current.state === "acked") {
        if (same(current.receipt, receipt)) return current
        throw new Error(`Conflicting outbound receipt: ${id}`)
      }
      if (current.state !== "attempting" && current.state !== "unknown")
        throw new Error(`Reply was not attempted: ${id}`)
      const now = Date.now()
      db.prepare(
        `UPDATE supervisor_channel_reply SET state = 'sent', sent_at = ?, receipt = ?, updated_at = ?
        WHERE id = ?`,
      ).run(now, JSON.stringify(receipt), now, id)
      return getReply(id)!
    }

    function ackReply(id: string): Reply {
      const current = requireReply(id)
      if (current.state === "acked") return current
      if (current.state !== "sent") throw new Error(`Reply has no sent receipt: ${id}`)
      db.prepare("UPDATE supervisor_channel_reply SET state = 'acked', updated_at = ? WHERE id = ?").run(Date.now(), id)
      return getReply(id)!
    }

    function reconcileReply(id: string, outcome: "sent" | "not-sent"): Reply {
      const current = requireReply(id)
      if (current.state !== "unknown" && current.state !== "attempting" && current.state !== "rejected")
        throw new Error(`Reply has no uncertain send: ${id}`)
      if (current.state === "rejected" && outcome === "sent")
        throw new Error("A rejected reply cannot be reconciled as sent")
      if (outcome === "sent") return markSent(id, { operatorReconciled: true })
      db.prepare("UPDATE supervisor_channel_reply SET state = 'ready', updated_at = ? WHERE id = ?").run(Date.now(), id)
      return getReply(id)!
    }

    function outstandingReplies(sourceID?: string): Reply[] {
      return listReplies({ sourceID }).filter((reply) => !reply.retired)
    }

    function retireReply(id: string, reason: string): Reply {
      validateID(id)
      validateText(reason)
      const current = requireReply(id)
      if (current.retired) {
        if (current.retired.reason === reason.trim()) return current
        throw new Error(`Reply already retired with a different reason: ${id}`)
      }
      if (!["sent", "acked"].includes(current.state))
        throw new Error(`Reply is still owed and cannot be retired: ${id}`)
      db.prepare(
        "UPDATE supervisor_channel_reply SET retired_at = ?, retire_reason = ?, updated_at = ? WHERE id = ?",
      ).run(Date.now(), reason.trim(), Date.now(), id)
      return getReply(id)!
    }

    function rechainReply(input: {
      id: string
      newID: string
      workID: string
      taskID?: string
      handoffID?: string
    }): Reply {
      validateID(input.id)
      validateID(input.newID)
      if (input.id === input.newID) throw new Error("A public loop cannot rechain to itself")
      db.exec("SAVEPOINT supervisor_channel_rechain")
      try {
        const source = requireReply(input.id)
        if (!["sent", "acked"].includes(source.state)) throw new Error("Only a delivered reply can be rechained")
        if (source.rechainTo && source.rechainTo !== input.newID)
          throw new Error(`Reply is already rechained to ${source.rechainTo}`)
        if (source.retired && !source.rechainTo) throw new Error("A retired public loop cannot be rechained")
        const next = promise({
          id: input.newID,
          sourceID: source.sourceID,
          workID: input.workID,
          taskID: input.taskID,
          handoffID: input.handoffID,
        })
        if (next.mode !== "followup") throw new Error("Rechain did not create a follow-up")
        db.prepare("UPDATE supervisor_channel_reply SET rechain_to = ?, updated_at = ? WHERE id = ?").run(
          input.newID,
          Date.now(),
          input.id,
        )
        db.exec("RELEASE supervisor_channel_rechain")
        return next
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_channel_rechain")
        db.exec("RELEASE supervisor_channel_rechain")
        throw error
      }
    }

    function recordTerminal(input: {
      workID: string
      taskID?: string
      handoffID?: string
      outcome: "succeeded" | "failed" | "cancelled"
    }): Reply[] {
      validateID(input.workID)
      if (Boolean(input.taskID) === Boolean(input.handoffID))
        throw new Error("Terminal result requires exactly one task or handoff ID")
      if (input.taskID) validateID(input.taskID)
      if (input.handoffID) validateID(input.handoffID)
      const bound = listReplies().filter(
        (reply) =>
          reply.workID === input.workID && reply.taskID === input.taskID && reply.handoffID === input.handoffID,
      )
      if (bound.some((reply) => reply.terminal && reply.terminal.outcome !== input.outcome))
        throw new Error(`Conflicting terminal result for work ${input.workID}`)
      const now = Date.now()
      bound
        .filter((reply) => !reply.terminal)
        .forEach((reply) =>
          db
            .prepare(
              `UPDATE supervisor_channel_reply SET terminal_outcome = ?, terminal_at = ?, updated_at = ?
          WHERE id = ? AND terminal_outcome IS NULL`,
            )
            .run(input.outcome, now, now, reply.id),
        )
      return bound.map((reply) => getReply(reply.id)!)
    }

    function terminalObligations() {
      return listReplies().filter(
        (reply) => reply.terminal && !reply.terminal.notified && !["sent", "acked"].includes(reply.state),
      )
    }

    function markTerminalNotified(id: string): Reply {
      const reply = requireReply(id)
      if (!reply.terminal) throw new Error(`Reply has no terminal result: ${id}`)
      if (reply.terminal.notified) return reply
      db.prepare("UPDATE supervisor_channel_reply SET terminal_notified = 1, updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      )
      return getReply(id)!
    }

    function owedByWork(input: { workID: string; taskID?: string; handoffID?: string }) {
      return listReplies().filter(
        (reply) =>
          reply.workID === input.workID &&
          reply.taskID === input.taskID &&
          reply.handoffID === input.handoffID &&
          !["sent", "acked"].includes(reply.state),
      )
    }

    function setAway(input: { enabled: boolean; until?: number; note?: string }): Away {
      if (typeof input.enabled !== "boolean") throw new Error("Away enabled must be a boolean")
      validateTime(input.until)
      const now = Date.now()
      db.prepare(
        `INSERT INTO supervisor_channel_away (id, enabled, until_at, note, updated_at)
        VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled,
        until_at = excluded.until_at, note = excluded.note, updated_at = excluded.updated_at`,
      ).run(Number(input.enabled), input.until ?? null, input.note ?? null, now)
      return getAway()
    }

    function getAway(): Away {
      const row = db
        .prepare("SELECT enabled, until_at, note, updated_at FROM supervisor_channel_away WHERE id = 1")
        .get() as { enabled: number; until_at: number | null; note: string | null; updated_at: number } | undefined
      return row
        ? {
            enabled: Boolean(row.enabled),
            until: row.until_at ?? undefined,
            note: row.note ?? undefined,
            updatedAt: row.updated_at,
          }
        : { enabled: false }
    }

    function isAway(options?: { now?: number }): boolean {
      const current = getAway()
      return current.enabled && (current.until === undefined || current.until > (options?.now ?? Date.now()))
    }

    function putKnowledge(input: {
      id: string
      scope: Knowledge["scope"]
      scopeID?: string
      title: string
      content: string
      tier?: Knowledge["tier"]
      evidence?: string
      expiresAt?: number
      expiryCondition?: string
      now?: number
    }): Knowledge {
      validateID(input.id)
      validateText(input.title)
      validateText(input.content)
      if (input.evidence !== undefined) validateText(input.evidence)
      if (input.expiryCondition !== undefined) validateText(input.expiryCondition)
      validateTime(input.expiresAt)
      if (Buffer.byteLength(input.content, "utf8") > 256 * 1024) throw new Error("Knowledge content exceeds 256 KiB")
      if ((input.scope === "project" || input.scope === "task") !== Boolean(input.scopeID))
        throw new Error("Project and task knowledge require a scope ID; startup scopes do not")
      if (input.scopeID) validateID(input.scopeID)
      const existing = getKnowledge(input.id)
      if (existing && (existing.scope !== input.scope || existing.scopeID !== input.scopeID))
        throw new Error(`Knowledge ownership cannot change: ${input.id}`)
      if (existing?.sourceHome) throw new Error(`Primary-owned shared knowledge is read-only: ${input.id}`)
      if (input.scope === "shared" && sharedStatus().sourceHome)
        throw new Error("This delegate's shared knowledge is primary-owned and read-only")
      const tier =
        input.tier ?? existing?.tier ?? (input.scope === "preferences" || input.scope === "shared" ? "pinned" : "aging")
      if (
        tier === "perishable" &&
        input.expiresAt === undefined &&
        !input.expiryCondition &&
        !existing?.expiryCondition
      )
        throw new Error("Perishable knowledge requires a checkable expiry condition or timestamp")
      const now = input.now ?? Date.now()
      const expiresAt = input.expiresAt ?? existing?.expiresAt
      const expiryCondition = input.expiryCondition ?? existing?.expiryCondition
      const freshEvidence = input.evidence !== undefined && input.evidence !== existing?.evidence
      if (existing && tier !== existing.tier && !freshEvidence)
        throw new Error("Changing a knowledge tier requires new evidence")
      const substantive = Boolean(
        existing &&
          (existing.title !== input.title ||
            existing.content !== input.content ||
            existing.tier !== tier ||
            existing.expiresAt !== expiresAt ||
            existing.expiryCondition !== expiryCondition),
      )
      if (existing && !substantive && !freshEvidence) return existing
      db.exec("SAVEPOINT supervisor_knowledge_put")
      try {
        if (existing && substantive) snapshotKnowledge(existing, "superseded by knowledge.put", { now })
        db.prepare(
          `INSERT INTO supervisor_channel_knowledge
        (id, scope, scope_id, title, content, tier, evidence, reinforced_at, expires_at, expiry_condition, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content,
        tier = excluded.tier, evidence = excluded.evidence, reinforced_at = excluded.reinforced_at,
        expires_at = excluded.expires_at, expiry_condition = excluded.expiry_condition,
        updated_at = excluded.updated_at`,
        ).run(
          input.id,
          input.scope,
          input.scopeID ?? null,
          input.title,
          input.content,
          tier,
          input.evidence ?? existing?.evidence ?? null,
          freshEvidence ? now : (existing?.reinforcedAt ?? now),
          expiresAt ?? null,
          expiryCondition ?? null,
          existing?.createdAt ?? now,
          now,
        )
        if (input.scope === "shared") bumpSharedRevision()
        db.exec("RELEASE supervisor_knowledge_put")
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_knowledge_put")
        db.exec("RELEASE supervisor_knowledge_put")
        throw error
      }
      return getKnowledge(input.id)!
    }

    function getKnowledge(id: string): Knowledge | undefined {
      const row = db.prepare("SELECT * FROM supervisor_channel_knowledge WHERE id = ?").get(id) as
        | KnowledgeRow
        | undefined
      return row ? knowledgeFromRow(row) : undefined
    }

    function listKnowledge(options?: {
      scope?: Knowledge["scope"]
      scopeID?: string
      ownedOnly?: boolean
    }): Knowledge[] {
      return (
        db
          .prepare(
            `SELECT * FROM supervisor_channel_knowledge WHERE (? IS NULL OR scope = ?)
        AND (? IS NULL OR scope_id = ?) AND (? = 0 OR source_home IS NULL) ORDER BY scope, scope_id, id`,
          )
          .all(
            options?.scope ?? null,
            options?.scope ?? null,
            options?.scopeID ?? null,
            options?.scopeID ?? null,
            Number(options?.ownedOnly ?? false),
          ) as KnowledgeRow[]
      ).map(knowledgeFromRow)
    }

    function archiveKnowledge(
      id: string,
      reason: string,
      options?: { now?: number; imported?: boolean; evidence?: string },
    ) {
      validateText(reason)
      if (options?.evidence !== undefined) validateText(options.evidence)
      const item = getKnowledge(id)
      if (!item) throw new Error(`Unknown knowledge: ${id}`)
      if (item.sourceHome && !options?.imported) throw new Error(`Primary-owned shared knowledge is read-only: ${id}`)
      const now = options?.now ?? Date.now()
      const archived = snapshotKnowledge(item, reason, { now, evidence: options?.evidence })
      db.prepare("DELETE FROM supervisor_channel_knowledge WHERE id = ?").run(id)
      if (item.scope === "shared" && !item.sourceHome) bumpSharedRevision()
      return archived
    }

    function snapshotKnowledge(item: Knowledge, reason: string, options: { now: number; evidence?: string }) {
      db.prepare(
        `INSERT INTO supervisor_knowledge_archive
        (id, scope, scope_id, title, content, tier, evidence, reinforced_at, expires_at, expiry_condition,
         source_home, source_id, source_version, source, created_at, updated_at, archived_at, reason)
        SELECT id, scope, scope_id, title, content, tier, COALESCE(?, evidence), reinforced_at, expires_at, expiry_condition,
         source_home, source_id, source_version, COALESCE(source_home, ?), created_at, updated_at, ?, ?
         FROM supervisor_channel_knowledge WHERE id = ?`,
      ).run(options.evidence ?? null, home, options.now, reason, item.id)
      return {
        ...item,
        evidence: options.evidence ?? item.evidence,
        source: item.sourceHome ?? home,
        archivedAt: options.now,
        reason,
      }
    }

    function listArchive(options?: { id?: string }): KnowledgeArchive[] {
      return (
        db
          .prepare(
            "SELECT * FROM supervisor_knowledge_archive WHERE (? IS NULL OR id = ?) ORDER BY archived_at, archive_id",
          )
          .all(options?.id ?? null, options?.id ?? null) as (KnowledgeRow & {
          source: string
          archived_at: number
          reason: string
        })[]
      ).map((row) => ({
        ...knowledgeFromRow(row),
        source: row.source,
        archivedAt: row.archived_at,
        reason: row.reason,
      }))
    }

    function sharedStatus() {
      const row = db
        .prepare("SELECT source_home, source_id, version, synced_at FROM supervisor_knowledge_shared WHERE id = 1")
        .get() as { source_home: string | null; source_id: string | null; version: number; synced_at: number | null }
      return {
        sourceHome: row.source_home ?? undefined,
        sourceID: row.source_id ?? undefined,
        version: row.version,
        syncedAt: row.synced_at ?? undefined,
      }
    }

    function homeID() {
      return (db.prepare("SELECT uuid FROM supervisor_knowledge_home WHERE id = 1").get() as { uuid: string }).uuid
    }

    function getKnowledgeBudget() {
      return (db.prepare("SELECT tokens FROM supervisor_knowledge_budget WHERE id = 1").get() as { tokens: number })
        .tokens
    }

    function setKnowledgeBudget(tokens: number) {
      if (!Number.isSafeInteger(tokens) || tokens < 1)
        throw new Error("Startup knowledge budget must be a positive integer")
      db.prepare("UPDATE supervisor_knowledge_budget SET tokens = ?, updated_at = ? WHERE id = 1").run(
        tokens,
        Date.now(),
      )
      return tokens
    }

    function bumpSharedRevision() {
      db.exec("UPDATE supervisor_knowledge_shared SET version = version + 1 WHERE id = 1")
    }

    function syncShared(input: {
      sourceHome: string
      sourceID: string
      version: number
      records: Knowledge[]
      now?: number
    }) {
      if (!path.isAbsolute(input.sourceHome)) throw new Error("Shared source home must be absolute")
      if (!/^[0-9a-f-]{36}$/.test(input.sourceID)) throw new Error("Invalid shared source identity")
      if (input.sourceID === homeID()) throw new Error("Shared sync cannot bind a home to itself")
      if (!Number.isSafeInteger(input.version) || input.version < 0) throw new Error("Invalid shared version")
      if (input.records.some((item) => item.scope !== "shared" || item.sourceHome))
        throw new Error("Shared sync may contain only primary-owned shared preferences")
      const status = sharedStatus()
      if (status.sourceID && status.sourceID !== input.sourceID)
        throw new Error("Shared knowledge is bound to a different primary home")
      if (!status.sourceID && status.sourceHome)
        throw new Error("Legacy shared cache has no primary identity; manual reconciliation is required")
      if (!status.sourceID && listKnowledge({ scope: "shared" }).length)
        throw new Error("Local shared knowledge exists; this home cannot silently become a delegate")
      if (input.version < status.version) throw new Error("Shared sync version would roll back")
      const ids = new Set(input.records.map((item) => item.id))
      if (ids.size !== input.records.length) throw new Error("Duplicate shared knowledge ID in sync")
      const now = input.now ?? Date.now()
      if (status.sourceID && input.version === status.version) {
        const current = listKnowledge({ scope: "shared" })
        const unchanged =
          current.length === input.records.length &&
          input.records.every((item) => {
            const prior = current.find((entry) => entry.id === item.id)
            return (
              prior &&
              JSON.stringify([
                prior.title,
                prior.content,
                prior.tier,
                prior.evidence,
                prior.reinforcedAt,
                prior.expiresAt,
                prior.expiryCondition,
              ]) ===
                JSON.stringify([
                  item.title,
                  item.content,
                  item.tier,
                  item.evidence,
                  item.reinforcedAt,
                  item.expiresAt,
                  item.expiryCondition,
                ])
            )
          })
        if (!unchanged) throw new Error("Conflicting shared snapshot at the same source version")
        db.prepare("UPDATE supervisor_knowledge_shared SET source_home = ?, synced_at = ? WHERE id = 1").run(
          input.sourceHome,
          now,
        )
        return sharedStatus()
      }
      db.exec("SAVEPOINT supervisor_knowledge_shared_sync")
      try {
        for (const current of listKnowledge({ scope: "shared" })) {
          if (!ids.has(current.id))
            archiveKnowledge(current.id, "removed by primary shared snapshot", { imported: true, now })
        }
        for (const item of input.records) {
          validateID(item.id)
          validateText(item.title)
          validateText(item.content)
          const existing = getKnowledge(item.id)
          if (existing && (existing.scope !== "shared" || existing.sourceID !== input.sourceID))
            throw new Error(`Conflicting knowledge ownership: ${item.id}`)
          if (
            existing &&
            (existing.title !== item.title ||
              existing.content !== item.content ||
              existing.tier !== item.tier ||
              existing.expiresAt !== item.expiresAt ||
              existing.expiryCondition !== item.expiryCondition)
          )
            snapshotKnowledge(existing, "superseded by primary shared snapshot", { now })
          db.prepare(
            `INSERT INTO supervisor_channel_knowledge
            (id, scope, scope_id, title, content, tier, evidence, reinforced_at, expires_at, expiry_condition,
             source_home, source_id, source_version, created_at, updated_at)
            VALUES (?, 'shared', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content,
             tier = excluded.tier, evidence = excluded.evidence, reinforced_at = excluded.reinforced_at,
             expires_at = excluded.expires_at, expiry_condition = excluded.expiry_condition,
             source_home = excluded.source_home, source_id = excluded.source_id,
             source_version = excluded.source_version, updated_at = excluded.updated_at`,
          ).run(
            item.id,
            item.title,
            item.content,
            item.tier,
            item.evidence ?? null,
            item.reinforcedAt,
            item.expiresAt ?? null,
            item.expiryCondition ?? null,
            input.sourceHome,
            input.sourceID,
            input.version,
            item.createdAt,
            item.updatedAt,
          )
        }
        db.prepare(
          "UPDATE supervisor_knowledge_shared SET source_home = ?, source_id = ?, version = ?, synced_at = ? WHERE id = 1",
        ).run(input.sourceHome, input.sourceID, input.version, now)
        db.exec("RELEASE supervisor_knowledge_shared_sync")
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_knowledge_shared_sync")
        db.exec("RELEASE supervisor_knowledge_shared_sync")
        throw error
      }
      return sharedStatus()
    }

    function stowKnowledge(changes: readonly StowChange[], options?: { now?: number }) {
      const now = options?.now ?? Date.now()
      const inspected = listKnowledge({ ownedOnly: true })
      const archived: KnowledgeArchive[] = []
      const touched = new Set<string>()
      db.exec("SAVEPOINT supervisor_knowledge_stow")
      try {
        for (const change of changes) {
          validateID(change.id)
          validateText(change.evidence)
          if (touched.has(change.id)) throw new Error(`Duplicate stow change: ${change.id}`)
          touched.add(change.id)
          if (change.action === "upsert") {
            putKnowledge({ ...change, now })
            continue
          }
          const current = getKnowledge(change.id)
          if (!current || current.sourceHome) throw new Error(`Stow can change only owned knowledge: ${change.id}`)
          if (change.action === "archive") {
            archived.push(archiveKnowledge(change.id, change.reason, { now, evidence: change.evidence }))
            continue
          }
          putKnowledge({ ...current, evidence: change.evidence, now })
        }
        for (const item of listKnowledge({ ownedOnly: true })) {
          if (item.tier === "pinned") continue
          const age = now - item.reinforcedAt
          const expired = item.expiresAt !== undefined && item.expiresAt <= now
          if (item.tier === "aging" && !expired && age < 30 * 24 * 60 * 60 * 1000) continue
          if (item.tier === "perishable" && !expired && age < 7 * 24 * 60 * 60 * 1000) continue
          archived.push(
            archiveKnowledge(item.id, expired ? "checkable expiry reached" : `${item.tier} retention elapsed`, { now }),
          )
        }
        db.exec("RELEASE supervisor_knowledge_stow")
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_knowledge_stow")
        db.exec("RELEASE supervisor_knowledge_stow")
        throw error
      }
      return {
        inspected: inspected.length,
        changed: touched.size,
        archived,
        active: listKnowledge({ ownedOnly: true }).length,
      }
    }

    function requireReply(id: string): Reply {
      const reply = getReply(id)
      if (!reply) throw new Error(`Unknown reply: ${id}`)
      return reply
    }

    return {
      inbox: {
        note,
        get: getNote,
        list: listNotes,
        pending: pendingNotes,
        markNotified: (id: string) => advanceNote(id, "notified"),
        markDelivered: (id: string) => advanceNote(id, "delivered"),
        ack: (id: string) => advanceNote(id, "handled"),
        markDismissAttempting,
        markDismissUnknown,
        markDismissRejected,
        markDismissed,
        reconcileDismiss,
      },
      channels: { configure, get: getChannel, list: listChannels },
      replies: {
        promise,
        get: getReply,
        list: listReplies,
        send,
        image,
        ready: readyReplies,
        markAttempting,
        markUnknown,
        markRejected,
        markSent,
        reconcile: reconcileReply,
        ack: ackReply,
        outstanding: outstandingReplies,
        retire: retireReply,
        rechain: rechainReply,
        recordTerminal,
        terminalObligations,
        markTerminalNotified,
        owedByWork,
      },
      away: { set: setAway, get: getAway, isAway },
      knowledge: {
        put: putKnowledge,
        get: getKnowledge,
        list: listKnowledge,
        archive: archiveKnowledge,
        archived: listArchive,
        sharedStatus,
        homeID,
        getBudget: getKnowledgeBudget,
        setBudget: setKnowledgeBudget,
        syncShared,
        stow: stowKnowledge,
      },
    }
  }
}

function noteFromRow(row: SupervisorChannels.NoteRow): SupervisorChannels.Note {
  return {
    id: row.id,
    source: row.source,
    text: row.text,
    origin: row.origin ? JSON.parse(row.origin) : undefined,
    trusted: Boolean(row.trusted),
    state: row.state,
    dismissal:
      row.dismiss_state === "none"
        ? undefined
        : { state: row.dismiss_state, receipt: row.dismiss_receipt ? JSON.parse(row.dismiss_receipt) : undefined },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function channelFromRow(row: SupervisorChannels.ChannelRow): SupervisorChannels.Channel {
  return {
    id: row.id,
    kind: row.kind,
    enabled: Boolean(row.enabled),
    automaticReplies: Boolean(row.automatic_replies),
    endpoint: row.endpoint ?? undefined,
    directory: row.directory ?? undefined,
    command: row.command ? JSON.parse(row.command) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function replyFromRow(row: SupervisorChannels.ReplyRow): SupervisorChannels.Reply {
  return {
    id: row.id,
    sourceID: row.source_id,
    origin: JSON.parse(row.origin),
    text: row.text ?? undefined,
    image:
      row.image_base64 && row.image_media_type && row.image_sha256
        ? {
            mediaType: row.image_media_type,
            bytes: Buffer.byteLength(row.image_base64, "base64"),
            sha256: row.image_sha256,
          }
        : undefined,
    mode: row.mode,
    dueAt: row.due_at ?? undefined,
    workID: row.work_id ?? undefined,
    taskID: row.task_id ?? undefined,
    handoffID: row.handoff_id ?? undefined,
    terminal: row.terminal_outcome
      ? { outcome: row.terminal_outcome, at: row.terminal_at!, notified: Boolean(row.terminal_notified) }
      : undefined,
    retired: row.retired_at ? { at: row.retired_at, reason: row.retire_reason! } : undefined,
    rechainTo: row.rechain_to ?? undefined,
    state: row.state,
    readyAt: row.ready_at ?? undefined,
    sentAt: row.sent_at ?? undefined,
    receipt: row.receipt ? JSON.parse(row.receipt) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readImage(filename: string) {
  const extension = path.extname(filename).toLowerCase()
  const expectedType = (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".tif": "image/tiff",
      ".tiff": "image/tiff",
    } as Record<string, string>
  )[extension]
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size < 1 || stat.size > 5_000_000)
      throw new Error("Reply image must be a nonempty regular file of at most 5 MB")
    const bytes = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    if (length !== stat.size) throw new Error("Reply image changed while being read")
    const image = bytes.subarray(0, length)
    const mediaType = detectImageMediaType(image)
    if (!mediaType || (expectedType && expectedType !== mediaType))
      throw new Error("Reply image content does not match its media type")
    return {
      mediaType,
      dataBase64: image.toString("base64"),
      sha256: createHash("sha256").update(image).digest("hex"),
    }
  } finally {
    closeSync(fd)
  }
}

function detectImageMediaType(image: Buffer) {
  if (image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png"
  if (image.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(image.toString("ascii", 0, 6))) return "image/gif"
  if (image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP") return "image/webp"
  if (image.toString("ascii", 0, 2) === "BM") return "image/bmp"
  if (["49492a00", "4d4d002a"].includes(image.subarray(0, 4).toString("hex"))) return "image/tiff"
  return undefined
}

function knowledgeFromRow(row: SupervisorChannels.KnowledgeRow): SupervisorChannels.Knowledge {
  return {
    id: row.id,
    scope: row.scope,
    scopeID: row.scope_id ?? undefined,
    title: row.title,
    content: row.content,
    tier: row.tier,
    evidence: row.evidence ?? undefined,
    reinforcedAt: row.reinforced_at,
    expiresAt: row.expires_at ?? undefined,
    expiryCondition: row.expiry_condition ?? undefined,
    sourceHome: row.source_home ?? undefined,
    sourceID: row.source_id ?? undefined,
    sourceVersion: row.source_version ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateID(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error("Invalid channel ID")
}

function validateText(value: string) {
  if (!value || value.length > 256_000) throw new Error("Text must be nonempty and at most 256,000 characters")
}

function validateTime(value?: number) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid timestamp")
}

function validateOrigin(origin: SupervisorChannels.Origin) {
  if (!["x", "discord", "local"].includes(origin.channel)) throw new Error("Invalid message origin")
  if (
    origin.replyBudget !== undefined &&
    (!Number.isSafeInteger(origin.replyBudget) || origin.replyBudget < 0 || origin.replyBudget > 3)
  )
    throw new Error("Origin reply budget must be between 0 and 3")
  if (origin.channel !== "local" && !origin.threadID) throw new Error("Public origin requires its original thread")
  if (
    origin.replyMaxChars !== undefined &&
    (!Number.isSafeInteger(origin.replyMaxChars) || origin.replyMaxChars < 50 || origin.replyMaxChars > 2000)
  )
    throw new Error("Origin reply max characters must be between 50 and 2000")
}

function same(left: unknown, right: unknown) {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)))
}
