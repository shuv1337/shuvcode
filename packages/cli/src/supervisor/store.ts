import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Schema } from "effect"
import { SupervisorProjects } from "./projects"
import { SupervisorBacklog } from "./backlog"
import { SupervisorDelivery } from "./delivery"
import { SupervisorValidation } from "./validation"
import { SupervisorDelegates } from "./delegates"
import { SupervisorChannels } from "./channels"
import { SupervisorAway } from "./away"

export namespace SupervisorStore {
  export type Authority = { sessionID: string; generation: number }
  export type Lead = Authority & { active: boolean }
  export type Model = { providerID: string; modelID: string; variant?: string }
  export type Permission = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
  export type Task = {
    id: string
    kind: "ship" | "scout"
    project: string
    worktree: string
    branch: string
    baseRef: string
    baseCommit: string
    sessionID: string
    brief: string
    model: Model
    agent: string
    permissions: Permission[]
    status: "active" | "cancelling" | "cancelled" | "completed"
    cursor: number
    provisioned: boolean
    error?: string
    executionOutcome?: "succeeded" | "failed" | "interrupted"
    admissionUncertain: boolean
    uncertaintyEpoch?: number
  }
  export type Payload = { text: string; delivery: "steer" | "queue" }
  export type Outbox = { taskID: string; messageID: string; payload: Payload }
  export type Notice = {
    generation: number
    key: string
    messageID: string
    sessionID: string
    payload: Payload
    state: "pending" | "acked"
  }
  export type OutboxEntry = Outbox & {
    generation: number
    state: "pending" | "acked" | "cancelled"
    attempted: boolean
    attemptEpoch?: number
  }
  export type Obligation = {
    taskID: string
    operationID: string
    payload: Payload
    state: "open" | "settled" | "cancelled"
    delivered: boolean
  }
  export type Receipt = { operationID: string; kind: "ship" | "scout"; evidence: Schema.Json }
  export type Decision = {
    taskID: string
    id: string
    payload: Schema.Json
    resolution?: Schema.Json
  }

  type LeadRow = { session_id: string; generation: number; active: number }
  type TaskRow = {
    id: string
    kind: Task["kind"]
    project: string
    worktree: string
    branch: string
    base_ref: string
    base_commit: string
    session_id: string
    brief: string
    model: string
    agent: string
    permissions: string
    status: Task["status"]
    cursor: number
    provisioned: number
    error: string | null
    execution_outcome: Task["executionOutcome"] | null
    admission_uncertain: number
    uncertainty_epoch: number | null
  }

