// Pure Session-goal domain: record shape, lifecycle transitions, limit math,
// completion-claim validation, and the durable-event fold. No IO lives here.

export type GoalState = "active" | "paused" | "blocked" | "limited" | "completed"

export interface GoalLimits {
  readonly continuations: number | null
  readonly durationMs: number | null
  readonly tokens: number | null
  readonly toolFreeSteps: number | null
  readonly noProgressSteps: number | null
  readonly promptFailures: number | null
}

export const DEFAULT_LIMITS: GoalLimits = {
  continuations: 10,
  durationMs: 900_000,
  tokens: 200_000,
  toolFreeSteps: 2,
  noProgressSteps: 2,
  promptFailures: 3,
}

export const BOUNDS = {
  objective: 4_000,
  // Sized for goal packages: a Plannotator fact sheet maps one accepted fact
  // to one success criterion and commonly exceeds twenty facts.
  criteriaCount: 40,
  referenceCount: 10,
  item: 2_000,
  claimBytes: 32 * 1024,
  checkCount: 40,
  fileCount: 200,
  filePath: 512,
  historyCount: 50,
  detail: 500,
} as const

export interface CompletionCheck {
  readonly name: string
  readonly status: "passed" | "failed" | "not_run"
  readonly detail?: string
}

export interface CompletionClaim {
  readonly summary: string
  readonly criteria: ReadonlyArray<{ readonly criterion: string; readonly evidence: string }>
  readonly checks: ReadonlyArray<CompletionCheck>
  readonly changed_files: ReadonlyArray<string>
  readonly limitations: ReadonlyArray<string>
}

export interface GoalHistoryEntry {
  at: number
  from: GoalState | "none"
  to: GoalState | "none"
  code: string
  detail?: string
}

export interface GoalWindow {
  id: string
  startedAt: number
  tokens: number
  steps: number
  continuations: number
  promptFailures: number
  stalledSteps: number
  toolFreeSteps: number
  limits: GoalLimits
}

export interface GoalReservation {
  sourceExecutionEventID: string
  sourceExecutionSeq: number
  inputID: string
  status: "reserved" | "admitted"
}

export interface GoalExecution {
  lastHandledSeq?: number
  latestUserInput?: { inputID: string; seq: number }
  /** Which promoted input is driving the current drain; stall counters apply only to continuations. */
  drive?: "user" | "continuation"
  reservation?: GoalReservation
}

export interface GoalRecord {
  version: 1
  goalID: string
  sessionID: string
  location: string
  objective: string
  successCriteria: string[]
  constraints: string[]
  /** Relative paths to goal-package documents such as a plan or fact sheet. */
  references: string[]
  state: GoalState
  mutation: number
  createdAt: number
  updatedAt: number
  blocker?: { reason: string; needed?: string }
  stop?: { code: string; detail: string; at: number }
  completion?: CompletionClaim
  latestProgress?: { at: number; detail: string }
  lifetime: { tokens: number; steps: number; continuations: number; durationMs: number }
  window: GoalWindow
  execution: GoalExecution
  history: GoalHistoryEntry[]
}

export interface GoalDefinition {
  readonly objective: string
  readonly successCriteria: string[]
  readonly constraints: string[]
  readonly references: string[]
}

export function createGoal(input: {
  sessionID: string
  location: string
  definition: GoalDefinition
  limits: GoalLimits
  now: number
}): GoalRecord {
  const record: GoalRecord = {
    version: 1,
    goalID: `goal_${crypto.randomUUID()}`,
    sessionID: input.sessionID,
    location: input.location,
    objective: input.definition.objective,
    successCriteria: input.definition.successCriteria,
    constraints: input.definition.constraints,
    references: input.definition.references,
    state: "active",
    mutation: 1,
    createdAt: input.now,
    updatedAt: input.now,
    lifetime: { tokens: 0, steps: 0, continuations: 0, durationMs: 0 },
    window: newWindow(input.limits, input.now),
    execution: {},
    history: [],
  }
  pushHistory(record, { at: input.now, from: "none", to: "active", code: "created" })
  return record
}

export function pauseGoal(record: GoalRecord, code: string, detail: string, now: number): GoalRecord {
  return transition(record, "paused", code, detail, now)
}

