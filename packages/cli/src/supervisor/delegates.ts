import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { isDeepStrictEqual } from "node:util"
import { Schema } from "effect"
import { SupervisorClient } from "./client"
import type { SupervisorProtocol } from "./protocol"

export namespace SupervisorDelegates {
  export type Model = { providerID: string; modelID: string; variant?: string }
  export type Input = {
    id: string
    home: string
    host?: string
    scope: string
    sourceProjectID?: string
    projectID?: string
    enabled?: boolean
    model?: Model
  }
  export type Delegate = Required<Pick<Input, "id" | "home" | "scope" | "enabled">> &
    Pick<Input, "host" | "sourceProjectID" | "projectID" | "model"> & { createdAt: number; updatedAt: number }
  export type Patch = Partial<Pick<Delegate, "scope" | "projectID" | "enabled" | "model">>
  export type HandoffInput = {
    id: string
    delegateID: string
    sourceWorkIDs: string[]
    payload: Schema.Json
  }
  export type Handoff = HandoffInput & {
    state: "pending" | "received" | "completed" | "failed" | "unknown"
    receipt?: Schema.Json
    result?: Schema.Json
    error?: string
    cancelRequested: boolean
    createdAt: number
    updatedAt: number
  }
  export type Received = {
    id: string
    sourceHome: string
    payload: Schema.Json
    receipt: Schema.Json
    createdAt: number
  }
  export type Work = {
    id: string
    state: "queued" | "in-flight" | "done" | "cancelled"
    dependencies: { id: string; when: "done" | "landed" }[]
    landed?: Schema.Json
  }
  export type TransportResult =
    | { state: "ok"; result: unknown }
    | { state: "error"; error: string }
    | { state: "unknown"; error: string }
  export type Runner = (
    argv: string[],
    stdin: string,
    timeoutMs: number,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>

  export type DelegateRow = {
    id: string
    home: string
    host: string | null
    scope: string
    source_project_id: string | null
    project_id: string | null
    enabled: number
    model: string | null
    created_at: number
    updated_at: number
  }
  export type HandoffRow = {
    id: string
    delegate_id: string
    source_work_ids: string
    payload: string
    state: Handoff["state"]
    receipt: string | null
    result: string | null
    error: string | null
    cancel_requested: number
    created_at: number
    updated_at: number
  }
  export type ReceivedRow = { id: string; source_home: string; payload: string; receipt: string; created_at: number }

  /** Shares the workflow writer's SQLite connection and lifetime. */
  export function open(db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS supervisor_delegate (
        id TEXT PRIMARY KEY,
        home TEXT NOT NULL,
        host TEXT,
        scope TEXT NOT NULL,
        source_project_id TEXT,
        project_id TEXT,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supervisor_source_handoff (
        id TEXT PRIMARY KEY,
        delegate_id TEXT NOT NULL REFERENCES supervisor_delegate(id),
        source_work_ids TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'received', 'completed', 'failed', 'unknown')),
        receipt TEXT,
        result TEXT,
        error TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS supervisor_handoff_pending ON supervisor_source_handoff(state, created_at);
      CREATE TABLE IF NOT EXISTS supervisor_received_handoff (
        id TEXT PRIMARY KEY,
        source_home TEXT NOT NULL,
        payload TEXT NOT NULL,
        receipt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    if (
      !(db.prepare("PRAGMA table_info(supervisor_delegate)").all() as { name: string }[]).some(
        (column) => column.name === "source_project_id",
      )
    )
      db.exec("ALTER TABLE supervisor_delegate ADD COLUMN source_project_id TEXT")
    if (
      !(db.prepare("PRAGMA table_info(supervisor_source_handoff)").all() as { name: string }[]).some(
        (column) => column.name === "cancel_requested",
      )
    )
      db.exec(
        "ALTER TABLE supervisor_source_handoff ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1))",
      )

    function get(id: string): Delegate | undefined {
      const row = db.prepare("SELECT * FROM supervisor_delegate WHERE id = ?").get(id) as DelegateRow | undefined
      return row ? delegateFromRow(row) : undefined
    }

    function list(options?: { includeArchived?: boolean }): Delegate[] {
      return (
        db
          .prepare(
            `SELECT * FROM supervisor_delegate ${options?.includeArchived ? "" : "WHERE enabled = 1"}
        ORDER BY id`,
          )
          .all() as DelegateRow[]
      ).map(delegateFromRow)
    }

    function add(input: Input): Delegate {
      validateDelegate(input)
      const existing = get(input.id)
      if (existing) {
        if (
          same(
            { ...existing, createdAt: undefined, updatedAt: undefined },
            { ...input, enabled: input.enabled ?? true },
          )
        )
          return existing
        throw new Error(`Conflicting delegate ID: ${input.id}`)
      }
      const now = Date.now()
      db.prepare(
        `INSERT INTO supervisor_delegate
        (id, home, host, scope, source_project_id, project_id, enabled, model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.home,
        input.host ?? null,
        input.scope,
        input.sourceProjectID ?? null,
        input.projectID ?? null,
        Number(input.enabled ?? true),
        input.model ? JSON.stringify(input.model) : null,
        now,
        now,
      )
      return get(input.id)!
    }

    function update(id: string, patch: Patch): Delegate {
      const current = requireDelegate(id)
      if (Object.keys(patch).some((key) => !["scope", "projectID", "enabled", "model"].includes(key)))
        throw new Error("Delegate route identity is immutable; register a new delegate")
      const next = { ...current, ...patch }
      validateDelegate(next)
      db.prepare(
        `UPDATE supervisor_delegate SET scope = ?, project_id = ?, enabled = ?, model = ?, updated_at = ?
        WHERE id = ?`,
      ).run(
        next.scope,
        next.projectID ?? null,
        Number(next.enabled),
        next.model ? JSON.stringify(next.model) : null,
        Date.now(),
        id,
      )
      return get(id)!
    }

    function archive(id: string): Delegate {
      const current = requireDelegate(id)
      if (!current.enabled) return current
      return update(id, { enabled: false })
    }

    function handoff(id: string): Handoff | undefined {
      const row = db.prepare("SELECT * FROM supervisor_source_handoff WHERE id = ?").get(id) as HandoffRow | undefined
      return row ? handoffFromRow(row) : undefined
    }

    function pending(): Handoff[] {
      return (
        db
          .prepare("SELECT * FROM supervisor_source_handoff WHERE state = 'pending' ORDER BY created_at, id")
          .all() as HandoffRow[]
      ).map(handoffFromRow)
    }

    function outstanding(): Handoff[] {
      return (
        db
          .prepare(
            "SELECT * FROM supervisor_source_handoff WHERE state IN ('pending', 'received', 'unknown') OR (cancel_requested = 1 AND result IS NULL) ORDER BY updated_at, id",
          )
          .all() as HandoffRow[]
      ).map(handoffFromRow)
    }

    function enqueue(input: HandoffInput, apply?: () => void): Handoff {
      validateID(input.id)
      if (!input.sourceWorkIDs.length || new Set(input.sourceWorkIDs).size !== input.sourceWorkIDs.length)
        throw new Error("Handoff requires distinct source work IDs")
      input.sourceWorkIDs.forEach(validateID)
      const existing = handoff(input.id)
      if (existing) {
        if (
          same(
            { delegateID: existing.delegateID, sourceWorkIDs: existing.sourceWorkIDs, payload: existing.payload },
            { delegateID: input.delegateID, sourceWorkIDs: input.sourceWorkIDs, payload: input.payload },
          )
        )
          return existing
        throw new Error(`Conflicting handoff ID: ${input.id}`)
      }
      const delegate = requireDelegate(input.delegateID)
      if (!delegate.enabled) throw new Error(`Delegate is archived: ${delegate.id}`)
      db.exec("SAVEPOINT supervisor_delegate_enqueue")
      try {
        const now = Date.now()
        db.prepare(
          `INSERT INTO supervisor_source_handoff
          (id, delegate_id, source_work_ids, payload, state, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        ).run(input.id, input.delegateID, JSON.stringify(input.sourceWorkIDs), JSON.stringify(input.payload), now, now)
        apply?.()
        const result = handoff(input.id)!
        db.exec("RELEASE supervisor_delegate_enqueue")
        return result
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_delegate_enqueue")
        db.exec("RELEASE supervisor_delegate_enqueue")
        throw error
      }
    }

    function ackReceived(id: string, receipt: Schema.Json): Handoff {
      const current = requireHandoff(id)
      if (current.receipt !== undefined) {
        if (!same(current.receipt, receipt)) throw new Error(`Conflicting handoff receipt: ${id}`)
        if (current.state !== "pending" && current.state !== "unknown") return current
      }
      if (current.state !== "pending" && current.state !== "unknown")
        throw new Error(`Handoff cannot receive in state ${current.state}`)
      db.prepare(
        "UPDATE supervisor_source_handoff SET state = 'received', receipt = ?, error = NULL, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(receipt), Date.now(), id)
      return handoff(id)!
    }

    function complete(id: string, result: Schema.Json, apply?: () => void): Handoff {
      db.exec("SAVEPOINT supervisor_delegate_complete")
      try {
        const current = requireHandoff(id)
        if (current.result !== undefined) {
          if (!same(current.result, result)) throw new Error(`Conflicting handoff result: ${id}`)
          db.exec("RELEASE supervisor_delegate_complete")
          return current
        }
        if (current.receipt === undefined || (current.state !== "received" && current.state !== "unknown"))
          throw new Error(`Handoff has no received work: ${id}`)
        apply?.()
        db.prepare(
          "UPDATE supervisor_source_handoff SET state = 'completed', result = ?, error = NULL, updated_at = ? WHERE id = ?",
        ).run(JSON.stringify(result), Date.now(), id)
        const completed = handoff(id)!
        db.exec("RELEASE supervisor_delegate_complete")
        return completed
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_delegate_complete")
        db.exec("RELEASE supervisor_delegate_complete")
        throw error
      }
    }

    function fail(id: string, error: string): Handoff {
      const current = requireHandoff(id)
      if (current.state === "completed") throw new Error(`Completed handoff cannot fail: ${id}`)
      if (!error) throw new Error("Handoff failure requires a reason")
      db.prepare("UPDATE supervisor_source_handoff SET state = 'failed', error = ?, updated_at = ? WHERE id = ?").run(
        error,
        Date.now(),
        id,
      )
      return handoff(id)!
    }

    function requestCancel(id: string): Handoff {
      const current = requireHandoff(id)
      if (current.state === "completed") throw new Error(`Completed handoff cannot be cancelled: ${id}`)
      if (current.result !== undefined) return current
      if (current.cancelRequested) return current
      db.prepare("UPDATE supervisor_source_handoff SET cancel_requested = 1, updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      )
      return handoff(id)!
    }

    function cancelled(id: string, receipt: Schema.Json, result: Schema.Json, apply: () => void): Handoff {
      db.exec("SAVEPOINT supervisor_delegate_cancelled")
      try {
        const current = requireHandoff(id)
        if (!current.cancelRequested) throw new Error(`Handoff has no cancellation intent: ${id}`)
        if (current.result !== undefined) {
          if (!same(current.result, result)) throw new Error(`Conflicting cancellation result: ${id}`)
          db.exec("RELEASE supervisor_delegate_cancelled")
          return current
        }
        if (current.receipt !== undefined && !same(current.receipt, receipt))
          throw new Error(`Conflicting cancellation receipt: ${id}`)
        apply()
        db.prepare(
          "UPDATE supervisor_source_handoff SET state = 'failed', receipt = ?, result = ?, error = 'Cancellation confirmed', updated_at = ? WHERE id = ?",
        ).run(JSON.stringify(receipt), JSON.stringify(result), Date.now(), id)
        const settled = handoff(id)!
        db.exec("RELEASE supervisor_delegate_cancelled")
        return settled
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_delegate_cancelled")
        db.exec("RELEASE supervisor_delegate_cancelled")
        throw error
      }
    }

    function markUnknown(id: string, error: string): Handoff {
      const current = requireHandoff(id)
      if (current.state === "completed") throw new Error(`Completed handoff route cannot become unknown: ${id}`)
      if (!error) throw new Error("Unknown handoff route requires a reason")
      db.prepare("UPDATE supervisor_source_handoff SET state = 'unknown', error = ?, updated_at = ? WHERE id = ?").run(
        error,
        Date.now(),
        id,
      )
      return handoff(id)!
    }

    function retry(id: string): Handoff {
      const current = requireHandoff(id)
      if (current.cancelRequested) throw new Error(`Handoff cancellation is pending or confirmed: ${id}`)
      if (current.state !== "unknown" && current.state !== "failed")
        throw new Error(`Handoff cannot retry in state ${current.state}`)
      db.prepare(
        "UPDATE supervisor_source_handoff SET state = 'pending', error = NULL, updated_at = ? WHERE id = ?",
      ).run(Date.now(), id)
      return handoff(id)!
    }

    function received(id: string): Received | undefined {
      const row = db.prepare("SELECT * FROM supervisor_received_handoff WHERE id = ?").get(id) as
        | ReceivedRow
        | undefined
      return row ? receivedFromRow(row) : undefined
    }

    /** apply only writes on this DatabaseSync; external wakeups occur after commit. */
    function receive(
      input: { id: string; sourceHome: string; payload: Schema.Json },
      apply: () => Schema.Json,
    ): Received {
      validateID(input.id)
      validateHome(input.sourceHome)
      db.exec("SAVEPOINT supervisor_delegate_receive")
      try {
        const existing = received(input.id)
        if (!existing) {
          const receipt = apply()
          db.prepare(
            `INSERT INTO supervisor_received_handoff (id, source_home, payload, receipt, created_at)
            VALUES (?, ?, ?, ?, ?)`,
          ).run(input.id, input.sourceHome, JSON.stringify(input.payload), JSON.stringify(receipt), Date.now())
        }
        if (existing && (existing.sourceHome !== input.sourceHome || !same(existing.payload, input.payload)))
          throw new Error(`Conflicting received handoff ID: ${input.id}`)
        const result = received(input.id)!
        db.exec("RELEASE supervisor_delegate_receive")
        return result
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_delegate_receive")
        db.exec("RELEASE supervisor_delegate_receive")
        throw error
      }
    }

    function requireDelegate(id: string): Delegate {
      const delegate = get(id)
      if (!delegate) throw new Error(`Unknown delegate: ${id}`)
      return delegate
    }

    function requireHandoff(id: string): Handoff {
      const item = handoff(id)
      if (!item) throw new Error(`Unknown handoff: ${id}`)
      return item
    }

    return {
      add,
      update,
      archive,
      get,
      list,
      enqueue,
      handoff,
      pending,
      outstanding,
      ackReceived,
      complete,
      fail,
      requestCancel,
      cancelled,
      markUnknown,
      retry,
      receive,
      received,
      closure,
    }
  }

  /** Return queued ancestors first; an unsatisfied missing or active dependency cannot move. */
  export function closure(items: Work[], selectedIDs: string[]): string[] {
    if (!selectedIDs.length || new Set(selectedIDs).size !== selectedIDs.length)
      throw new Error("Choose distinct work IDs for handoff")
    const byID = new Map(items.map((item) => [item.id, item]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const result: string[] = []
    function visit(id: string) {
      if (visiting.has(id)) throw new Error(`Handoff dependency cycle at ${id}`)
      if (visited.has(id)) return
      const item = byID.get(id)
      if (!item) throw new Error(`Missing handoff work dependency: ${id}`)
      if (item.state !== "queued") throw new Error(`Handoff work is not queued: ${id}`)
      visiting.add(id)
      item.dependencies.forEach((dependency) => {
        const predecessor = byID.get(dependency.id)
        if (!predecessor) throw new Error(`Missing handoff work dependency: ${dependency.id}`)
        if (predecessor.state === "queued") return visit(predecessor.id)
        if (dependency.when === "done" && predecessor.state === "done") return
        if (dependency.when === "landed" && predecessor.landed !== undefined) return
        throw new Error(`Unmet handoff work dependency: ${dependency.id}`)
      })
      visiting.delete(id)
      visited.add(id)
      result.push(id)
    }
    selectedIDs.forEach(visit)
    return result
  }

  /** A route error is unknown: never retry against a different local home. */
  export async function request(
    delegate: Delegate,
    operation: SupervisorProtocol.Operation,
    runner: Runner = run,
  ): Promise<TransportResult> {
    validateDelegate(delegate)
    if (!delegate.enabled) return { state: "error", error: `Delegate is archived: ${delegate.id}` }
    const decoded = operation
    if (!delegate.host) {
      try {
        return { state: "ok", result: await SupervisorClient.request(delegate.home, decoded) }
      } catch (error) {
        return { state: "unknown", error: message(error) }
      }
    }
    try {
      const response = await runner(
        remoteCommand(delegate.host, ["shuvcode", "supervisor", "bridge", "--home", delegate.home]),
        JSON.stringify({ operation: decoded }),
        65_000,
      )
      if (response.exitCode !== 0)
        return { state: "unknown", error: response.stderr.trim() || `SSH exited ${response.exitCode}` }
      const body = Schema.decodeUnknownSync(
        Schema.Struct({
          result: Schema.optional(Schema.Unknown),
          error: Schema.optional(Schema.String),
        }),
      )(JSON.parse(response.stdout))
      if (body.error) return { state: "error", error: body.error }
      if (!("result" in body)) return { state: "unknown", error: "Remote bridge returned no result" }
      return { state: "ok", result: body.result }
    } catch (error) {
      return { state: "unknown", error: message(error) }
    }
  }

  /** Explicitly provision a delegate home; registration and normal requests never spawn it. */
  export async function provision(
    delegate: Delegate,
    input: { project: string; model?: string; providerURL?: string },
    runner: Runner = run,
  ): Promise<TransportResult> {
    validateDelegate(delegate)
    validateHome(input.project)
    if (input.model && !/^[^/\s]+\/[^\s]+$/.test(input.model)) throw new Error("Model must be provider/model")
    if (input.providerURL) {
      const url = new URL(input.providerURL)
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new Error("Provider URL must not contain credentials or query parameters")
    }
    const executable = delegate.host ? ["shuvcode"] : await localCommand()
    const command = [
      ...executable,
      "supervisor",
      "up",
      "--home",
      delegate.home,
      "--project",
      input.project,
      ...(input.model ? ["--model", input.model] : []),
      ...(input.providerURL ? ["--provider-url", input.providerURL] : []),
    ]
    try {
      const response = await runner(delegate.host ? remoteCommand(delegate.host, command) : command, "", 120_000)
      if (response.exitCode !== 0)
        return { state: "unknown", error: response.stderr.trim() || `Provision exited ${response.exitCode}` }
      return { state: "ok", result: response.stdout.trim() }
    } catch (error) {
      return { state: "unknown", error: message(error) }
    }
  }
}

function delegateFromRow(row: SupervisorDelegates.DelegateRow): SupervisorDelegates.Delegate {
  return {
    id: row.id,
    home: row.home,
    host: row.host ?? undefined,
    scope: row.scope,
    sourceProjectID: row.source_project_id ?? undefined,
    projectID: row.project_id ?? undefined,
    enabled: Boolean(row.enabled),
    model: row.model ? JSON.parse(row.model) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function handoffFromRow(row: SupervisorDelegates.HandoffRow): SupervisorDelegates.Handoff {
  return {
    id: row.id,
    delegateID: row.delegate_id,
    sourceWorkIDs: JSON.parse(row.source_work_ids),
    payload: JSON.parse(row.payload),
    state: row.state,
    receipt: row.receipt ? JSON.parse(row.receipt) : undefined,
    result: row.result ? JSON.parse(row.result) : undefined,
    error: row.error ?? undefined,
    cancelRequested: Boolean(row.cancel_requested),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function receivedFromRow(row: SupervisorDelegates.ReceivedRow): SupervisorDelegates.Received {
  return {
    id: row.id,
    sourceHome: row.source_home,
    payload: JSON.parse(row.payload),
    receipt: JSON.parse(row.receipt),
    createdAt: row.created_at,
  }
}

function validateID(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))
    throw new Error("Delegate or handoff ID must be at most 80 letters, digits, hyphens, or underscores")
}

function validateHome(home: string) {
  if (!path.isAbsolute(home) || home.includes("\0"))
    throw new Error("Delegate home must be an absolute path without NUL")
}

function validateDelegate(input: SupervisorDelegates.Input) {
  validateID(input.id)
  validateHome(input.home)
  if (!input.scope.trim()) throw new Error("Delegate scope is required")
  if (input.host !== undefined && (!input.host || input.host.startsWith("-") || /[\s\0]/.test(input.host)))
    throw new Error("Invalid SSH host")
  if (input.sourceProjectID) validateID(input.sourceProjectID)
  if (input.projectID) validateID(input.projectID)
  if (input.enabled !== undefined && typeof input.enabled !== "boolean")
    throw new Error("Invalid delegate enabled state")
  if (input.model && (!input.model.providerID || !input.model.modelID)) throw new Error("Invalid delegate model")
}

function same(left: unknown, right: unknown) {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)))
}

function remoteCommand(host: string, command: string[]) {
  if (host.startsWith("-") || /[\s\0]/.test(host)) throw new Error("Invalid SSH host")
  return [
    "ssh",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "--",
    host,
    command.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" "),
  ]
}

async function localCommand() {
  const { SupervisorManaged } = await import("./managed")
  return SupervisorManaged.command()
}

async function run(argv: string[], stdin: string, timeoutMs: number) {
  const child = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  child.stdin.write(stdin)
  child.stdin.end()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).then(
        ([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          child.kill()
          reject(new Error("Delegate command timed out"))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
