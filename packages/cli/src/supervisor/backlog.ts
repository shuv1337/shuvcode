import { DatabaseSync } from "node:sqlite"
import { isDeepStrictEqual } from "node:util"
import { Schema } from "effect"

export namespace SupervisorBacklog {
  export type Model = { providerID: string; modelID: string; variant?: string }
  export type Permission = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
  export type Dependency = { id: string; when: "done" | "landed" }
  export type PolicyProvenance = { source: "captain" | "registry"; reference: string; capturedAt: string }
  export type Overrides = { baseRef?: string; model?: Model; agent?: string; permissions?: Permission[] }
  export type Intake = {
    id: string
    projectID: string
    kind: "ship" | "scout"
    brief: string
    deliveryMode: "no-mistakes" | "direct-PR" | "local-only"
    mergePolicy: "manual" | "auto"
    policyProvenance?: PolicyProvenance
    classification?: string
    overrides?: Overrides
    dependencies?: Dependency[]
    resources?: string[]
    priority?: number
    notBefore?: number
    hold?: { reason: string; until?: number }
  }
  export type WorkItem = Omit<Required<Intake>, "classification" | "notBefore" | "hold" | "policyProvenance"> & {
    classification?: string
    policyProvenance?: PolicyProvenance
    notBefore?: number
    hold?: { reason: string; until?: number }
    state: "queued" | "in-flight" | "done" | "cancelled"
    attempt: number
    taskID?: string
    delegatedHandoffID?: string
    landed?: Schema.Json
    createdAt: number
    updatedAt: number
  }
  export type Patch = Partial<
    Pick<WorkItem, "brief" | "classification" | "overrides" | "dependencies" | "resources" | "priority" | "notBefore">
  >
  export type Attempt = { id: string; attempt: number; taskID: string; startedAt: number; completedAt?: number }
  export type DependencyStatus = Dependency & { state?: WorkItem["state"]; landed: boolean; met: boolean }
  export type Readiness = { eligible: boolean; reasons: string[]; dependencies: DependencyStatus[] }

  export type Row = {
    id: string
    project_id: string
    kind: WorkItem["kind"]
    brief: string
    delivery_mode: WorkItem["deliveryMode"]
    merge_policy: WorkItem["mergePolicy"]
    policy_provenance: string | null
    classification: string | null
    overrides: string
    dependencies: string
    resources: string
    priority: number
    not_before: number | null
    hold: string | null
    state: WorkItem["state"]
    attempt: number
    task_id: string | null
    delegated_handoff_id: string | null
    landed: string | null
    intake: string
    created_at: number
    updated_at: number
  }