export function blockGoal(
  record: GoalRecord,
  blocker: { reason: string; needed?: string },
  now: number,
): GoalRecord {
  const next = transition(record, "blocked", "blocked", blocker.reason, now)
  next.blocker = blocker
  return next
}

export function completeGoal(record: GoalRecord, claim: CompletionClaim, now: number): GoalRecord {
  const next = transition(record, "completed", "completed", claim.summary, now)
  next.completion = claim
  return next
}

export interface LimitBinding {
  readonly limit: keyof GoalLimits
  readonly used: number
  readonly maximum: number
}

export function limitGoal(record: GoalRecord, binding: LimitBinding, now: number): GoalRecord {
  return transition(record, "limited", `limit_${binding.limit}`, `${binding.used} of ${binding.maximum}`, now)
}

export function resumeWindow(record: GoalRecord, limits: GoalLimits, now: number): GoalRecord {
  const next = structuredClone(record)
  next.state = "active"
  next.blocker = undefined
  next.stop = undefined
  next.window = newWindow(limits, now)
  next.execution.reservation = undefined
  next.execution.drive = undefined
  next.mutation += 1
  next.updatedAt = now
  pushHistory(next, { at: now, from: record.state, to: "active", code: "resumed" })
  return next
}

/** Which limit binds right now, if any. Evaluated only at execution boundaries. */
export function bindingLimit(record: GoalRecord, now: number): LimitBinding | undefined {
  const window = record.window
  const limits = window.limits
  const candidates: Array<LimitBinding | undefined> = [
    bound("continuations", window.continuations, limits.continuations),
    bound("tokens", window.tokens, limits.tokens),
    bound("durationMs", Math.max(0, now - window.startedAt), limits.durationMs),
    bound("toolFreeSteps", window.toolFreeSteps, limits.toolFreeSteps),
    bound("noProgressSteps", window.stalledSteps, limits.noProgressSteps),
    bound("promptFailures", window.promptFailures, limits.promptFailures),
  ]
  return candidates.find((candidate) => candidate !== undefined)
}

export interface ValidatedDefinition {
  readonly value?: GoalDefinition
  readonly problems: string[]
}

export function validateDefinition(input: unknown): ValidatedDefinition {
  if (!isRecord(input)) return { problems: ["input must be an object"] }
  const problems: string[] = []
  const objective = typeof input.objective === "string" ? input.objective.trim() : undefined
  if (!objective) problems.push("objective must be a non-empty string")
  if (objective && objective.length > BOUNDS.objective)
    problems.push(`objective exceeds ${BOUNDS.objective} characters`)
  const successCriteria = stringList(input.success_criteria, "success_criteria", BOUNDS.criteriaCount, problems)
  const constraints = stringList(input.constraints, "constraints", BOUNDS.criteriaCount, problems)
  const references = relativePaths(input.references, "references", BOUNDS.referenceCount, problems)
  if (problems.length > 0) return { problems }
  return { value: { objective: objective!, successCriteria, constraints, references }, problems: [] }
}

export interface ValidatedClaim {
  readonly claim?: CompletionClaim
  readonly problems: string[]
}

export function validateClaim(record: GoalRecord, input: unknown): ValidatedClaim {
  if (!isRecord(input)) return { problems: ["claim must be an object"] }
  const problems: string[] = []
  const summary = typeof input.summary === "string" ? input.summary.trim() : ""
  if (!summary) problems.push("summary must be a non-empty string")
  if (summary.length > BOUNDS.objective) problems.push(`summary exceeds ${BOUNDS.objective} characters`)

  const criteria = claimCriteria(input.criteria, problems)
  const checks = claimChecks(input.checks, problems)
  const files = claimFiles(input.changed_files, problems)
  const limitations = stringList(input.limitations ?? [], "limitations", BOUNDS.checkCount, problems)

  matchCriteria(record, criteria, problems)
  const failed = checks.filter((check) => check.status === "failed")
  if (failed.length > 0) problems.push(`checks failed: ${failed.map((check) => check.name).join(", ")}`)
  const notRun = checks.filter((check) => check.status === "not_run")
  if (notRun.length > 0 && limitations.length === 0)
    problems.push(`not_run checks require an explanation in limitations: ${notRun.map((check) => check.name).join(", ")}`)

  const claim: CompletionClaim = { summary, criteria, checks, changed_files: files, limitations }
  if (JSON.stringify(claim).length > BOUNDS.claimBytes)
    problems.push(`claim exceeds ${BOUNDS.claimBytes} encoded bytes`)
  if (problems.length > 0) return { problems }
  return { claim, problems: [] }
}