  export function open(home: string, managed?: { epoch: number; pilotID: string }) {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const canonicalHome = realpathSync(home)
    chmodSync(canonicalHome, 0o700)
    const lock = new DatabaseSync(join(canonicalHome, "supervisor.lock.sqlite"), { timeout: 0 })
    chmodSync(join(canonicalHome, "supervisor.lock.sqlite"), 0o600)
    try {
      lock.exec("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE")
    } catch (error) {
      lock.close()
      throw error
    }
    const db = new DatabaseSync(join(canonicalHome, "supervisor.sqlite"), { timeout: 0 })
    chmodSync(join(canonicalHome, "supervisor.sqlite"), 0o600)
    db.exec(`
      PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS lead (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        session_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS server (id INTEGER PRIMARY KEY CHECK (id = 1), url TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('ship', 'scout')),
        project TEXT NOT NULL,
        worktree TEXT NOT NULL,
        branch TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        session_id TEXT NOT NULL,
        brief TEXT NOT NULL,
        model TEXT NOT NULL,
        agent TEXT NOT NULL,
        permissions TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'cancelling', 'cancelled', 'completed')),
        cursor INTEGER NOT NULL DEFAULT 0,
        provisioned INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        execution_outcome TEXT CHECK (execution_outcome IN ('succeeded', 'failed', 'interrupted')),
        admission_uncertain INTEGER NOT NULL DEFAULT 0 CHECK (admission_uncertain IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS obligation (
        task_id TEXT NOT NULL REFERENCES task(id),
        operation_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('open', 'settled', 'cancelled')),
        delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
        PRIMARY KEY (task_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        task_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        attempted INTEGER NOT NULL DEFAULT 0 CHECK (attempted IN (0, 1)),
        state TEXT NOT NULL CHECK (state IN ('pending', 'acked', 'cancelled')),
        PRIMARY KEY (task_id, message_id),
        FOREIGN KEY (task_id, message_id) REFERENCES obligation(task_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS receipt (
        task_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        evidence TEXT NOT NULL,
        PRIMARY KEY (task_id, operation_id),
        FOREIGN KEY (task_id, operation_id) REFERENCES obligation(task_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS receipt_proposal (
        task_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        evidence TEXT NOT NULL,
        PRIMARY KEY (task_id, operation_id),
        FOREIGN KEY (task_id, operation_id) REFERENCES obligation(task_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS decision (
        task_id TEXT NOT NULL REFERENCES task(id),
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        resolution TEXT,
        PRIMARY KEY (task_id, id)
      );
      CREATE TABLE IF NOT EXISTS cleanup (
        task_id TEXT PRIMARY KEY REFERENCES task(id),
        evidence TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notice (
        generation INTEGER NOT NULL,
        key TEXT NOT NULL,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'acked')),
        PRIMARY KEY (generation, key)
      );
      CREATE TABLE IF NOT EXISTS supervisor_epoch (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pilot_id TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        recovery_from_epoch INTEGER
      );
      CREATE TABLE IF NOT EXISTS recovery_audit (
        id INTEGER PRIMARY KEY,
        pilot_id TEXT NOT NULL,
        from_epoch INTEGER NOT NULL,
        to_epoch INTEGER NOT NULL,
        reset_count INTEGER NOT NULL,
        cleared_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    // These columns are added to pilot databases created before managed recovery existed.
    if (
      !(db.prepare("PRAGMA table_info(outbox)").all() as { name: string }[]).some(
        (column) => column.name === "attempt_epoch",
      )
    )
      db.exec("ALTER TABLE outbox ADD COLUMN attempt_epoch INTEGER")
    if (
      !(db.prepare("PRAGMA table_info(task)").all() as { name: string }[]).some(
        (column) => column.name === "uncertainty_epoch",
      )
    )
      db.exec("ALTER TABLE task ADD COLUMN uncertainty_epoch INTEGER")
    if (
      !(db.prepare("PRAGMA table_info(supervisor_epoch)").all() as { name: string }[]).some(
        (column) => column.name === "recovery_from_epoch",
      )
    )
      db.exec("ALTER TABLE supervisor_epoch ADD COLUMN recovery_from_epoch INTEGER")

    function transaction<T>(run: () => T): T {
      if (db.isTransaction) return run()
      db.exec("BEGIN IMMEDIATE")
      try {
        const result = run()
        db.exec("COMMIT")
        return result
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    }

    const previousEpoch = db
      .prepare("SELECT pilot_id, epoch, recovery_from_epoch FROM supervisor_epoch WHERE id = 1")
      .get() as { pilot_id: string; epoch: number; recovery_from_epoch: number | null } | undefined
    const boundFromEpoch =
      previousEpoch?.recovery_from_epoch ??
      (managed && previousEpoch && previousEpoch.epoch < managed.epoch ? previousEpoch.epoch : undefined)
    try {
      if (!managed && previousEpoch) throw new Error("Managed supervisor home requires its native process epoch")
      if (managed) {
        if (!Number.isSafeInteger(managed.epoch) || managed.epoch < 1 || !managed.pilotID)
          throw new Error("Managed supervisor requires a positive epoch and pilot ID")
        transaction(() => {
          if (previousEpoch && (previousEpoch.pilot_id !== managed.pilotID || managed.epoch < previousEpoch.epoch))
            throw new Error("Supervisor pilot identity or epoch moved backwards")
          if (!previousEpoch)
            db.prepare("INSERT INTO supervisor_epoch (id, pilot_id, epoch) VALUES (1, ?, ?)").run(
              managed.pilotID,
              managed.epoch,
            )
          if (previousEpoch && managed.epoch > previousEpoch.epoch)
            db.prepare("UPDATE supervisor_epoch SET epoch = ?, recovery_from_epoch = ? WHERE id = 1").run(
              managed.epoch,
              previousEpoch.recovery_from_epoch ?? previousEpoch.epoch,
            )
        })
      }
    } catch (error) {
      db.close()
      lock.exec("ROLLBACK")
      lock.close()
      throw error
    }

    function lead(): Lead | undefined {
      const row = db.prepare("SELECT session_id, generation, active FROM lead WHERE id = 1").get() as
        | LeadRow
        | undefined
      return row && { sessionID: row.session_id, generation: row.generation, active: row.active === 1 }
    }

    function requireAuthority(authority: Authority) {
      const current = lead()
      if (!current?.active || current.sessionID !== authority.sessionID || current.generation !== authority.generation)
        throw new Error("Supervisor lead authority is stale or revoked")
    }

    function task(id: string): Task | undefined {
      const row = db.prepare("SELECT * FROM task WHERE id = ?").get(id) as TaskRow | undefined
      return (
        row && {
          id: row.id,
          kind: row.kind,
          project: row.project,
          worktree: row.worktree,
          branch: row.branch,
          baseRef: row.base_ref,
          baseCommit: row.base_commit,
          sessionID: row.session_id,
          brief: row.brief,
          model: JSON.parse(row.model) as Model,
          agent: row.agent,
          permissions: JSON.parse(row.permissions) as Permission[],
          status: row.status,
          cursor: row.cursor,
          provisioned: row.provisioned === 1,
          error: row.error ?? undefined,
          executionOutcome: row.execution_outcome ?? undefined,
          admissionUncertain: row.admission_uncertain === 1,
          uncertaintyEpoch: row.uncertainty_epoch ?? undefined,
        }
      )
    }

    function requireTask(id: string) {
      const found = task(id)
      if (!found) throw new Error(`Unknown supervisor task: ${id}`)
      return found
    }

    function requireActiveTask(id: string) {
      const found = requireTask(id)
      if (found.status !== "active") throw new Error(`Supervisor task is ${found.status}: ${id}`)
      return found
    }

    return {
      projects: SupervisorProjects.open(db),
      backlog: SupervisorBacklog.open(db),
      deliveries: SupervisorDelivery.open(db),
      validations: SupervisorValidation.open(db),
      delegates: SupervisorDelegates.open(db),
      channels: SupervisorChannels.open(db, canonicalHome),
      away: (options: Parameters<typeof SupervisorAway.open>[1]) => SupervisorAway.open(db, options),
      recoverFencedEpoch(input: { from: number; to: number; pilotID: string }) {
        if (
          !managed ||
          managed.pilotID !== input.pilotID ||
          managed.epoch !== input.to ||
          boundFromEpoch !== input.from ||
          input.from >= input.to
        )
          throw new Error("Fenced recovery does not match the managed supervisor epoch transition")
        return transaction(() => {
          const current = db.prepare("SELECT recovery_from_epoch FROM supervisor_epoch WHERE id = 1").get() as {
            recovery_from_epoch: number | null
          }
          if (current.recovery_from_epoch !== input.from)
            throw new Error("Fenced recovery was already applied or superseded")
          const reset = db
            .prepare("UPDATE outbox SET attempted = 0, attempt_epoch = NULL WHERE attempted = 1 AND attempt_epoch < ?")
            .run(input.to)
          const cleared = db
            .prepare(
              `UPDATE task SET admission_uncertain = 0, uncertainty_epoch = NULL,
            error = CASE WHEN error LIKE '%admission%' OR error LIKE '%fencing%' THEN NULL ELSE error END
            WHERE admission_uncertain = 1 AND uncertainty_epoch < ? AND NOT EXISTS (
              SELECT 1 FROM outbox WHERE outbox.task_id = task.id AND outbox.attempted = 1
                AND outbox.state != 'acked'
            )`,
            )
            .run(input.to)
          db.prepare(
            "INSERT INTO recovery_audit (pilot_id, from_epoch, to_epoch, reset_count, cleared_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(input.pilotID, input.from, input.to, reset.changes, cleared.changes, Date.now())
          db.prepare("UPDATE supervisor_epoch SET recovery_from_epoch = NULL WHERE id = 1").run()
          return { reset: reset.changes, cleared: cleared.changes }
        })
      },
      close() {
        db.close()
        lock.exec("ROLLBACK")
        lock.close()
      },
      lead,
      isNotice(messageID: string) {
        return Boolean(db.prepare("SELECT 1 FROM notice WHERE message_id = ?").get(messageID))
      },
      enqueueNotice(input: { key: string; payload: Payload }): Notice {
        return transaction(() => {
          const current = lead()
          if (!current?.active) throw new Error("Supervisor has no active lead for notice")
          const previous = db
            .prepare("SELECT message_id, session_id, payload, state FROM notice WHERE generation = ? AND key = ?")
            .get(current.generation, input.key) as
            | {
                message_id: string
                session_id: string
                payload: string
                state: Notice["state"]
              }
            | undefined
          if (previous)
            return {
              generation: current.generation,
              key: input.key,
              messageID: previous.message_id,
              sessionID: previous.session_id,
              payload: JSON.parse(previous.payload) as Payload,
              state: previous.state,
            }
          const messageID = `msg_${createHash("sha256").update(`${canonicalHome}\0${current.generation}\0${input.key}`).digest("hex")}`
          db.prepare(
            "INSERT INTO notice (generation, key, message_id, session_id, payload, state) VALUES (?, ?, ?, ?, ?, 'pending')",
          ).run(current.generation, input.key, messageID, current.sessionID, JSON.stringify(input.payload))
          return {
            generation: current.generation,
            key: input.key,
            messageID,
            sessionID: current.sessionID,
            payload: input.payload,
            state: "pending",
          }
        })
      },
      pendingNotices(): Notice[] {
        return (
          db
            .prepare(
              `SELECT n.generation, n.key, n.message_id, n.session_id, n.payload, n.state
            FROM notice n JOIN lead l ON l.id = 1 AND l.generation = n.generation
            WHERE l.active = 1 AND n.state = 'pending' ORDER BY n.rowid`,
            )
            .all() as {
            generation: number
            key: string
            message_id: string
            session_id: string
            payload: string
            state: Notice["state"]
          }[]
        ).map((row) => ({
          generation: row.generation,
          key: row.key,
          messageID: row.message_id,
          sessionID: row.session_id,
          payload: JSON.parse(row.payload) as Payload,
          state: row.state,
        }))
      },
      ackNotice(input: { generation: number; key: string }) {
        transaction(() => {
          const current = lead()
          if (!current?.active || current.generation !== input.generation)
            throw new Error("Supervisor notice generation is stale")
          const result = db
            .prepare("UPDATE notice SET state = 'acked' WHERE generation = ? AND key = ?")
            .run(input.generation, input.key)
          if (!result.changes) throw new Error("Unknown supervisor notice")
        })
      },
      bindServer(url: string) {
        return transaction(() => {
          const previous = db.prepare("SELECT url FROM server WHERE id = 1").get() as { url: string } | undefined
          if (previous && previous.url !== url) throw new Error("Supervisor server endpoint changed")
          if (!previous) db.prepare("INSERT INTO server (id, url) VALUES (1, ?)").run(url)
          return url
        })
      },
      activateLead(input: { sessionID: string; expectedGeneration: number; adoptPending?: boolean }): Lead {
        return transaction(() => {
          const current = lead()
          if ((current?.generation ?? 0) !== input.expectedGeneration)
            throw new Error("Supervisor lead generation mismatch")
          const next = { sessionID: input.sessionID, generation: input.expectedGeneration + 1, active: true }
          db.prepare(
            `INSERT INTO lead (id, session_id, generation, active) VALUES (1, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id, generation=excluded.generation, active=1`,
          ).run(next.sessionID, next.generation)
          if (input.adoptPending) {
            db.prepare("UPDATE outbox SET generation = ? WHERE state = 'pending'").run(next.generation)
            const pending = db
              .prepare("SELECT key, payload FROM notice WHERE state = 'pending' ORDER BY generation DESC")
              .all() as { key: string; payload: string }[]
            db.prepare("UPDATE notice SET state = 'acked' WHERE state = 'pending'").run()
            for (const item of pending)
              db.prepare(
                "INSERT OR IGNORE INTO notice (generation, key, message_id, session_id, payload, state) VALUES (?, ?, ?, ?, ?, 'pending')",
              ).run(
                next.generation,
                item.key,
                `msg_${createHash("sha256").update(`${canonicalHome}\0${next.generation}\0${item.key}`).digest("hex")}`,
                next.sessionID,
                item.payload,
              )
          }
          return next
        })
      },
      revokeLead(authority: Authority) {
        transaction(() => {
          requireAuthority(authority)
          db.prepare("UPDATE lead SET active = 0, generation = generation + 1 WHERE id = 1").run()
        })
      },
      createTask(input: {
        authority: Authority
        task: Omit<
          Task,
          "status" | "cursor" | "provisioned" | "error" | "executionOutcome" | "admissionUncertain" | "uncertaintyEpoch"
        >
        messageID: string
      }): Task {
        return transaction(() => {
          requireAuthority(input.authority)
          const previous = task(input.task.id)
          if (previous) {
            const initial = db
              .prepare("SELECT operation_id FROM obligation WHERE task_id = ? ORDER BY rowid LIMIT 1")
              .get(input.task.id) as { operation_id: string } | undefined
            if (
              previous.kind !== input.task.kind ||
              previous.project !== input.task.project ||
              previous.worktree !== input.task.worktree ||
              previous.branch !== input.task.branch ||
              previous.baseRef !== input.task.baseRef ||
              previous.baseCommit !== input.task.baseCommit ||
              previous.sessionID !== input.task.sessionID ||
              previous.brief !== input.task.brief ||
              previous.model.providerID !== input.task.model.providerID ||
              previous.model.modelID !== input.task.model.modelID ||
              previous.model.variant !== input.task.model.variant ||
              previous.agent !== input.task.agent ||
              JSON.stringify(previous.permissions) !== JSON.stringify(input.task.permissions) ||
              initial?.operation_id !== input.messageID
            )
              throw new Error("Conflicting supervisor task ID")
            return previous
          }
          db.prepare(
            `INSERT INTO task
            (id, kind, project, worktree, branch, base_ref, base_commit, session_id, brief, model, agent, permissions, status, cursor, provisioned)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0)`,
          ).run(
            input.task.id,
            input.task.kind,
            input.task.project,
            input.task.worktree,
            input.task.branch,
            input.task.baseRef,
            input.task.baseCommit,
            input.task.sessionID,
            input.task.brief,
            JSON.stringify(input.task.model),
            input.task.agent,
            JSON.stringify(input.task.permissions),
          )
          db.prepare("INSERT INTO obligation (task_id, operation_id, payload, state) VALUES (?, ?, ?, 'open')").run(
            input.task.id,
            input.messageID,
            JSON.stringify({ text: input.task.brief, delivery: "queue" } satisfies Payload),
          )
          db.prepare("INSERT INTO outbox (task_id, message_id, generation, state) VALUES (?, ?, ?, 'pending')").run(
            input.task.id,
            input.messageID,
            input.authority.generation,
          )
          return requireTask(input.task.id)
        })
      },
      markProvisioned(input: { authority: Authority; taskID: string }) {
        transaction(() => {
          requireAuthority(input.authority)
          requireActiveTask(input.taskID)
          db.prepare("UPDATE task SET provisioned = 1 WHERE id = ?").run(input.taskID)
        })
      },
      noteFailure(input: { taskID: string; message: string }) {
        transaction(() => {
          requireTask(input.taskID)
          db.prepare("UPDATE task SET error = ? WHERE id = ?").run(input.message, input.taskID)
        })
      },
      clearFailure(input: { taskID: string }) {
        transaction(() => {
          requireTask(input.taskID)
          db.prepare("UPDATE task SET error = NULL WHERE id = ?").run(input.taskID)
        })
      },
      task,
      tasks(): Task[] {
        return (db.prepare("SELECT id FROM task ORDER BY rowid").all() as { id: string }[]).map((row) =>
          requireTask(row.id),
        )
      },
      enqueue(input: { authority: Authority; taskID: string; messageID: string; payload: Payload }): Outbox {
        return transaction(() => {
          requireAuthority(input.authority)
          requireActiveTask(input.taskID)
          const previous = db
            .prepare(
              `SELECT b.payload, o.state, o.generation FROM obligation b JOIN outbox o
              ON o.task_id = b.task_id AND o.message_id = b.operation_id
              WHERE b.task_id = ? AND b.operation_id = ?`,
            )
            .get(input.taskID, input.messageID) as { payload: string; state: string; generation: number } | undefined
          if (!previous) {
            db.prepare("INSERT INTO obligation (task_id, operation_id, payload, state) VALUES (?, ?, ?, 'open')").run(
              input.taskID,
              input.messageID,
              JSON.stringify(input.payload),
            )
            db.prepare("INSERT INTO outbox (task_id, message_id, generation, state) VALUES (?, ?, ?, 'pending')").run(
              input.taskID,
              input.messageID,
              input.authority.generation,
            )
          }
          if (previous?.state === "pending" && previous.generation !== input.authority.generation)
            db.prepare("UPDATE outbox SET generation = ? WHERE task_id = ? AND message_id = ?").run(
              input.authority.generation,
              input.taskID,
              input.messageID,
            )
          return {
            taskID: input.taskID,
            messageID: input.messageID,
            payload: previous ? (JSON.parse(previous.payload) as Payload) : input.payload,
          }
        })
      },
      pendingOutbox(): Outbox[] {
        return (
          db
            .prepare(
              `SELECT o.task_id, o.message_id, b.payload FROM outbox o
              JOIN obligation b ON b.task_id = o.task_id AND b.operation_id = o.message_id
              JOIN task t ON t.id = o.task_id JOIN lead l ON l.id = 1
              WHERE o.state = 'pending' AND t.status = 'active' AND l.active = 1
                AND o.generation = l.generation ORDER BY o.rowid`,
            )
            .all() as { task_id: string; message_id: string; payload: string }[]
        ).map((row) => ({
          taskID: row.task_id,
          messageID: row.message_id,
          payload: JSON.parse(row.payload) as Payload,
        }))
      },
      outbox(taskID: string): OutboxEntry[] {
        requireTask(taskID)
        return (
          db
            .prepare(
              `SELECT o.message_id, o.generation, o.state, o.attempted, o.attempt_epoch, b.payload FROM outbox o JOIN obligation b
            ON b.task_id = o.task_id AND b.operation_id = o.message_id
            WHERE o.task_id = ? ORDER BY o.rowid`,
            )
            .all(taskID) as {
            message_id: string
            generation: number
            state: OutboxEntry["state"]
            attempted: number
            attempt_epoch: number | null
            payload: string
          }[]
        ).map((row) => ({
          taskID,
          messageID: row.message_id,
          generation: row.generation,
          state: row.state,
          attempted: row.attempted === 1,
          attemptEpoch: row.attempt_epoch ?? undefined,
          payload: JSON.parse(row.payload) as Payload,
        }))
      },
      ownedMessages(taskID: string): string[] {
        requireTask(taskID)
        return (
          db.prepare("SELECT message_id FROM outbox WHERE task_id = ? ORDER BY rowid").all(taskID) as {
            message_id: string
          }[]
        ).map((row) => row.message_id)
      },
      obligations(taskID: string): Obligation[] {
        requireTask(taskID)
        return (
          db
            .prepare("SELECT operation_id, payload, state, delivered FROM obligation WHERE task_id = ? ORDER BY rowid")
            .all(taskID) as {
            operation_id: string
            payload: string
            state: Obligation["state"]
            delivered: number
          }[]
        ).map((row) => ({
          taskID,
          operationID: row.operation_id,
          payload: JSON.parse(row.payload) as Payload,
          state: row.state,
          delivered: row.delivered === 1,
        }))
      },
      ackOutbox(input: { authority: Authority; taskID: string; messageID: string }) {
        transaction(() => {
          requireAuthority(input.authority)
          requireActiveTask(input.taskID)
          const result = db
            .prepare(
              "UPDATE outbox SET state = 'acked' WHERE task_id = ? AND message_id = ? AND generation = ? AND state IN ('pending', 'acked')",
            )
            .run(input.taskID, input.messageID, input.authority.generation)
          if (!result.changes) throw new Error("Unknown or cancelled supervisor outbox message")
        })
      },
      recordAdmission(input: { taskID: string; sessionID: string; messageID: string }) {
        transaction(() => {
          if (requireTask(input.taskID).sessionID !== input.sessionID)
            throw new Error("Admission belongs to another native session")
          const result = db
            .prepare(
              "UPDATE outbox SET state = 'acked' WHERE task_id = ? AND message_id = ? AND attempted = 1 AND state IN ('pending', 'acked')",
            )
            .run(input.taskID, input.messageID)
          if (!result.changes) throw new Error("Admission has no matching attempted outbox message")
        })
      },
      beginDispatch(input: { authority: Authority; taskID: string; messageID: string }) {
        const repeated = transaction(() => {
          requireAuthority(input.authority)
          requireActiveTask(input.taskID)
          const previous = db
            .prepare("SELECT generation, state, attempted FROM outbox WHERE task_id = ? AND message_id = ?")
            .get(input.taskID, input.messageID) as { generation: number; state: string; attempted: number } | undefined
          if (!previous || previous.state !== "pending" || previous.generation !== input.authority.generation)
            throw new Error("Supervisor dispatch is not pending for this lead")
          if (previous.attempted) {
            db.prepare(
              "UPDATE task SET admission_uncertain = 1, uncertainty_epoch = COALESCE(uncertainty_epoch, ?) WHERE id = ?",
            ).run(managed?.epoch ?? null, input.taskID)
            return true
          }
          db.prepare("UPDATE outbox SET attempted = 1, attempt_epoch = ? WHERE task_id = ? AND message_id = ?").run(
            managed?.epoch ?? null,
            input.taskID,
            input.messageID,
          )
          return false
        })
        if (repeated) throw new Error("Native admission already attempted; reconcile or recover a fenced epoch")
      },
      markAdmissionUncertain(taskID: string) {
        transaction(() => {
          requireTask(taskID)
          db.prepare(
            "UPDATE task SET admission_uncertain = 1, uncertainty_epoch = COALESCE(uncertainty_epoch, ?) WHERE id = ?",
          ).run(managed?.epoch ?? null, taskID)
        })
      },
      cancelTask(input: { authority: Authority; taskID: string }) {
        transaction(() => {
          requireAuthority(input.authority)
          const current = requireTask(input.taskID)
          if (current.status === "cancelled" || current.status === "cancelling") return
          if (current.status !== "active") throw new Error(`Supervisor task is ${current.status}`)
          if (
            db
              .prepare("SELECT 1 FROM outbox WHERE task_id = ? AND attempted = 1 AND state = 'pending' LIMIT 1")
              .get(input.taskID)
          )
            db.prepare(
              "UPDATE task SET admission_uncertain = 1, uncertainty_epoch = COALESCE(uncertainty_epoch, ?) WHERE id = ?",
            ).run(managed?.epoch ?? null, input.taskID)
          db.prepare("UPDATE task SET status = 'cancelling' WHERE id = ?").run(input.taskID)
          db.prepare("UPDATE outbox SET state = 'cancelled' WHERE task_id = ? AND state = 'pending'").run(input.taskID)
          db.prepare("UPDATE obligation SET state = 'cancelled' WHERE task_id = ? AND state = 'open'").run(input.taskID)
        })
      },
      settleCancellation(input: { authority: Authority; taskID: string }) {
        transaction(() => {
          requireAuthority(input.authority)
          const current = requireTask(input.taskID)
          if (current.status === "cancelled") return
          if (current.status !== "cancelling") throw new Error("Task has not begun cancellation")
          if (current.admissionUncertain) throw new Error("Supervisor admission remains uncertain")
          db.prepare("UPDATE task SET status = 'cancelled' WHERE id = ?").run(input.taskID)
        })
      },
      proposeReceipt(input: { taskID: string; operationID: string; receipt: Omit<Receipt, "operationID"> }): Receipt {
        return transaction(() => {
          const current = requireTask(input.taskID)
          if (current.status !== "active" && current.status !== "cancelling")
            throw new Error("Cannot propose receipt on terminal task")
          if (current.kind !== input.receipt.kind) throw new Error("Receipt kind does not match task")
          const obligation = db
            .prepare("SELECT state FROM obligation WHERE task_id = ? AND operation_id = ?")
            .get(input.taskID, input.operationID) as { state: string } | undefined
          if (!obligation) throw new Error("Receipt has no supervisor operation")
          const evidence = JSON.stringify(input.receipt.evidence)
          const finalized = db
            .prepare("SELECT kind, evidence FROM receipt WHERE task_id = ? AND operation_id = ?")
            .get(input.taskID, input.operationID) as { kind: string; evidence: string } | undefined
          if (finalized) {
            if (finalized.kind !== input.receipt.kind || finalized.evidence !== evidence)
              throw new Error("Conflicting supervisor receipt")
            return { operationID: input.operationID, ...input.receipt }
          }
          const previous = db
            .prepare("SELECT kind, evidence FROM receipt_proposal WHERE task_id = ? AND operation_id = ?")
            .get(input.taskID, input.operationID) as { kind: string; evidence: string } | undefined
          if (previous && (previous.kind !== input.receipt.kind || previous.evidence !== evidence))
            db.prepare("UPDATE receipt_proposal SET kind = ?, evidence = ? WHERE task_id = ? AND operation_id = ?").run(
              input.receipt.kind,
              evidence,
              input.taskID,
              input.operationID,
            )
          if (!previous)
            db.prepare("INSERT INTO receipt_proposal (task_id, operation_id, kind, evidence) VALUES (?, ?, ?, ?)").run(
              input.taskID,
              input.operationID,
              input.receipt.kind,
              evidence,
            )
          return { operationID: input.operationID, ...input.receipt }
        })
      },
      pendingReceipts(): { taskID: string; receipt: Receipt }[] {
        return (
          db.prepare("SELECT task_id, operation_id, kind, evidence FROM receipt_proposal ORDER BY rowid").all() as {
            task_id: string
            operation_id: string
            kind: Receipt["kind"]
            evidence: string
          }[]
        ).map((row) => ({
          taskID: row.task_id,
          receipt: { operationID: row.operation_id, kind: row.kind, evidence: JSON.parse(row.evidence) as Schema.Json },
        }))
      },
      observe(input: {
        taskID: string
        sessionID: string
        cursor: number
        delivered?: string[]
        outcome?: "succeeded" | "failed" | "interrupted"
        receipt?: Receipt
      }) {
        transaction(() => {
          const current = requireTask(input.taskID)
          if (current.sessionID !== input.sessionID) throw new Error("Observation belongs to another session")
          if (!Number.isSafeInteger(input.cursor) || input.cursor < current.cursor)
            throw new Error("Invalid observation cursor")
          for (const operationID of input.delivered ?? []) {
            const result = db
              .prepare("UPDATE obligation SET delivered = 1 WHERE task_id = ? AND operation_id = ?")
              .run(input.taskID, operationID)
            if (!result.changes) throw new Error("Native delivery does not belong to this task")
          }
          if (input.outcome)
            db.prepare("UPDATE task SET execution_outcome = ? WHERE id = ?").run(input.outcome, input.taskID)
          if (current.status !== "active" && current.status !== "cancelling" && input.receipt)
            throw new Error("Cannot record receipt on terminal task")
          if (input.receipt) {
            if (input.receipt.kind !== current.kind) throw new Error("Receipt kind does not match task")
            const obligation = db
              .prepare(
                `SELECT o.state, o.delivered, x.state AS dispatch FROM obligation o JOIN outbox x
                ON x.task_id = o.task_id AND x.message_id = o.operation_id
                WHERE o.task_id = ? AND o.operation_id = ?`,
              )
              .get(input.taskID, input.receipt.operationID) as
              | { state: string; delivered: number; dispatch: string }
              | undefined
            if (!obligation || obligation.dispatch !== "acked" || obligation.state === "cancelled")
              throw new Error("Receipt has no admitted supervisor operation")
            if (!obligation.delivered || (input.outcome ?? current.executionOutcome) !== "succeeded")
              throw new Error("Receipt lacks native delivery and successful execution proof")
            const evidence = JSON.stringify(input.receipt.evidence)
            const previous = db
              .prepare("SELECT kind, evidence FROM receipt WHERE task_id = ? AND operation_id = ?")
              .get(input.taskID, input.receipt.operationID) as { kind: string; evidence: string } | undefined
            if (previous && (previous.kind !== input.receipt.kind || previous.evidence !== evidence))
              throw new Error("Conflicting supervisor receipt")
            const proposal = db
              .prepare("SELECT kind, evidence FROM receipt_proposal WHERE task_id = ? AND operation_id = ?")
              .get(input.taskID, input.receipt.operationID) as { kind: string; evidence: string } | undefined
            if (!previous && (!proposal || proposal.kind !== input.receipt.kind || proposal.evidence !== evidence))
              throw new Error("Receipt does not match pending proposal")
            if (!previous) {
              db.prepare("INSERT INTO receipt (task_id, operation_id, kind, evidence) VALUES (?, ?, ?, ?)").run(
                input.taskID,
                input.receipt.operationID,
                input.receipt.kind,
                evidence,
              )
              db.prepare("UPDATE obligation SET state = 'settled' WHERE task_id = ? AND operation_id = ?").run(
                input.taskID,
                input.receipt.operationID,
              )
            }
            db.prepare("DELETE FROM receipt_proposal WHERE task_id = ? AND operation_id = ?").run(
              input.taskID,
              input.receipt.operationID,
            )
          }
          db.prepare("UPDATE task SET cursor = ? WHERE id = ?").run(input.cursor, input.taskID)
        })
      },
      receipts(taskID: string): Receipt[] {
        requireTask(taskID)
        return (
          db
            .prepare("SELECT operation_id, kind, evidence FROM receipt WHERE task_id = ? ORDER BY rowid")
            .all(taskID) as {
            operation_id: string
            kind: Receipt["kind"]
            evidence: string
          }[]
        ).map((row) => ({
          operationID: row.operation_id,
          kind: row.kind,
          evidence: JSON.parse(row.evidence) as Schema.Json,
        }))
      },
      openDecision(input: { authority?: Authority; taskID: string; id: string; payload: Schema.Json }): Decision {
        return transaction(() => {
          if (input.authority) requireAuthority(input.authority)
          const current = requireTask(input.taskID)
          if (current.status !== "active" && current.status !== "cancelling")
            throw new Error("Cannot open decision on terminal task")
          const previous = db
            .prepare("SELECT payload, resolution FROM decision WHERE task_id = ? AND id = ?")
            .get(input.taskID, input.id) as { payload: string; resolution: string | null } | undefined
          if (!previous)
            db.prepare("INSERT INTO decision (task_id, id, payload) VALUES (?, ?, ?)").run(
              input.taskID,
              input.id,
              JSON.stringify(input.payload),
            )
          return {
            taskID: input.taskID,
            id: input.id,
            payload: previous ? (JSON.parse(previous.payload) as Schema.Json) : input.payload,
            resolution:
              previous?.resolution === null || !previous ? undefined : (JSON.parse(previous.resolution) as Schema.Json),
          }
        })
      },
      resolveDecision(input: {
        authority: Authority
        taskID: string
        id: string
        resolution: Schema.Json
        messageID?: string
        payload?: Payload
        expectedQuestion?: string
        requestID?: string
      }) {
        return transaction(() => {
          requireAuthority(input.authority)
          if ((input.messageID === undefined) !== (input.payload === undefined))
            throw new Error("Decision answer requires both message ID and payload")
          const previous = db
            .prepare("SELECT payload, resolution FROM decision WHERE task_id = ? AND id = ?")
            .get(input.taskID, input.id) as { payload: string; resolution: string | null } | undefined
          if (!previous) throw new Error("Unknown supervisor decision")
          if (
            input.expectedQuestion !== undefined &&
            Schema.decodeUnknownSync(Schema.Struct({ question: Schema.String }))(JSON.parse(previous.payload))
              .question !== input.expectedQuestion
          )
            throw new Error("Decision question changed; refresh before answering")
          if (previous.resolution !== null) {
            if (previous.resolution === JSON.stringify(input.resolution))
              return JSON.parse(previous.resolution) as Schema.Json
            const recorded = Schema.decodeUnknownSync(
              Schema.Struct({ requestID: Schema.optional(Schema.String), answer: Schema.optional(Schema.String) }),
            )(JSON.parse(previous.resolution))
            const requested = Schema.decodeUnknownSync(Schema.Struct({ answer: Schema.optional(Schema.String) }))(
              input.resolution,
            )
            if (input.requestID && input.requestID === recorded.requestID && requested.answer === recorded.answer)
              return JSON.parse(previous.resolution) as Schema.Json
            throw new Error("Conflicting supervisor decision")
          }
          requireActiveTask(input.taskID)
          db.prepare("UPDATE decision SET resolution = ? WHERE task_id = ? AND id = ?").run(
            JSON.stringify(input.resolution),
            input.taskID,
            input.id,
          )
          if (input.messageID && input.payload) {
            const existing = db
              .prepare(
                `SELECT b.payload, o.state, o.generation FROM obligation b JOIN outbox o
              ON o.task_id = b.task_id AND o.message_id = b.operation_id
              WHERE b.task_id = ? AND b.operation_id = ?`,
              )
              .get(input.taskID, input.messageID) as { payload: string; state: string; generation: number } | undefined
            if (existing && existing.payload !== JSON.stringify(input.payload))
              throw new Error("Decision answer message ID conflicts with another obligation")
            if (!existing) {
              db.prepare("INSERT INTO obligation (task_id, operation_id, payload, state) VALUES (?, ?, ?, 'open')").run(
                input.taskID,
                input.messageID,
                JSON.stringify(input.payload),
              )
              db.prepare("INSERT INTO outbox (task_id, message_id, generation, state) VALUES (?, ?, ?, 'pending')").run(
                input.taskID,
                input.messageID,
                input.authority.generation,
              )
            }
            if (existing?.state === "pending" && existing.generation !== input.authority.generation)
              db.prepare("UPDATE outbox SET generation = ? WHERE task_id = ? AND message_id = ?").run(
                input.authority.generation,
                input.taskID,
                input.messageID,
              )
          }
          return input.resolution
        })
      },
      decisions(taskID: string): Decision[] {
        requireTask(taskID)
        return (
          db.prepare("SELECT id, payload, resolution FROM decision WHERE task_id = ? ORDER BY rowid").all(taskID) as {
            id: string
            payload: string
            resolution: string | null
          }[]
        ).map((row) => ({
          taskID,
          id: row.id,
          payload: JSON.parse(row.payload) as Schema.Json,
          resolution: row.resolution === null ? undefined : (JSON.parse(row.resolution) as Schema.Json),
        }))
      },
      recordCleanup(input: { taskID: string; evidence: Schema.Json }) {
        transaction(() => {
          const current = requireTask(input.taskID)
          if (current.status !== "completed" && current.status !== "cancelled")
            throw new Error("Cannot record cleanup before task is terminal")
          if (current.admissionUncertain) throw new Error("Supervisor admission remains uncertain")
          const previous = db.prepare("SELECT evidence FROM cleanup WHERE task_id = ?").get(input.taskID) as
            | { evidence: string }
            | undefined
          if (previous) {
            if (previous.evidence !== JSON.stringify(input.evidence))
              throw new Error("Conflicting supervisor cleanup evidence")
            return
          }
          db.prepare("INSERT INTO cleanup (task_id, evidence) VALUES (?, ?)").run(
            input.taskID,
            JSON.stringify(input.evidence),
          )
        })
      },
      cleanup(taskID: string): Schema.Json | undefined {
        requireTask(taskID)
        const row = db.prepare("SELECT evidence FROM cleanup WHERE task_id = ?").get(taskID) as
          | { evidence: string }
          | undefined
        return row ? (JSON.parse(row.evidence) as Schema.Json) : undefined
      },
      completeTask(input: { authority: Authority; taskID: string }) {
        transaction(() => {
          requireAuthority(input.authority)
          const current = requireActiveTask(input.taskID)
          if (current.admissionUncertain) throw new Error("Supervisor admission remains uncertain")
          if (current.executionOutcome !== "succeeded") throw new Error("Native worker has not succeeded")
          const open = db
            .prepare("SELECT 1 FROM obligation WHERE task_id = ? AND state != 'settled' LIMIT 1")
            .get(current.id)
          const undecided = db
            .prepare("SELECT 1 FROM decision WHERE task_id = ? AND resolution IS NULL LIMIT 1")
            .get(current.id)
          const settled = db
            .prepare("SELECT 1 FROM obligation WHERE task_id = ? AND state = 'settled' LIMIT 1")
            .get(current.id)
          if (open || undecided || !settled) throw new Error("Supervisor task has unsettled obligations or decisions")
          db.prepare("UPDATE task SET status = 'completed' WHERE id = ?").run(current.id)
        })
      },
    }
  }
}
