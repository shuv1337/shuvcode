// Session-goal service: per-Session serialization, storage orchestration,
// ownership, restart recovery, tool operations, context rendering, and the
// durable-event consumer's fold-and-effect loop.

import { CONTINUATION_TEXT, SOURCE, renderGoalContext, renderStatus } from "./prompt"
import type { FoldInput, GoalLimits, GoalRecord, GoalState, StepFlags, TokenCounts } from "./state"
import {
  BOUNDS,
  bindingLimit,
  blockGoal,
  completeGoal,
  createGoal,
  foldEvent,
  limitGoal,
  pauseGoal,
  resumeWindow,
  truncate,
  validateClaim,
  validateDefinition,
} from "./state"
import type { LedgerEntry, OwnerInfo, Shard } from "./storage"
import {
  PersistenceError,
  acquireOwner,
  appendLedger,
  loadRecord,
  persistRecord,
  releaseOwner,
  removeState,
  shardFor,
  takeoverOwner,
} from "./storage"

export interface GoalOptions {
  readonly command: string
  readonly limits: GoalLimits
  readonly persistence: { readonly enabled: boolean; readonly root?: string }
}

export type GoalResultCode =
  | "ok"
  | "no_goal"
  | "goal_exists"
  | "invalid_transition"
  | "invalid_input"
  | "evidence_rejected"
  | "owned_elsewhere"
  | "persistence_failed"

export interface GoalToolResult {
  readonly version: 1
  readonly ok: boolean
  readonly code: GoalResultCode
  readonly state?: GoalState | "none"
  readonly data?: unknown
  readonly message: string
}

export interface ServicePorts {
  readonly options: GoalOptions
  readonly owner: OwnerInfo
  readonly now: () => number
  readonly session: {
    readonly get: (input: { sessionID: string }) => Promise<{ location: { directory: string } }>
    readonly synthetic: (input: {
      id?: string
      sessionID: string
      text: string
      description?: string
      metadata?: { [key: string]: string | number | boolean }
      delivery?: "steer" | "queue"
      resume?: boolean
    }) => Promise<unknown>
  }
  readonly log: (message: string, data: Record<string, unknown>) => void
}

interface Slot {
  readonly sessionID: string
  shard?: Shard
  record?: GoalRecord
  loaded: boolean
  broken?: "corrupt" | "version" | "io" | "unsafe"
  contended: boolean
  owned: boolean
  flags: StepFlags
}

export interface GoalService {
  readonly set: (sessionID: string, input: unknown) => Promise<GoalToolResult>
  readonly status: (sessionID: string) => Promise<GoalToolResult>
  readonly pause: (sessionID: string) => Promise<GoalToolResult>
  readonly resume: (sessionID: string, input: unknown) => Promise<GoalToolResult>
  readonly block: (sessionID: string, input: unknown) => Promise<GoalToolResult>
  readonly complete: (sessionID: string, input: unknown) => Promise<GoalToolResult>
  readonly clear: (sessionID: string) => Promise<GoalToolResult>
  readonly context: (sessionID: string) => Promise<string | undefined>
  readonly handleEvent: (event: unknown) => Promise<void>
  readonly dispose: () => Promise<void>
}