// --- Durable-event fold ---------------------------------------------------

export interface TokenCounts {
  readonly input: number
  readonly output: number
  readonly reasoning: number
}

export type FoldInput =
  | { type: "input.admitted"; seq: number; inputID: string; kind: "user" | "synthetic"; source?: string }
  | { type: "input.promoted"; seq: number; inputID: string }
  | { type: "execution.started"; seq: number }
  | { type: "execution.succeeded"; seq: number; eventID: string }
  | { type: "execution.failed"; seq: number; detail: string }
  | { type: "execution.interrupted"; seq: number; reason: "user" | "shutdown" | "superseded" }
  | { type: "step.ended"; seq: number; tokens?: TokenCounts; files: string[] }
  | { type: "step.failed"; seq: number; tokens?: TokenCounts }
  | { type: "deleted"; seq: number }

export interface StepFlags {
  toolSuccess: boolean
}

export type FoldEffect = "persist" | "reserve" | "delete"

export interface FoldResult {
  readonly record: GoalRecord
  readonly effects: FoldEffect[]
}

export function continuationInputID(executionEventID: string): string {
  return `msg_${executionEventID.replace(/^evt_/, "")}goal`
}

/**
 * Fold one durable Session event into the goal record. Events at or below the
 * persisted `lastHandledSeq` fence are no-ops, which makes duplicate
 * observation across plugin reloads safe. The caller owns the returned
 * effects: `persist` writes the record, `reserve` admits the recorded
 * reservation as a synthetic queued input, `delete` removes the shard.
 */
export function foldEvent(record: GoalRecord, input: FoldInput, now: number, flags: StepFlags): FoldResult {
  if (input.seq <= (record.execution.lastHandledSeq ?? -1)) return { record, effects: [] }
  if (input.type === "deleted") return { record, effects: ["delete"] }

  const draft = structuredClone(record)
  draft.execution.lastHandledSeq = input.seq

  if (input.type === "input.admitted") return foldInputAdmitted(record, draft, input)
  if (input.type === "input.promoted") return foldInputPromoted(record, draft, input)
  if (input.type === "execution.started") return { record: draft, effects: [] }
  if (input.type === "execution.succeeded") return foldExecutionSucceeded(record, draft, input, now)
  if (input.type === "execution.failed") {
    if (record.state !== "active") return { record: draft, effects: [] }
    return { record: withTransition(draft, record.state, "paused", "execution_failed", input.detail, now), effects: ["persist"] }
  }
  if (input.type === "execution.interrupted") {
    if (input.reason !== "user" || record.state !== "active") return { record: draft, effects: [] }
    return {
      record: withTransition(draft, record.state, "paused", "interrupted_by_user", "", now),
      effects: ["persist"],
    }
  }
  if (input.type === "step.ended") return foldStepEnded(draft, input, now, flags)
  accountTokens(draft, input.tokens)
  draft.window.steps += 1
  draft.lifetime.steps += 1
  return { record: draft, effects: ["persist"] }
}

// --- Supporting details ---------------------------------------------------

function foldInputAdmitted(
  record: GoalRecord,
  draft: GoalRecord,
  input: Extract<FoldInput, { type: "input.admitted" }>,
): FoldResult {
  if (input.kind === "user") {
    draft.execution.latestUserInput = { inputID: input.inputID, seq: input.seq }
    // Fence: a newer user input takes precedence over a reservation that has
    // not been admitted yet. Admitted inputs are durable; the runner orders them.
    const reservation = draft.execution.reservation
    if (reservation?.status === "reserved" && input.seq > reservation.sourceExecutionSeq)
      draft.execution.reservation = undefined
    return { record: draft, effects: ["persist"] }
  }
  const reservation = draft.execution.reservation
  if (reservation && input.inputID === reservation.inputID) {
    reservation.status = "admitted"
    return { record: draft, effects: ["persist"] }
  }
  return { record: draft, effects: [] }
}