  /** The caller owns the DatabaseSync, lock, and close lifecycle. */
  export function open(db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS supervisor_work_item (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('ship', 'scout')),
        brief TEXT NOT NULL,
        delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('no-mistakes', 'direct-PR', 'local-only')),
        merge_policy TEXT NOT NULL CHECK (merge_policy IN ('manual', 'auto')),
        policy_provenance TEXT,
        classification TEXT,
        overrides TEXT NOT NULL,
        dependencies TEXT NOT NULL,
        resources TEXT NOT NULL,
        priority INTEGER NOT NULL,
        not_before INTEGER,
        hold TEXT,
        state TEXT NOT NULL CHECK (state IN ('queued', 'in-flight', 'done', 'cancelled')),
        attempt INTEGER NOT NULL CHECK (attempt >= 1),
        task_id TEXT,
        delegated_handoff_id TEXT,
        landed TEXT,
        intake TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supervisor_work_attempt (
        work_id TEXT NOT NULL REFERENCES supervisor_work_item(id),
        attempt INTEGER NOT NULL,
        task_id TEXT NOT NULL UNIQUE,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        PRIMARY KEY (work_id, attempt)
      );
      CREATE INDEX IF NOT EXISTS supervisor_work_queue ON supervisor_work_item(state, priority DESC, created_at, id);
    `)
    const columns = new Set(
      (db.prepare("PRAGMA table_info(supervisor_work_item)").all() as { name: string }[]).map((column) => column.name),
    )
    if (!columns.has("delegated_handoff_id"))
      db.exec("ALTER TABLE supervisor_work_item ADD COLUMN delegated_handoff_id TEXT")
    if (!columns.has("policy_provenance")) db.exec("ALTER TABLE supervisor_work_item ADD COLUMN policy_provenance TEXT")

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

    function get(id: string): WorkItem | undefined {
      const row = db.prepare("SELECT * FROM supervisor_work_item WHERE id = ?").get(id) as Row | undefined
      return row ? fromRow(row) : undefined
    }

    function list(options?: { state?: WorkItem["state"]; projectID?: string }): WorkItem[] {
      return (
        db
          .prepare(
            `SELECT * FROM supervisor_work_item WHERE (? IS NULL OR state = ?)
        AND (? IS NULL OR project_id = ?) ORDER BY priority DESC, created_at, id`,
          )
          .all(
            options?.state ?? null,
            options?.state ?? null,
            options?.projectID ?? null,
            options?.projectID ?? null,
          ) as Row[]
      ).map(fromRow)
    }

    function enqueue(input: Intake): WorkItem {
      const normalized = normalize(input)
      validate(normalized)
      const existing = db.prepare("SELECT intake FROM supervisor_work_item WHERE id = ?").get(normalized.id) as
        | { intake: string }
        | undefined
      if (existing) {
        if (same(JSON.parse(existing.intake), normalized)) return get(normalized.id)!
        throw new Error(`Conflicting supervisor work item ID: ${normalized.id}`)
      }
      assertAcyclic(normalized.id, normalized.dependencies)
      const now = Date.now()
      db.prepare(
        `INSERT INTO supervisor_work_item
        (id, project_id, kind, brief, delivery_mode, merge_policy, policy_provenance, classification, overrides, dependencies,
         resources, priority, not_before, hold, state, attempt, intake, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, ?)`,
      ).run(
        normalized.id,
        normalized.projectID,
        normalized.kind,
        normalized.brief,
        normalized.deliveryMode,
        normalized.mergePolicy,
        normalized.policyProvenance ? JSON.stringify(normalized.policyProvenance) : null,
        normalized.classification ?? null,
        JSON.stringify(normalized.overrides),
        JSON.stringify(normalized.dependencies),
        JSON.stringify(normalized.resources),
        normalized.priority,
        normalized.notBefore ?? null,
        normalized.hold ? JSON.stringify(normalized.hold) : null,
        JSON.stringify(normalized),
        now,
        now,
      )
      return get(normalized.id)!
    }

    function update(id: string, patch: Patch): WorkItem {
      const current = requireQueued(id)
      if (
        Object.keys(patch).some(
          (key) =>
            !["brief", "classification", "overrides", "dependencies", "resources", "priority", "notBefore"].includes(
              key,
            ),
        )
      )
        throw new Error("Work intake policy and identity cannot be changed")
      const next = { ...current, ...patch }
      validate(next)
      assertAcyclic(id, next.dependencies)
      db.prepare(
        `UPDATE supervisor_work_item SET brief = ?, classification = ?, overrides = ?, dependencies = ?,
        resources = ?, priority = ?, not_before = ?, updated_at = ? WHERE id = ?`,
      ).run(
        next.brief,
        next.classification ?? null,
        JSON.stringify(next.overrides),
        JSON.stringify(next.dependencies),
        JSON.stringify(next.resources),
        next.priority,
        next.notBefore ?? null,
        Date.now(),
        id,
      )
      return get(id)!
    }

    function hold(id: string, value: { reason: string; until?: number }): WorkItem {
      requireOpen(id)
      validateHold(value)
      db.prepare("UPDATE supervisor_work_item SET hold = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(value),
        Date.now(),
        id,
      )
      return get(id)!
    }

    /** This ownership marker survives ordinary holds and prevents local dispatch during a remote handoff. */
    function delegate(id: string, handoffID: string): WorkItem {
      const item = requireQueued(id)
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(handoffID)) throw new Error("Invalid handoff ID")
      if (item.hold) throw new Error(`Work item is already held: ${id}`)
      db.prepare("UPDATE supervisor_work_item SET delegated_handoff_id = ?, hold = ?, updated_at = ? WHERE id = ?").run(
        handoffID,
        JSON.stringify({ reason: `Delegate handoff ${handoffID}` }),
        Date.now(),
        id,
      )
      return get(id)!
    }

    function release(id: string): WorkItem {
      requireOpen(id)
      db.prepare("UPDATE supervisor_work_item SET hold = NULL, updated_at = ? WHERE id = ?").run(Date.now(), id)
      return get(id)!
    }

    function cancel(id: string): WorkItem {
      requireQueued(id)
      db.prepare("UPDATE supervisor_work_item SET state = 'cancelled', updated_at = ? WHERE id = ?").run(Date.now(), id)
      return get(id)!
    }

    function markStarted(input: { id: string; taskID: string; attempt?: number }): WorkItem {
      return transaction(() => {
        const item = requireQueued(input.id)
        if (input.attempt !== undefined && input.attempt !== item.attempt) throw new Error("Work attempt changed")
        if (!input.taskID) throw new Error("Native task ID is required")
        const ready = readiness(input.id)
        if (!ready.eligible) throw new Error(`Work item is not ready: ${ready.reasons.join(", ")}`)
        const now = Date.now()
        db.prepare(
          `INSERT INTO supervisor_work_attempt (work_id, attempt, task_id, started_at) VALUES (?, ?, ?, ?)`,
        ).run(input.id, item.attempt, input.taskID, now)
        db.prepare("UPDATE supervisor_work_item SET state = 'in-flight', task_id = ?, updated_at = ? WHERE id = ?").run(
          input.taskID,
          now,
          input.id,
        )
        return get(input.id)!
      })
    }

    function finish(id: string): WorkItem {
      return transaction(() => {
        const item = requireItem(id)
        if (item.state === "done") return item
        if (item.state !== "in-flight") throw new Error(`Work item is not in flight: ${id}`)
        const now = Date.now()
        db.prepare("UPDATE supervisor_work_attempt SET completed_at = ? WHERE work_id = ? AND attempt = ?").run(
          now,
          id,
          item.attempt,
        )
        db.prepare("UPDATE supervisor_work_item SET state = 'done', updated_at = ? WHERE id = ?").run(now, id)
        return get(id)!
      })
    }

    /** A delegated work item has no local native attempt. Only a matching handoff hold can settle it. */
    function settleDelegated(input: { id: string; handoffID: string; landed?: Schema.Json }): WorkItem {
      return transaction(() => {
        const item = requireItem(input.id)
        if (item.state === "done") {
          if (item.delegatedHandoffID !== input.handoffID)
            throw new Error(`Work item was not settled by handoff ${input.handoffID}: ${input.id}`)
          if (item.landed === undefined && input.landed === undefined) return item
          if (item.landed !== undefined && input.landed !== undefined && same(item.landed, input.landed)) return item
          throw new Error(`Conflicting delegated landing evidence: ${input.id}`)
        }
        if (item.state !== "queued" || item.delegatedHandoffID !== input.handoffID)
          throw new Error(`Work item is not held for handoff ${input.handoffID}: ${input.id}`)
        db.prepare("UPDATE supervisor_work_item SET state = 'done', landed = ?, updated_at = ? WHERE id = ?").run(
          input.landed === undefined ? null : JSON.stringify(input.landed),
          Date.now(),
          input.id,
        )
        return get(input.id)!
      })
    }

    /** Only a handoff with proof that its destination work is terminal cancelled may call this. */
    function settleDelegatedCancelled(input: { id: string; handoffID: string }): WorkItem {
      const item = requireItem(input.id)
      if (item.delegatedHandoffID !== input.handoffID)
        throw new Error(`Work item is not delegated to handoff ${input.handoffID}: ${input.id}`)
      if (item.state === "cancelled") return item
      if (item.state !== "queued") throw new Error(`Delegated work is not queued: ${input.id}`)
      db.prepare("UPDATE supervisor_work_item SET state = 'cancelled', updated_at = ? WHERE id = ?").run(
        Date.now(),
        input.id,
      )
      return get(input.id)!
    }

    /** Call only after native cancellation has settled; hold alone does not interrupt execution. */
    function settleCancelled(id: string): WorkItem {
      return transaction(() => {
        const item = requireItem(id)
        if (item.state === "cancelled") return item
        if (item.state !== "in-flight") throw new Error(`Work item is not in flight: ${id}`)
        const now = Date.now()
        db.prepare("UPDATE supervisor_work_attempt SET completed_at = ? WHERE work_id = ? AND attempt = ?").run(
          now,
          id,
          item.attempt,
        )
        db.prepare("UPDATE supervisor_work_item SET state = 'cancelled', updated_at = ? WHERE id = ?").run(now, id)
        return get(id)!
      })
    }

    function markLanded(id: string, evidence: Schema.Json): WorkItem {
      const item = requireItem(id)
      if (item.delegatedHandoffID)
        throw new Error(`Work item is delegated to handoff ${item.delegatedHandoffID}: ${id}`)
      if (item.state !== "done") throw new Error(`Work item is not done: ${id}`)
      if (item.landed !== undefined) {
        if (same(item.landed, evidence)) return item
        throw new Error(`Conflicting landing evidence for work item: ${id}`)
      }
      db.prepare("UPDATE supervisor_work_item SET landed = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(evidence),
        Date.now(),
        id,
      )
      return get(id)!
    }

    function finishLanded(id: string, evidence: Schema.Json): WorkItem {
      return transaction(() => {
        finish(id)
        return markLanded(id, evidence)
      })
    }

    function retry(id: string): WorkItem {
      const item = requireItem(id)
      if (item.delegatedHandoffID)
        throw new Error(`Work item is delegated to handoff ${item.delegatedHandoffID}: ${id}`)
      if (item.state !== "done" && item.state !== "cancelled") throw new Error(`Work item is not terminal: ${id}`)
      if (item.landed !== undefined) throw new Error(`Landed work item cannot be retried: ${id}`)
      db.prepare(
        `UPDATE supervisor_work_item SET state = 'queued', attempt = attempt + 1,
        task_id = NULL, updated_at = ? WHERE id = ?`,
      ).run(Date.now(), id)
      return get(id)!
    }

    function attempts(id: string): Attempt[] {
      requireItem(id)
      return (
        db
          .prepare(
            `SELECT work_id, attempt, task_id, started_at, completed_at
        FROM supervisor_work_attempt WHERE work_id = ? ORDER BY attempt`,
          )
          .all(id) as {
          work_id: string
          attempt: number
          task_id: string
          started_at: number
          completed_at: number | null
        }[]
      ).map((row) => ({
        id: row.work_id,
        attempt: row.attempt,
        taskID: row.task_id,
        startedAt: row.started_at,
        completedAt: row.completed_at ?? undefined,
      }))
    }

    function readiness(id: string, options?: { now?: number; occupiedResources?: string[] }): Readiness {
      const item = requireItem(id)
      const now = options?.now ?? Date.now()
      const dependencies = item.dependencies.map((dependency) => {
        const predecessor = get(dependency.id)
        const met = dependency.when === "done" ? predecessor?.state === "done" : predecessor?.landed !== undefined
        return { ...dependency, state: predecessor?.state, landed: predecessor?.landed !== undefined, met }
      })
      const reasons = [
        ...(item.state === "queued" ? [] : [`state:${item.state}`]),
        ...(item.delegatedHandoffID ? [`delegated:${item.delegatedHandoffID}`] : []),
        ...(item.notBefore !== undefined && item.notBefore > now ? ["not-before"] : []),
        ...(isHeld(id, { now }) ? ["held"] : []),
        ...dependencies
          .filter((dependency) => !dependency.met)
          .map((dependency) => `dependency:${dependency.id}:${dependency.when}`),
        ...item.resources
          .filter((resource) => options?.occupiedResources?.includes(resource))
          .map((resource) => `resource:${resource}`),
      ]
      return { eligible: reasons.length === 0, reasons, dependencies }
    }

    function isHeld(id: string, options?: { now?: number }): boolean {
      const hold = requireItem(id).hold
      return Boolean(hold && (hold.until === undefined || hold.until > (options?.now ?? Date.now())))
    }

    function eligible(options?: { now?: number; occupiedResources?: string[] }): WorkItem[] {
      return list({ state: "queued" }).filter((item) => readiness(item.id, options).eligible)
    }

    /** create inserts a native task and its first outbox obligation on this same connection. */
    function dispatch(id: string, create: (item: WorkItem) => string): WorkItem {
      db.exec("SAVEPOINT supervisor_backlog_dispatch")
      try {
        const item = requireQueued(id)
        const result = readiness(id)
        if (!result.eligible) throw new Error(`Work item is not ready: ${result.reasons.join(", ")}`)
        const taskID = create(item)
        const started = markStarted({ id, taskID, attempt: item.attempt })
        db.exec("RELEASE supervisor_backlog_dispatch")
        return started
      } catch (error) {
        db.exec("ROLLBACK TO supervisor_backlog_dispatch")
        db.exec("RELEASE supervisor_backlog_dispatch")
        throw error
      }
    }

    function requireItem(id: string): WorkItem {
      const item = get(id)
      if (!item) throw new Error(`Unknown supervisor work item: ${id}`)
      return item
    }

    function requireQueued(id: string): WorkItem {
      const item = requireItem(id)
      if (item.delegatedHandoffID)
        throw new Error(`Work item is delegated to handoff ${item.delegatedHandoffID}: ${id}`)
      if (item.state !== "queued") throw new Error(`Work item is not queued: ${id}`)
      return item
    }

    function requireOpen(id: string): WorkItem {
      const item = requireItem(id)
      if (item.delegatedHandoffID)
        throw new Error(`Work item is delegated to handoff ${item.delegatedHandoffID}: ${id}`)
      if (item.state !== "queued" && item.state !== "in-flight") throw new Error(`Work item is terminal: ${id}`)
      return item
    }

    function assertAcyclic(id: string, dependencies: Dependency[]) {
      const graph = new Map(
        (
          db.prepare("SELECT id, dependencies FROM supervisor_work_item").all() as {
            id: string
            dependencies: string
          }[]
        ).map((row) => [row.id, JSON.parse(row.dependencies) as Dependency[]]),
      )
      graph.set(id, dependencies)
      const visiting = new Set<string>()
      const visited = new Set<string>()
      function visit(node: string) {
        if (visiting.has(node)) throw new Error(`Supervisor work dependency cycle at ${node}`)
        if (visited.has(node)) return
        visiting.add(node)
        graph.get(node)?.forEach((dependency) => visit(dependency.id))
        visiting.delete(node)
        visited.add(node)
      }
      graph.forEach((_, node) => visit(node))
    }

    return {
      list,
      get,
      enqueue,
      update,
      hold,
      delegate,
      release,
      cancel,
      markStarted,
      finish,
      settleDelegated,
      settleDelegatedCancelled,
      settleCancelled,
      markLanded,
      finishLanded,
      retry,
      attempts,
      readiness,
      isHeld,
      eligible,
      dispatch,
    }
  }
}

function normalize(input: SupervisorBacklog.Intake) {
  return {
    id: input.id,
    projectID: input.projectID,
    kind: input.kind,
    brief: input.brief,
    deliveryMode: input.deliveryMode,
    mergePolicy: input.mergePolicy,
    policyProvenance: input.policyProvenance,
    classification: input.classification,
    overrides: input.overrides ?? {},
    dependencies: input.dependencies ?? [],
    resources: input.resources ?? [],
    priority: input.priority ?? 0,
    notBefore: input.notBefore,
    hold: input.hold,
  }
}

function validate(
  item: SupervisorBacklog.Intake & {
    overrides: SupervisorBacklog.Overrides
    dependencies: SupervisorBacklog.Dependency[]
    resources: string[]
    priority: number
  },
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(item.id))
    throw new Error("Work item ID must be at most 80 letters, digits, hyphens, or underscores")
  if (!item.projectID || !item.brief) throw new Error("Work item requires a project and brief")
  if (!["ship", "scout"].includes(item.kind)) throw new Error("Invalid work kind")
  if (!["no-mistakes", "direct-PR", "local-only"].includes(item.deliveryMode)) throw new Error("Invalid delivery mode")
  if (!["manual", "auto"].includes(item.mergePolicy)) throw new Error("Invalid merge policy")
  if (
    item.policyProvenance &&
    (!["captain", "registry"].includes(item.policyProvenance.source) ||
      !item.policyProvenance.reference ||
      Number.isNaN(Date.parse(item.policyProvenance.capturedAt)))
  )
    throw new Error("Invalid policy provenance")
  if (!Number.isSafeInteger(item.priority)) throw new Error("Priority must be an integer")
  if (item.notBefore !== undefined && (!Number.isSafeInteger(item.notBefore) || item.notBefore < 0))
    throw new Error("Invalid not-before time")
  if (item.hold) validateHold(item.hold)
  if (item.dependencies.some((dependency) => !dependency.id || !["done", "landed"].includes(dependency.when)))
    throw new Error("Invalid work dependency")
  if (new Set(item.dependencies.map((dependency) => dependency.id)).size !== item.dependencies.length)
    throw new Error("Duplicate work dependency")
  if (item.resources.some((resource) => !resource) || new Set(item.resources).size !== item.resources.length)
    throw new Error("Invalid or duplicate work resource")
  if (item.overrides.model && (!item.overrides.model.providerID || !item.overrides.model.modelID))
    throw new Error("Invalid model override")
  if (
    item.overrides.permissions?.some(
      (permission) =>
        !permission.action || !permission.resource || !["allow", "deny", "ask"].includes(permission.effect),
    )
  )
    throw new Error("Invalid permission override")
}

function validateHold(value: { reason: string; until?: number }) {
  if (!value.reason || (value.until !== undefined && (!Number.isSafeInteger(value.until) || value.until < 0)))
    throw new Error("Invalid work hold")
}

function same(left: unknown, right: unknown) {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)))
}

function fromRow(row: SupervisorBacklog.Row): SupervisorBacklog.WorkItem {
  return {
    id: row.id,
    projectID: row.project_id,
    kind: row.kind,
    brief: row.brief,
    deliveryMode: row.delivery_mode,
    mergePolicy: row.merge_policy,
    policyProvenance: row.policy_provenance
      ? JSON.parse(row.policy_provenance)
      : {
          source: "registry",
          reference: `project:${row.project_id}`,
          capturedAt: new Date(row.created_at).toISOString(),
        },
    classification: row.classification ?? undefined,
    overrides: JSON.parse(row.overrides),
    dependencies: JSON.parse(row.dependencies),
    resources: JSON.parse(row.resources),
    priority: row.priority,
    notBefore: row.not_before ?? undefined,
    hold: row.hold ? JSON.parse(row.hold) : undefined,
    state: row.state,
    attempt: row.attempt,
    taskID: row.task_id ?? undefined,
    delegatedHandoffID: row.delegated_handoff_id ?? undefined,
    landed: row.landed ? JSON.parse(row.landed) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