export function createGoalService(ports: ServicePorts): GoalService {
  const slots = new Map<string, Slot>()
  const queues = new Map<string, Promise<unknown>>()
  const persistence = ports.options.persistence.enabled

  const enqueue = <T>(sessionID: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(sessionID) ?? Promise.resolve()
    const next = previous.then(work, work)
    queues.set(
      sessionID,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  const slotFor = (sessionID: string): Slot => {
    const existing = slots.get(sessionID)
    if (existing) return existing
    const slot: Slot = { sessionID, loaded: false, contended: false, owned: false, flags: { toolSuccess: false } }
    slots.set(sessionID, slot)
    return slot
  }

  const resolveShard = async (slot: Slot): Promise<Shard | undefined> => {
    if (!persistence) return undefined
    if (slot.shard) return slot.shard
    const session = await ports.session.get({ sessionID: slot.sessionID })
    const configured = ports.options.persistence.root
    const root =
      configured === undefined
        ? joinPath(session.location.directory, ".opencode/goals/v2")
        : configured.startsWith("/")
          ? configured
          : joinPath(session.location.directory, configured)
    slot.shard = shardFor(root, slot.sessionID)
    return slot.shard
  }

  const ensureOwned = async (slot: Slot): Promise<boolean> => {
    if (!persistence) return true
    const shard = await resolveShard(slot)
    if (!shard) return true
    const status = await acquireOwner(shard, ports.owner).catch(() => "contended" as const)
    if (status === "owned") {
      slot.owned = true
      slot.contended = false
      return true
    }
    slot.contended = true
    return false
  }

  /** Load once per generation, applying restart recovery to active records. */
  const ready = async (slot: Slot): Promise<void> => {
    if (slot.loaded) return
    if (!persistence) {
      slot.loaded = true
      return
    }
    const shard = await resolveShard(slot).catch(() => undefined)
    if (!shard) {
      slot.broken = "io"
      slot.loaded = true
      return
    }
    const loaded = await loadRecord(shard).catch((error: unknown) => {
      slot.broken = error instanceof PersistenceError ? error.reason : "io"
      return undefined
    })
    slot.loaded = true
    if (!loaded) return
    if (loaded.status === "missing") return
    if (loaded.status === "corrupt" || loaded.status === "version") {
      slot.broken = loaded.status
      return
    }
    slot.record = loaded.record
    if (loaded.record.state !== "active") return
    // Restart recovery: an active goal from a previous generation recovers as
    // paused; a reserved continuation is never retried automatically.
    if (!(await ensureOwned(slot))) return
    const paused = pauseGoal(loaded.record, "restart_recovery", "plugin restarted", ports.now())
    await persist(slot, paused, entryFor(loaded.record, paused))
  }

  const persist = async (slot: Slot, record: GoalRecord, entry?: LedgerEntry): Promise<boolean> => {
    const previous = slot.record
    slot.record = record
    if (!persistence) return true
    if (!(await ensureOwned(slot))) {
      slot.record = previous
      return false
    }
    const shard = slot.shard
    if (!shard) return false
    const written = await persistRecord(shard, record, entry).then(
      () => true,
      (error: unknown) => {
        ports.log("goal.persistence.failed", { sessionID: slot.sessionID, error: String(error) })
        return false
      },
    )
    if (written) return true
    // Persistence failure pauses in memory and schedules nothing further.
    if (record.state === "active")
      slot.record = pauseGoal(record, "persistence_failed", "goal state write failed", ports.now())
    slot.broken = "io"
    return false
  }

  const logTransition = (before: GoalRecord | undefined, after: GoalRecord) => {
    if (before?.state === after.state) return
    ports.log("goal.lifecycle", {
      sessionID: after.sessionID,
      goalID: after.goalID,
      from: before?.state ?? "none",
      to: after.state,
      code: after.history.at(-1)?.code ?? "",
    })
  }

  const guard = async (slot: Slot): Promise<GoalToolResult | undefined> => {
    await ready(slot)
    if (slot.broken === "corrupt" || slot.broken === "version" || slot.broken === "unsafe")
      return failure("persistence_failed", `Goal state is unreadable (${slot.broken}); the file was left untouched.`)
    return undefined
  }

  const set = (sessionID: string, input: unknown) =>
    enqueue(sessionID, async (): Promise<GoalToolResult> => {
      const slot = slotFor(sessionID)
      const broken = await guard(slot)
      if (broken) return broken
      if (slot.record && slot.record.state !== "completed")
        return failure(
          "goal_exists",
          `A goal is already ${slot.record.state}. Clear it with goal_clear before starting another.`,
          slot.record.state,
        )
      const definition = validateDefinition(input)
      if (!definition.value) return invalid(definition.problems)
      if (!(await ensureOwned(slot))) return ownedElsewhere()
      const session = persistence ? await ports.session.get({ sessionID }) : undefined
      const record = createGoal({
        sessionID,
        location: session?.location.directory ?? "",
        definition: definition.value,
        limits: ports.options.limits,
        now: ports.now(),
      })
      const before = slot.record
      if (!(await persist(slot, record, entryFor(undefined, record)))) return persistFailure()
      logTransition(before, record)
      return success(record, ports.now(), `Goal set: ${truncate(record.objective, 200)}`)
    })

  const status = (sessionID: string) =>
    enqueue(sessionID, async (): Promise<GoalToolResult> => {
      const slot = slotFor(sessionID)
      const broken = await guard(slot)
      if (broken) return broken
      const record = slot.record
      if (!record)
        return { version: 1, ok: true, code: "no_goal", state: "none", message: "No goal is set for this session." }
      return success(record, ports.now(), renderStatus(record, ports.now()))
    })

  const pause = (sessionID: string) =>
    enqueue(sessionID, async (): Promise<GoalToolResult> => {
      const slot = slotFor(sessionID)
      const broken = await guard(slot)
      if (broken) return broken
      const record = slot.record
      if (!record) return failure("no_goal", "No goal is set for this session.")
      if (record.state !== "active")
        return failure("invalid_transition", `Only an active goal can be paused; this goal is ${record.state}.`, record.state)
      if (!(await ensureOwned(slot))) return ownedElsewhere()
      const paused = pauseGoal(record, "user_pause", "paused by user", ports.now())
      if (!(await persist(slot, paused, entryFor(record, paused)))) return persistFailure()
      logTransition(record, paused)
      return success(paused, ports.now(), "Goal paused. Resume with goal_resume.")
    })

  const resume = (sessionID: string, input: unknown) =>
    enqueue(sessionID, async (): Promise<GoalToolResult> => {
      const slot = slotFor(sessionID)
      const options = isRecord(input) ? input : {}
      if (options.takeover === true && persistence) {
        const shard = await resolveShard(slot).catch(() => undefined)
        if (shard) {
          await takeoverOwner(shard, ports.owner).catch(() => undefined)
          slot.owned = true
          slot.contended = false
          slot.loaded = false
          slot.record = undefined
          slot.broken = undefined
        }
      }
      const broken = await guard(slot)
      if (broken) return broken
      const record = slot.record
      if (!record) return failure("no_goal", "No goal is set for this session.")
      if (record.state === "completed")
        return failure("invalid_transition", "Completed work cannot be resumed. Start a new goal with goal_set.", record.state)
      if (record.state === "active")
        return failure("invalid_transition", "The goal is already active.", record.state)
      if (!(await ensureOwned(slot)))
        return failure(
          "owned_elsewhere",
          "Another process owns this goal. Stop it, or call goal_resume with takeover: true to take over explicitly.",
        )
      const limits = mergeLimits(ports.options.limits, options.limits)
      if (typeof limits === "string") return invalid([limits])
      const resumed = resumeWindow(record, limits, ports.now())
      if (!(await persist(slot, resumed, entryFor(record, resumed)))) return persistFailure()
      logTransition(record, resumed)
      return success(resumed, ports.now(), "Goal resumed with a fresh Window.")
    })

  const block = (sessionID: string, input: unknown) =>
    enqueue(sessionID, async (): Promise<GoalToolResult> => {
      const slot = slotFor(sessionID)
      const broken = await guard(slot)
      if (broken) return broken
      const record = slot.record
      if (!record) return failure("no_goal", "No goal is set for this session.")
      if (record.state !== "active")
        return failure("invalid_transition", `Only an active goal can be blocked; this goal is ${record.state}.`, record.state)
      const blocker = validateBlocker(input, record)
      if (typeof blocker === "string") return invalid([blocker])
      if (!(await ensureOwned(slot))) return ownedElsewhere()
      const blocked = blockGoal(record, blocker, ports.now())
      if (!(await persist(slot, blocked, entryFor(record, blocked)))) return persistFailure()
      logTransition(record, blocked)
      return success(blocked, ports.now(), "Goal blocked. It will not continue until a user resumes or clears it.")
    })

  const complete = (sessionID: string, input: unknown) =>
    enqueue(sessionID, async (): Promise<GoalToolResult> => {
      const slot = slotFor(sessionID)
      const broken = await guard(slot)
      if (broken) return broken
      const record = slot.record
      if (!record) return failure("no_goal", "No goal is set for this session.")
      if (record.state !== "active")
        return failure("invalid_transition", `Only an active goal can be completed; this goal is ${record.state}.`, record.state)
      const validated = validateClaim(record, input)
      if (!validated.claim)
        return {
          version: 1,
          ok: false,
          code: "evidence_rejected",
          state: record.state,
          data: { problems: validated.problems },
          message: `Completion rejected:\n${validated.problems.map((problem) => `- ${problem}`).join("\n")}`,
        }
      if (!(await ensureOwned(slot))) return ownedElsewhere()
      const completed = completeGoal(record, validated.claim, ports.now())
      if (!(await persist(slot, completed, entryFor(record, completed)))) return persistFailure()
      logTransition(record, completed)
      return success(completed, ports.now(), `Goal completed: ${truncate(validated.claim.summary, 300)}`)
    })

  const clear = (sessionID: string) =>
    enqueue(sessionID, async (): Promise<GoalToolResult> => {
      const slot = slotFor(sessionID)
      await ready(slot)
      if (!slot.record && !slot.broken)
        return failure("no_goal", "No goal is set for this session.")
      if (!(await ensureOwned(slot))) return ownedElsewhere()
      const record = slot.record
      if (persistence && slot.shard) {
        if (record)
          await appendLedger(slot.shard, {
            at: ports.now(),
            goalID: record.goalID,
            from: record.state,
            to: "none",
            code: "cleared",
          }).catch(() => undefined)
        await removeState(slot.shard).catch(() => undefined)
      }
      if (record) ports.log("goal.lifecycle", { sessionID, goalID: record.goalID, from: record.state, to: "none", code: "cleared" })
      slot.record = undefined
      slot.broken = undefined
      slot.owned = false
      return { version: 1, ok: true, code: "ok", state: "none", message: "Goal cleared." }
    })

  const context = (sessionID: string) =>
    enqueue(sessionID, async (): Promise<string | undefined> => {
      const slot = slotFor(sessionID)
      await ready(slot)
      const record = slot.record
      if (!record) return undefined
      return renderGoalContext(record, ports.now())
    })

  const handleEvent = async (event: unknown): Promise<void> => {
    const wire = narrowEvent(event)
    if (!wire) return
    const slot = slots.get(wire.sessionID)
    if (!slot?.record || slot.contended) return
    await enqueue(wire.sessionID, () => applyEvent(slot, wire))
  }

  const applyEvent = async (slot: Slot, wire: WireEvent): Promise<void> => {
    const record = slot.record
    if (!record) return
    if (wire.type === "session.tool.success") {
      slot.flags.toolSuccess = true
      return
    }
    const input = foldInputFor(wire)
    if (!input) return
    const folded = foldEvent(record, input, ports.now(), slot.flags)
    if (input.type === "step.ended") slot.flags = { toolSuccess: false }
    if (folded.effects.length === 0) {
      slot.record = folded.record
      return
    }
    if (folded.effects.includes("delete")) {
      if (persistence && slot.shard) await removeState(slot.shard).catch(() => undefined)
      slots.delete(slot.sessionID)
      return
    }
    const entry = entryFor(record, folded.record)
    if (!(await persist(slot, folded.record, entry))) return
    logTransition(record, folded.record)
    if (folded.record.state === "limited") {
      const binding = bindingLimit(record, ports.now())
      ports.log("goal.limit", {
        sessionID: slot.sessionID,
        goalID: folded.record.goalID,
        limit: binding?.limit ?? "unknown",
        used: binding?.used ?? 0,
        maximum: binding?.maximum ?? 0,
      })
    }
    if (folded.effects.includes("reserve")) await admitContinuation(slot)
  }

  const admitContinuation = async (slot: Slot): Promise<void> => {
    const record = slot.record
    const reservation = record?.execution.reservation
    if (!record || !reservation) return
    const admitted = await ports.session
      .synthetic({
        id: reservation.inputID,
        sessionID: slot.sessionID,
        text: CONTINUATION_TEXT,
        description: "Goal continuation",
        metadata: {
          source: SOURCE,
          goalID: record.goalID,
          windowID: record.window.id,
          sourceExecutionEventID: reservation.sourceExecutionEventID,
          sourceExecutionSeq: reservation.sourceExecutionSeq,
          continuation: record.window.continuations,
        },
        delivery: "queue",
        resume: true,
      })
      .then(
        () => true,
        (error: unknown) => {
          ports.log("goal.continuation.failed", { sessionID: slot.sessionID, error: String(error) })
          return false
        },
      )
    const current = slot.record
    if (!current?.execution.reservation) return
    const next = structuredClone(current)
    if (admitted) {
      next.execution.reservation!.status = "admitted"
      await persist(slot, next)
      ports.log("goal.continuation", {
        sessionID: slot.sessionID,
        goalID: next.goalID,
        ordinal: next.window.continuations,
        sourceEventID: reservation.sourceExecutionEventID,
        status: "admitted",
      })
      return
    }
    next.execution.reservation = undefined
    next.window.promptFailures += 1
    const binding = bindingLimit(next, ports.now())
    const limited = binding?.limit === "promptFailures" ? limitGoal(next, binding, ports.now()) : next
    await persist(slot, limited, limited === next ? undefined : entryFor(current, limited))
    logTransition(current, limited)
  }

  const dispose = async (): Promise<void> => {
    await Promise.all(Array.from(queues.values()))
    if (!persistence) return
    await Promise.all(
      Array.from(slots.values())
        .filter((slot) => slot.owned && slot.shard)
        .map((slot) => releaseOwner(slot.shard!, ports.owner).catch(() => undefined)),
    )
  }

  return { set, status, pause, resume, block, complete, clear, context, handleEvent, dispose }
}

// --- Supporting details ---------------------------------------------------

interface WireEvent {
  readonly type: string
  readonly id: string
  readonly seq: number
  readonly sessionID: string
  readonly data: Record<string, unknown>
}

function narrowEvent(event: unknown): WireEvent | undefined {
  if (typeof event !== "object" || event === null) return undefined
  const wire = event as { type?: unknown; id?: unknown; data?: unknown; durable?: { seq?: unknown } }
  if (typeof wire.type !== "string" || !wire.type.startsWith("session.")) return undefined
  if (typeof wire.id !== "string") return undefined
  if (typeof wire.durable?.seq !== "number") return undefined
  if (typeof wire.data !== "object" || wire.data === null) return undefined
  const data = wire.data as Record<string, unknown>
  if (typeof data.sessionID !== "string") return undefined
  return { type: wire.type, id: wire.id, seq: wire.durable.seq, sessionID: data.sessionID, data }
}

function foldInputFor(wire: WireEvent): FoldInput | undefined {
  const seq = wire.seq
  if (wire.type === "session.input.admitted") {
    const input = wire.data.input as { type?: unknown } | undefined
    const kind = input?.type === "synthetic" ? "synthetic" : input?.type === "user" ? "user" : undefined
    if (!kind || typeof wire.data.inputID !== "string") return undefined
    return { type: "input.admitted", seq, inputID: wire.data.inputID, kind }
  }
  if (wire.type === "session.input.promoted") {
    if (typeof wire.data.inputID !== "string") return undefined
    return { type: "input.promoted", seq, inputID: wire.data.inputID }
  }
  if (wire.type === "session.execution.started") return { type: "execution.started", seq }
  if (wire.type === "session.execution.succeeded") return { type: "execution.succeeded", seq, eventID: wire.id }
  if (wire.type === "session.execution.failed")
    return { type: "execution.failed", seq, detail: truncate(JSON.stringify(wire.data.error) ?? "error", 200) }
  if (wire.type === "session.execution.interrupted") {
    const reason = wire.data.reason
    if (reason !== "user" && reason !== "shutdown" && reason !== "superseded") return undefined
    return { type: "execution.interrupted", seq, reason }
  }
  if (wire.type === "session.step.ended")
    return {
      type: "step.ended",
      seq,
      tokens: tokenCounts(wire.data.tokens),
      files: Array.isArray(wire.data.files) ? wire.data.files.filter((file): file is string => typeof file === "string") : [],
    }
  if (wire.type === "session.step.failed") return { type: "step.failed", seq, tokens: tokenCounts(wire.data.tokens) }
  if (wire.type === "session.deleted") return { type: "deleted", seq }
  return undefined
}

function tokenCounts(value: unknown): TokenCounts | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const tokens = value as { input?: unknown; output?: unknown; reasoning?: unknown }
  if (typeof tokens.input !== "number" || typeof tokens.output !== "number" || typeof tokens.reasoning !== "number")
    return undefined
  return { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning }
}

function entryFor(before: GoalRecord | undefined, after: GoalRecord): LedgerEntry | undefined {
  if (before?.state === after.state) return undefined
  const latest = after.history.at(-1)
  return {
    at: after.updatedAt,
    goalID: after.goalID,
    from: before?.state ?? "none",
    to: after.state,
    code: latest?.code ?? "unknown",
    ...(latest?.detail === undefined ? {} : { detail: latest.detail }),
  }
}

function validateBlocker(input: unknown, record: GoalRecord): { reason: string; needed?: string } | string {
  if (!isRecord(input)) return "input must be an object"
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (reason.length < 10) return "reason must concretely describe the blocking dependency (at least 10 characters)"
  if (reason.length > BOUNDS.item) return `reason exceeds ${BOUNDS.item} characters`
  if (reason.trim().toLowerCase() === record.objective.trim().toLowerCase())
    return "reason must not restate the objective; describe the concrete external dependency"
  const needed = typeof input.needed === "string" ? truncate(input.needed.trim(), BOUNDS.item) : undefined
  return { reason, ...(needed ? { needed } : {}) }
}

export function mergeLimits(base: GoalLimits, input: unknown): GoalLimits | string {
  if (input === undefined) return base
  if (!isRecord(input)) return "limits must be an object"
  const merged = { ...base }
  for (const key of Object.keys(input)) {
    const field = limitField(key)
    if (!field) return `unknown limit "${key}"`
    const value = input[key]
    if (value === null) {
      merged[field] = null
      continue
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
      return `limit "${key}" must be a positive integer or null; zero never means unlimited`
    merged[field] = value
  }
  return merged
}

function limitField(key: string): keyof Mutable<GoalLimits> | undefined {
  const fields: Record<string, keyof Mutable<GoalLimits>> = {
    continuations: "continuations",
    duration_ms: "durationMs",
    tokens: "tokens",
    tool_free_steps: "toolFreeSteps",
    no_progress_steps: "noProgressSteps",
    prompt_failures: "promptFailures",
  }
  return fields[key]
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function success(record: GoalRecord, now: number, message: string): GoalToolResult {
  return { version: 1, ok: true, code: "ok", state: record.state, data: statusData(record, now), message }
}

function statusData(record: GoalRecord, now: number) {
  return {
    goalID: record.goalID,
    state: record.state,
    objective: record.objective,
    successCriteria: record.successCriteria,
    constraints: record.constraints,
    references: record.references,
    window: {
      continuations: record.window.continuations,
      steps: record.window.steps,
      tokens: record.window.tokens,
      promptFailures: record.window.promptFailures,
      limits: record.window.limits,
      elapsedMs: record.state === "active" ? Math.max(0, now - record.window.startedAt) : 0,
    },
    lifetime: record.lifetime,
    ...(record.blocker === undefined ? {} : { blocker: record.blocker }),
    ...(record.stop === undefined ? {} : { stop: record.stop }),
    ...(record.latestProgress === undefined ? {} : { latestProgress: record.latestProgress }),
    ...(record.completion === undefined ? {} : { completion: record.completion }),
  }
}

function failure(code: GoalResultCode, message: string, state?: GoalState | "none"): GoalToolResult {
  return { version: 1, ok: false, code, message, ...(state === undefined ? {} : { state }) }
}

function invalid(problems: string[]): GoalToolResult {
  return {
    version: 1,
    ok: false,
    code: "invalid_input",
    data: { problems },
    message: `Invalid input:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
  }
}

function ownedElsewhere(): GoalToolResult {
  return failure(
    "owned_elsewhere",
    "Another process owns this goal state. Ordinary chat continues to work; resolve ownership before mutating the goal.",
  )
}

function persistFailure(): GoalToolResult {
  return failure("persistence_failed", "Goal state could not be written; no further automatic work will be scheduled.")
}

function joinPath(base: string, relative: string): string {
  return `${base.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