function foldInputPromoted(
  record: GoalRecord,
  draft: GoalRecord,
  input: Extract<FoldInput, { type: "input.promoted" }>,
): FoldResult {
  const reservation = draft.execution.reservation
  if (reservation && input.inputID === reservation.inputID) {
    draft.execution.drive = "continuation"
    draft.execution.reservation = undefined
    return { record: draft, effects: ["persist"] }
  }
  if (draft.execution.latestUserInput?.inputID === input.inputID) {
    draft.execution.drive = "user"
    return { record: draft, effects: ["persist"] }
  }
  return { record: draft, effects: [] }
}

function foldExecutionSucceeded(
  record: GoalRecord,
  draft: GoalRecord,
  input: Extract<FoldInput, { type: "execution.succeeded" }>,
  now: number,
): FoldResult {
  if (record.state !== "active") return { record: draft, effects: [] }
  const binding = bindingLimit(draft, now)
  if (binding) {
    const next = withTransition(draft, record.state, "limited", `limit_${binding.limit}`, `${binding.used} of ${binding.maximum}`, now)
    return { record: next, effects: ["persist"] }
  }
  if (draft.execution.reservation) return { record: draft, effects: [] }
  draft.execution.reservation = {
    sourceExecutionEventID: input.eventID,
    sourceExecutionSeq: input.seq,
    inputID: continuationInputID(input.eventID),
    status: "reserved",
  }
  draft.window.continuations += 1
  draft.lifetime.continuations += 1
  draft.updatedAt = now
  return { record: draft, effects: ["reserve"] }
}

function foldStepEnded(
  draft: GoalRecord,
  input: Extract<FoldInput, { type: "step.ended" }>,
  now: number,
  flags: StepFlags,
): FoldResult {
  accountTokens(draft, input.tokens)
  draft.window.steps += 1
  draft.lifetime.steps += 1
  const progress = flags.toolSuccess || input.files.length > 0
  if (input.files.length > 0)
    draft.latestProgress = { at: now, detail: `changed ${input.files.slice(0, 5).join(", ")}` }
  if (progress && flags.toolSuccess && input.files.length === 0)
    draft.latestProgress = { at: now, detail: "tool completed successfully" }
  // Stall detection is scoped to plugin continuations; an ordinary
  // user-requested explanatory Step must not pause the goal.
  if (draft.execution.drive === "continuation") {
    draft.window.toolFreeSteps = flags.toolSuccess ? 0 : draft.window.toolFreeSteps + 1
    draft.window.stalledSteps = progress ? 0 : draft.window.stalledSteps + 1
  }
  return { record: draft, effects: ["persist"] }
}

function transition(record: GoalRecord, to: GoalState, code: string, detail: string, now: number): GoalRecord {
  return withTransition(structuredClone(record), record.state, to, code, detail, now)
}

function withTransition(
  draft: GoalRecord,
  from: GoalState,
  to: GoalState,
  code: string,
  detail: string,
  now: number,
): GoalRecord {
  if (from === "active" && to !== "active")
    draft.lifetime.durationMs += Math.max(0, now - draft.window.startedAt)
  draft.state = to
  draft.stop = to === "completed" || to === "active" ? undefined : { code, detail: truncate(detail, BOUNDS.detail), at: now }
  if (to !== "active") draft.execution.reservation = undefined
  draft.mutation += 1
  draft.updatedAt = now
  pushHistory(draft, { at: now, from, to, code, detail: detail ? truncate(detail, BOUNDS.detail) : undefined })
  return draft
}

function newWindow(limits: GoalLimits, now: number): GoalWindow {
  return {
    id: `win_${crypto.randomUUID()}`,
    startedAt: now,
    tokens: 0,
    steps: 0,
    continuations: 0,
    promptFailures: 0,
    stalledSteps: 0,
    toolFreeSteps: 0,
    limits,
  }
}

function pushHistory(record: GoalRecord, entry: GoalHistoryEntry) {
  record.history.push(entry)
  if (record.history.length > BOUNDS.historyCount)
    record.history.splice(0, record.history.length - BOUNDS.historyCount)
}

function accountTokens(draft: GoalRecord, tokens: TokenCounts | undefined) {
  if (!tokens) return
  // Cache read/write stay out: they are provider billing components, not
  // additional context tokens.
  const total = tokens.input + tokens.output + tokens.reasoning
  draft.window.tokens += total
  draft.lifetime.tokens += total
}

function bound(limit: keyof GoalLimits, used: number, maximum: number | null): LimitBinding | undefined {
  if (maximum === null) return undefined
  if (used < maximum) return undefined
  return { limit, used, maximum }
}

function claimCriteria(input: unknown, problems: string[]) {
  if (!Array.isArray(input)) {
    problems.push("criteria must be an array")
    return []
  }
  return input.flatMap((item): Array<{ criterion: string; evidence: string }> => {
    if (!isRecord(item) || typeof item.criterion !== "string" || typeof item.evidence !== "string") {
      problems.push("each criteria entry must have string criterion and evidence")
      return []
    }
    const evidence = item.evidence.trim()
    if (!evidence) problems.push(`criterion has empty evidence: ${truncate(item.criterion, 80)}`)
    if (item.criterion.length > BOUNDS.item || evidence.length > BOUNDS.item)
      problems.push(`criteria entry exceeds ${BOUNDS.item} characters`)
    return [{ criterion: item.criterion, evidence }]
  })
}

function matchCriteria(
  record: GoalRecord,
  criteria: Array<{ criterion: string; evidence: string }>,
  problems: string[],
) {
  const claimed = criteria.map((entry) => normalizeCriterion(entry.criterion))
  for (const stored of record.successCriteria) {
    const normalized = normalizeCriterion(stored)
    const count = claimed.filter((value) => value === normalized).length
    if (count === 0) problems.push(`missing evidence for criterion: ${truncate(stored, 120)}`)
    if (count > 1) problems.push(`criterion appears ${count} times: ${truncate(stored, 120)}`)
  }
  const known = new Set(record.successCriteria.map(normalizeCriterion))
  for (const entry of criteria) {
    if (!known.has(normalizeCriterion(entry.criterion)))
      problems.push(`unknown criterion: ${truncate(entry.criterion, 120)}`)
  }
}

function claimChecks(input: unknown, problems: string[]): CompletionCheck[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    problems.push("checks must be an array")
    return []
  }
  if (input.length > BOUNDS.checkCount) problems.push(`checks exceed ${BOUNDS.checkCount} entries`)
  return input.flatMap((item): CompletionCheck[] => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      (item.status !== "passed" && item.status !== "failed" && item.status !== "not_run")
    ) {
      problems.push("each check must have a name and status of passed, failed, or not_run")
      return []
    }
    const detail = typeof item.detail === "string" ? truncate(item.detail, BOUNDS.detail) : undefined
    return [{ name: truncate(item.name, 200), status: item.status, ...(detail === undefined ? {} : { detail }) }]
  })
}

function claimFiles(input: unknown, problems: string[]): string[] {
  return relativePaths(input, "changed_files", BOUNDS.fileCount, problems)
}

function relativePaths(input: unknown, field: string, maximum: number, problems: string[]): string[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    problems.push(`${field} must be an array`)
    return []
  }
  if (input.length > maximum) problems.push(`${field} exceed ${maximum} entries`)
  const paths = input.flatMap((item): string[] => {
    if (typeof item !== "string" || !item || item.length > BOUNDS.filePath) {
      problems.push(`each ${field} entry must be a non-empty bounded string`)
      return []
    }
    const normalized = item.replaceAll("\\", "/")
    const unsafe =
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.split("/").some((segment) => segment === ".." || segment === "." || segment === "")
    if (unsafe) {
      problems.push(`${field} path must be relative and normalized: ${truncate(item, 120)}`)
      return []
    }
    return [normalized]
  })
  if (new Set(paths).size !== paths.length) problems.push(`${field} must be unique`)
  return paths
}

function stringList(input: unknown, field: string, maximum: number, problems: string[]): string[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    problems.push(`${field} must be an array of strings`)
    return []
  }
  if (input.length > maximum) problems.push(`${field} exceeds ${maximum} entries`)
  return input.flatMap((item): string[] => {
    if (typeof item !== "string" || !item.trim()) {
      problems.push(`${field} entries must be non-empty strings`)
      return []
    }
    if (item.length > BOUNDS.item) {
      problems.push(`${field} entry exceeds ${BOUNDS.item} characters`)
      return []
    }
    return [item.trim()]
  })
}

function normalizeCriterion(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase()
}

export function truncate(text: string, maximum: number): string {
  if (text.length <= maximum) return text
  return `${text.slice(0, maximum - 1)}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
