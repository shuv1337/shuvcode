export * as BrowserMachine from "./machine.js"

import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import type { Browser } from "./rpc.js"
import { BrowserSkill } from "./skill.js"

/** How long one permission sync (`session.get` and, when needed, `session.update`) may take. The desktop waits 15 s. */
export const PERMISSION_SYNC_TIMEOUT_MS = 10_000

/** How long a dispatched browser command may run before it times out and is cancelled on the desktop. */
export const REQUEST_TIMEOUT_MS = 60_000

/**
 * How long an unretrieved command waits for the session's next attachment, and how long a moved or deleted session
 * stays retired. The desktop's first reconnect lands about a second after a drop.
 */
export const REPLAY_GRACE_MS = 2_000

/** How long a replayed tab command waits for the adopting desktop's first tab list. */
export const INVENTORY_GRACE_MS = 2_000

/** The browser tools and their skill, which an attachment allows together. */
export const ACCESS = [
  { action: "browser", resource: "*" },
  { action: "skill", resource: BrowserSkill.id },
] as const

/** The one `session.permissions` sync in flight for a session: grant (`allow`) or revoke the browser rules. */
export type PermissionSync = { readonly attempt: number; readonly allow: boolean }

/**
 * One session's attachment. A session absent from `sessions` has no attachment and no sync in flight.
 *
 * - `attaching`: the desktop called `attach` as `attempt`. Its grant runs after any revoke in flight (`sync`); until it
 *   succeeds, no `attached` handshake is sent and no command is dispatched.
 * - `attached`: the session allows the browser and the desktop received `attached`; commands run.
 * - `revoking`: no attachment; `sync` settles, then a revoke follows unless the session was `deleted`.
 */
export type SessionState =
  | {
      readonly status: "attaching"
      readonly attempt: number
      readonly connectionID: string
      readonly sync: PermissionSync
    }
  | {
      readonly status: "attached"
      readonly attempt: number
      readonly connectionID: string
      readonly browserState: Browser.State
      readonly pending: ReadonlyMap<string, PendingRequest>
    }
  | { readonly status: "revoking"; readonly sync: PermissionSync; readonly deleted: boolean }

export type RevokingSession = Extract<SessionState, { readonly status: "revoking" }>

type AttachingSession = Extract<SessionState, { readonly status: "attaching" }>

type AttachedSession = Extract<SessionState, { readonly status: "attached" }>

/** A command dispatched on an attachment. */
export type PendingRequest = {
  readonly command: Browser.Command
  /** The desktop fetched it, so it may have run; a close must not replay it. */
  readonly retrieved: boolean
  /** Already the replay; a second close fails it instead of parking it again. */
  readonly replayed: boolean
}

/**
 * An unretrieved command whose attachment closed, held under its original requestID for the session's next
 * attachment. Attach carries a new connectionID every time and no stable desktop id, so replay follows the session.
 */
export type ParkedRequest =
  | { readonly phase: "reconnect"; readonly sessionID: Session.ID; readonly command: Browser.Command }
  /** Adopted by `connectionID`; a tab command waits for that desktop's first tab list. */
  | {
      readonly phase: "inventory"
      readonly sessionID: Session.ID
      readonly command: Browser.Command
      readonly connectionID: string
    }

/** Every attachment of the plugin. Once `disposed`, only revokes still draining remain. */
export type ConnectionState =
  | {
      readonly status: "active"
      readonly nextAttempt: number
      readonly sessions: ReadonlyMap<Session.ID, SessionState>
      readonly parked: ReadonlyMap<string, ParkedRequest>
      /** Outstanding move or delete bans; a session with any never replays. */
      readonly retired: ReadonlyMap<Session.ID, number>
    }
  | {
      readonly status: "disposed"
      readonly nextAttempt: number
      readonly sessions: ReadonlyMap<Session.ID, RevokingSession>
    }

type ActiveState = Extract<ConnectionState, { readonly status: "active" }>

/** How an `attach` call ends: its result, or `unavailable` when the grant failed. */
export type AttachmentOutcome = "closed" | "replaced" | "unavailable"

export type RequestSettlement =
  | { readonly ok: true; readonly result: Browser.Result }
  | { readonly ok: false; readonly error: Tool.Error }

export type ConnectionEvent =
  /** `attempt` is the state's `nextAttempt`, read when the driver registered the attachment's handle. */
  | {
      readonly type: "attach.started"
      readonly sessionID: Session.ID
      readonly attempt: number
      readonly connectionID: string
    }
  /** The `attach` call ended on the desktop's side (disconnect or interrupt). */
  | { readonly type: "attach.closed"; readonly sessionID: Session.ID; readonly attempt: number }
  | { readonly type: "permissions.synced"; readonly sessionID: Session.ID; readonly attempt: number }
  | {
      readonly type: "permissions.failed"
      readonly sessionID: Session.ID
      readonly attempt: number
      readonly error: unknown
    }
  | { readonly type: "permissions.timed-out"; readonly sessionID: Session.ID; readonly attempt: number }
  | {
      readonly type: "state.updated"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly browserState: Browser.State
    }
  | {
      readonly type: "request.started"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
      readonly command: Browser.Command
      readonly replayed?: boolean
    }
  /** The desktop fetched the command through `command`. */
  | {
      readonly type: "request.retrieved"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
    }
  | {
      readonly type: "request.dispatch-failed"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
      readonly error: unknown
    }
  | {
      readonly type: "request.settled"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
      readonly outcome: Browser.Outcome
    }
  | {
      readonly type: "request.timed-out"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
    }
  /** The tool call that started the request was interrupted. */
  | {
      readonly type: "request.cancelled"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
    }
  | { readonly type: "session.moved"; readonly sessionID: Session.ID }
  | { readonly type: "session.deleted"; readonly sessionID: Session.ID }
  | {
      readonly type: "replay.expired"
      readonly sessionID: Session.ID
      readonly requestID: string
      readonly phase: ParkedRequest["phase"]
    }
  | { readonly type: "retire.expired"; readonly sessionID: Session.ID }
  | { readonly type: "disposed" }

export type TimerEvent = Extract<ConnectionEvent, { readonly type: "replay.expired" | "retire.expired" }>

export type ConnectionEffect =
  | {
      readonly type: "sync-permissions"
      readonly sessionID: Session.ID
      readonly attempt: number
      readonly allow: boolean
    }
  /** Disposes the attachment's tunnels and ends its `attach` call with `outcome`. */
  | { readonly type: "close-attachment"; readonly attempt: number; readonly outcome: AttachmentOutcome }
  | { readonly type: "emit-control"; readonly control: Browser.Control }
  /** Emits the `command` control; a failure comes back as `request.dispatch-failed`. */
  | {
      readonly type: "dispatch-command"
      readonly sessionID: Session.ID
      readonly connectionID: string
      readonly requestID: string
    }
  | { readonly type: "settle-request"; readonly requestID: string; readonly settlement: RequestSettlement }
  /** Tells the parked request's caller to run it again on `connectionID`, with `tab` from that desktop's tab list. */
  | {
      readonly type: "replay-request"
      readonly requestID: string
      readonly connectionID: string
      readonly tab: Browser.Tab | undefined
    }
  | { readonly type: "schedule"; readonly delayMs: number; readonly event: TimerEvent }
  | { readonly type: "warn"; readonly message: string; readonly error: unknown }
  /** The disposed plugin has no revoke left in flight. */
  | { readonly type: "notify-drained" }

export type ConnectionTransition = { readonly state: ConnectionState; readonly effects: readonly ConnectionEffect[] }

type SessionEvent = Exclude<ConnectionEvent, { readonly type: "disposed" }>

type Step<S extends SessionState> = {
  readonly entry: S | undefined
  readonly nextAttempt: number
  readonly effects: readonly ConnectionEffect[]
}

export function createConnectionState(): ConnectionState {
  return { status: "active", nextAttempt: 1, sessions: new Map(), parked: new Map(), retired: new Map() }
}

export function transitionConnection(state: ConnectionState, event: ConnectionEvent): ConnectionTransition {
  if (event.type === "disposed") return dispose(state)

  // A request whose attachment closed or was replaced after the tool picked it was never sent.
  if (event.type === "request.started" && !isAttachedConnection(state, event.sessionID, event.connectionID))
    return {
      state,
      effects: [
        {
          type: "settle-request",
          requestID: event.requestID,
          settlement: { ok: false, error: disconnectedBeforeDispatch() },
        },
      ],
    }

  const entry = state.sessions.get(event.sessionID)

  if (state.status === "disposed") {
    if (!entry || entry.status !== "revoking") return { state, effects: [] }
    const step = transitionRevoking(entry, event, state.nextAttempt)

    if (!step) return { state, effects: [] }
    const sessions = new Map(state.sessions)

    if (step.entry) sessions.set(event.sessionID, step.entry)

    if (!step.entry) sessions.delete(event.sessionID)

    return {
      state: { status: "disposed", nextAttempt: step.nextAttempt, sessions },
      effects: sessions.size ? step.effects : [...step.effects, { type: "notify-drained" }],
    }
  }

  const step = transitionSession(entry, event, state.nextAttempt)

  if (!step) return carryRequests(state, state, [], event)
  const sessions = new Map(state.sessions)

  if (step.entry) sessions.set(event.sessionID, step.entry)

  if (!step.entry) sessions.delete(event.sessionID)

  return carryRequests(state, { ...state, nextAttempt: step.nextAttempt, sessions }, step.effects, event)
}

function transitionSession(
  entry: SessionState | undefined,
  event: SessionEvent,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (event.type === "attach.started") return attach(entry, event, nextAttempt)

  if (!entry) return undefined

  if (entry.status === "revoking") return transitionRevoking(entry, event, nextAttempt)

  if (entry.status === "attaching") return transitionAttaching(entry, event, nextAttempt)

  return transitionAttached(entry, event, nextAttempt)
}

function attach(
  entry: SessionState | undefined,
  event: Extract<SessionEvent, { readonly type: "attach.started" }>,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (event.attempt !== nextAttempt) return undefined
  const attaching = (sync: PermissionSync): AttachingSession => ({
    status: "attaching",
    attempt: event.attempt,
    connectionID: event.connectionID,
    sync,
  })

  // A sync already in flight finishes first; the grant waits for it, so two writes never interleave.
  if (entry?.status === "attaching")
    return {
      entry: attaching(entry.sync),
      nextAttempt: nextAttempt + 1,
      effects: [{ type: "close-attachment", attempt: entry.attempt, outcome: "replaced" }],
    }

  if (entry?.status === "revoking") return { entry: attaching(entry.sync), nextAttempt: nextAttempt + 1, effects: [] }
  const sync = { attempt: nextAttempt + 1, allow: true }
  const effects: ConnectionEffect[] =
    entry?.status === "attached"
      ? [...failPending(entry), { type: "close-attachment", attempt: entry.attempt, outcome: "replaced" }]
      : []

  return {
    entry: attaching(sync),
    nextAttempt: nextAttempt + 2,
    effects: [...effects, { type: "sync-permissions", sessionID: event.sessionID, ...sync }],
  }
}

function transitionAttaching(
  entry: AttachingSession,
  event: SessionEvent,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (
    event.type === "permissions.synced" ||
    event.type === "permissions.failed" ||
    event.type === "permissions.timed-out"
  ) {
    if (event.attempt !== entry.sync.attempt) return undefined
    const warning = syncWarning(event, entry.sync)

    // The revoke that ran before this attachment settled; now grant.
    if (!entry.sync.allow) {
      const sync = { attempt: nextAttempt, allow: true }

      return {
        entry: { ...entry, sync },
        nextAttempt: nextAttempt + 1,
        effects: [...warning, { type: "sync-permissions", sessionID: event.sessionID, ...sync }],
      }
    }

    if (event.type === "permissions.synced")
      return {
        entry: {
          status: "attached",
          attempt: entry.attempt,
          connectionID: entry.connectionID,
          browserState: { tabs: [], focusedTabID: null },
          pending: new Map(),
        },
        nextAttempt,
        effects: [
          { type: "emit-control", control: { type: "attached", connectionID: entry.connectionID, version: 4 } },
        ],
      }
    // A grant that timed out may still have written its rules; revoke them.
    const sync = { attempt: nextAttempt, allow: false }

    return {
      entry: { status: "revoking", sync, deleted: false },
      nextAttempt: nextAttempt + 1,
      effects: [
        ...warning,
        { type: "close-attachment", attempt: entry.attempt, outcome: "unavailable" },
        { type: "sync-permissions", sessionID: event.sessionID, ...sync },
      ],
    }
  }

  if (
    (event.type === "attach.closed" && event.attempt === entry.attempt) ||
    event.type === "session.moved" ||
    event.type === "session.deleted"
  )
    return {
      entry: { status: "revoking", sync: entry.sync, deleted: event.type === "session.deleted" },
      nextAttempt,
      effects: [{ type: "close-attachment", attempt: entry.attempt, outcome: "closed" }],
    }

  return undefined
}

function transitionAttached(
  entry: AttachedSession,
  event: SessionEvent,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (event.type === "state.updated") return updateBrowserState(entry, event, nextAttempt)

  if (event.type === "request.started") {
    if (entry.pending.has(event.requestID)) return undefined

    const request = { command: event.command, retrieved: false, replayed: event.replayed === true }

    return {
      entry: { ...entry, pending: new Map(entry.pending).set(event.requestID, request) },
      nextAttempt,
      effects: [
        {
          type: "dispatch-command",
          sessionID: event.sessionID,
          connectionID: entry.connectionID,
          requestID: event.requestID,
        },
      ],
    }
  }

  if (event.type === "request.retrieved") {
    const request = entry.connectionID === event.connectionID ? entry.pending.get(event.requestID) : undefined

    if (!request || request.retrieved) return undefined
    const pending = new Map(entry.pending).set(event.requestID, { ...request, retrieved: true })

    return { entry: { ...entry, pending }, nextAttempt, effects: [] }
  }

  if (
    event.type === "request.dispatch-failed" ||
    event.type === "request.settled" ||
    event.type === "request.timed-out" ||
    event.type === "request.cancelled"
  ) {
    const request = entry.connectionID === event.connectionID ? entry.pending.get(event.requestID) : undefined

    if (!request) return undefined
    const pending = new Map(entry.pending)
    pending.delete(event.requestID)

    return { entry: { ...entry, pending }, nextAttempt, effects: settleRequest(entry, event, request.command) }
  }

  if (event.type === "session.deleted")
    return {
      entry: undefined,
      nextAttempt,
      effects: [...failPending(entry), { type: "close-attachment", attempt: entry.attempt, outcome: "closed" }],
    }

  if ((event.type === "attach.closed" && event.attempt === entry.attempt) || event.type === "session.moved")
    return revokeAttached(entry, event.sessionID, nextAttempt)

  return undefined
}

function transitionRevoking(
  entry: RevokingSession,
  event: SessionEvent,
  nextAttempt: number,
): Step<RevokingSession> | undefined {
  if (event.type === "session.deleted")
    return entry.deleted ? undefined : { entry: { ...entry, deleted: true }, nextAttempt, effects: [] }

  if (
    event.type !== "permissions.synced" &&
    event.type !== "permissions.failed" &&
    event.type !== "permissions.timed-out"
  )
    return undefined

  if (event.attempt !== entry.sync.attempt) return undefined
  const warning = syncWarning(event, entry.sync)

  // A grant settled after its attachment closed, or timed out and may still have written: revoke it.
  if (entry.sync.allow && !entry.deleted) {
    const sync = { attempt: nextAttempt, allow: false }

    return {
      entry: { status: "revoking", sync, deleted: false },
      nextAttempt: nextAttempt + 1,
      effects: [...warning, { type: "sync-permissions", sessionID: event.sessionID, ...sync }],
    }
  }

  return { entry: undefined, nextAttempt, effects: warning }
}

function dispose(state: ConnectionState): ConnectionTransition {
  if (state.status === "disposed") return { state, effects: [] }
  const unsent = Array.from(state.sessions.values()).flatMap((entry) =>
    entry.status === "attached"
      ? Array.from(entry.pending).flatMap(([id, request]) => (request.retrieved ? [] : [id]))
      : [],
  )
  const effects: ConnectionEffect[] = [...state.parked.keys(), ...unsent].map(notRun)
  const sessions = new Map<Session.ID, RevokingSession>()
  const nextAttempt = Array.from(state.sessions).reduce((attempt, [sessionID, entry]) => {
    if (entry.status === "revoking") {
      sessions.set(sessionID, entry)

      return attempt
    }

    if (entry.status === "attaching") {
      sessions.set(sessionID, { status: "revoking", sync: entry.sync, deleted: false })
      effects.push({ type: "close-attachment", attempt: entry.attempt, outcome: "closed" })

      return attempt
    }
    const step = revokeAttached(entry, sessionID, attempt)

    if (step.entry) sessions.set(sessionID, step.entry)
    effects.push(...step.effects)

    return step.nextAttempt
  }, state.nextAttempt)

  if (!sessions.size) effects.push({ type: "notify-drained" })

  return { state: { status: "disposed", nextAttempt, sessions }, effects }
}

function revokeAttached(entry: AttachedSession, sessionID: Session.ID, nextAttempt: number): Step<RevokingSession> {
  const sync = { attempt: nextAttempt, allow: false }

  return {
    entry: { status: "revoking", sync, deleted: false },
    nextAttempt: nextAttempt + 1,
    effects: [
      ...failPending(entry),
      { type: "close-attachment", attempt: entry.attempt, outcome: "closed" },
      { type: "sync-permissions", sessionID, ...sync },
    ],
  }
}

function updateBrowserState(
  entry: AttachedSession,
  event: Extract<SessionEvent, { readonly type: "state.updated" }>,
  nextAttempt: number,
): Step<SessionState> | undefined {
  if (entry.connectionID !== event.connectionID || entry.browserState === event.browserState) return undefined

  return { entry: { ...entry, browserState: event.browserState }, nextAttempt, effects: [] }
}

function settleRequest(
  entry: AttachedSession,
  event: Extract<
    SessionEvent,
    { readonly type: "request.dispatch-failed" | "request.settled" | "request.timed-out" | "request.cancelled" }
  >,
  command: Browser.Command,
): ConnectionEffect[] {
  const cancel: ConnectionEffect = {
    type: "emit-control",
    control: { type: "cancel", connectionID: entry.connectionID, requestID: event.requestID },
  }

  // The interrupted caller no longer waits; only the desktop needs to stop.
  if (event.type === "request.cancelled") return [cancel]
  const settle = (settlement: RequestSettlement): ConnectionEffect => ({
    type: "settle-request",
    requestID: event.requestID,
    settlement,
  })

  if (event.type === "request.timed-out") return [settle({ ok: false, error: timedOut(command.action.type) }), cancel]

  if (event.type === "request.dispatch-failed")
    return [settle({ ok: false, error: dispatchFailed(command.action.type, event.error) })]

  if (event.outcome.type === "success") return [settle({ ok: true, result: event.outcome.result })]

  return [
    settle({
      ok: false,
      error: new Tool.Error({ message: `[browser.${event.outcome.code}] ${event.outcome.message}` }),
    }),
  ]
}

/** Fails the requests the desktop retrieved. `carryRequests` decides what happens to the rest. */
function failPending(entry: AttachedSession): ConnectionEffect[] {
  return Array.from(entry.pending).flatMap(([requestID, request]) =>
    request.retrieved
      ? [{ type: "settle-request", requestID, settlement: { ok: false, error: disconnectedAfterDispatch() } } as const]
      : [],
  )
}

/**
 * Runs after every active step and owns every request the desktop never retrieved, keyed by requestID so a stale
 * timer or a late event is a no-op:
 *
 * - An attachment that stops being attached parks its unretrieved requests for one reconnect grace, or fails them
 *   when they were already a replay or the session is retired.
 * - A move or delete retires the session for one grace and fails everything parked for it.
 * - The session's next attachment adopts each parked request. A tab command then waits for that desktop's first tab
 *   list and fails if the tab is missing or that desktop goes away first.
 */
function carryRequests(
  previous: ActiveState,
  next: ActiveState,
  stepEffects: readonly ConnectionEffect[],
  event: SessionEvent,
): ConnectionTransition {
  const sessionID = event.sessionID
  const before = previous.sessions.get(sessionID)
  const after = next.sessions.get(sessionID)
  const parked = new Map(next.parked)
  const retired = new Map(next.retired)
  const effects = [...stepEffects]

  if (event.type === "session.moved" || event.type === "session.deleted") {
    retired.set(sessionID, (retired.get(sessionID) ?? 0) + 1)
    effects.push({ type: "schedule", delayMs: REPLAY_GRACE_MS, event: { type: "retire.expired", sessionID } })
  }

  if (event.type === "retire.expired") {
    const count = (retired.get(sessionID) ?? 0) - 1

    if (count > 0) retired.set(sessionID, count)

    if (count <= 0) retired.delete(sessionID)
  }

  if (event.type === "replay.expired" || event.type === "request.timed-out" || event.type === "request.cancelled") {
    const request = parked.get(event.requestID)

    if (request?.sessionID === sessionID && (event.type !== "replay.expired" || request.phase === event.phase)) {
      parked.delete(event.requestID)

      if (event.type === "replay.expired") effects.push(notRun(event.requestID))

      if (event.type === "request.timed-out")
        effects.push({
          type: "settle-request",
          requestID: event.requestID,
          settlement: { ok: false, error: timedOut(request.command.action.type) },
        })
    }
  }
  const banned = retired.has(sessionID)
  const park = (requestID: string, request: ParkedRequest, delayMs: number) => {
    parked.set(requestID, request)
    effects.push({
      type: "schedule",
      delayMs,
      event: { type: "replay.expired", sessionID, requestID, phase: request.phase },
    })
  }
  const release = (requestID: string, effect: ConnectionEffect) => {
    parked.delete(requestID)
    effects.push(effect)
  }

  if (before?.status === "attached" && (after?.status !== "attached" || after.attempt !== before.attempt))
    before.pending.forEach((request, requestID) => {
      if (request.retrieved) return

      if (banned || request.replayed) return release(requestID, notRun(requestID))
      park(requestID, { phase: "reconnect", sessionID, command: request.command }, REPLAY_GRACE_MS)
    })

  Array.from(parked).forEach(([requestID, request]) => {
    if (request.sessionID !== sessionID) return

    if (banned) return release(requestID, notRun(requestID))

    if (request.phase === "reconnect") {
      if (after?.status !== "attached" || before?.status === "attached") return

      if (!("tabID" in request.command.action))
        return release(requestID, {
          type: "replay-request",
          requestID,
          connectionID: after.connectionID,
          tab: undefined,
        })

      return park(requestID, { ...request, phase: "inventory", connectionID: after.connectionID }, INVENTORY_GRACE_MS)
    }

    if (after?.status !== "attached" || after.connectionID !== request.connectionID)
      return release(requestID, notRun(requestID))

    if (event.type !== "state.updated" || event.connectionID !== request.connectionID) return
    const action = request.command.action
    const tab = "tabID" in action ? after.browserState.tabs.find((tab) => tab.id === action.tabID) : undefined
    release(
      requestID,
      tab ? { type: "replay-request", requestID, connectionID: request.connectionID, tab } : notRun(requestID),
    )
  })

  if (effects.length === stepEffects.length && same(parked, next.parked) && same(retired, next.retired))
    return { state: next, effects: stepEffects }

  return { state: { ...next, parked, retired }, effects }
}

function same<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>) {
  return left.size === right.size && Array.from(left).every(([key, value]) => right.get(key) === value)
}

function notRun(requestID: string): ConnectionEffect {
  return { type: "settle-request", requestID, settlement: { ok: false, error: disconnectedBeforeRun() } }
}

function syncWarning(
  event: Extract<
    SessionEvent,
    { readonly type: "permissions.synced" | "permissions.failed" | "permissions.timed-out" }
  >,
  sync: PermissionSync,
): ConnectionEffect[] {
  const action = sync.allow ? "grant" : "revoke"

  if (event.type === "permissions.failed")
    return [{ type: "warn", message: `Browser permission ${action} failed`, error: event.error }]

  if (event.type === "permissions.timed-out")
    return [
      {
        type: "warn",
        message: `Browser permission ${action} timed out after ${PERMISSION_SYNC_TIMEOUT_MS} ms`,
        error: undefined,
      },
    ]

  return []
}

/**
 * The session's permissions with exactly one set of browser allows (`allow`) or none, every other rule kept in order.
 * Undefined when they already are, so a replace writes nothing.
 */
export function reconcileBrowserPermissions(
  current: readonly Permission.Rule[] | undefined,
  allow: boolean,
): Permission.Rule[] | undefined {
  const rules = current ?? []
  const kept = rules.filter(
    (rule) =>
      rule.effect !== "allow" ||
      !ACCESS.some((access) => access.action === rule.action && access.resource === rule.resource),
  )
  const next = allow ? [...kept, ...ACCESS.map((rule) => ({ ...rule, effect: "allow" as const }))] : kept
  const unchanged =
    next.length === rules.length &&
    next.every(
      (rule, index) =>
        rule.action === rules[index]?.action &&
        rule.resource === rules[index]?.resource &&
        rule.effect === rules[index]?.effect,
    )

  return unchanged ? undefined : next
}

export function isConnectionDisposed(state: ConnectionState) {
  return state.status === "disposed"
}

/** The attempt the next `attach` gets; the driver keys its handle by it before dispatching `attach.started`. */
export function selectNextAttempt(state: ConnectionState) {
  return state.nextAttempt
}

/** The attempt of the session's attachment with `connectionID`, attaching or attached. */
export function selectAttachment(state: ConnectionState, sessionID: Session.ID, connectionID: string) {
  if (state.status === "disposed") return undefined
  const entry = state.sessions.get(sessionID)

  if (entry?.status === "revoking" || entry?.connectionID !== connectionID) return undefined

  return entry.attempt
}

export function isAttachedConnection(state: ConnectionState, sessionID: Session.ID, connectionID: string) {
  if (state.status === "disposed") return false
  const entry = state.sessions.get(sessionID)

  return entry?.status === "attached" && entry.connectionID === connectionID
}

export function selectPendingCommand(
  state: ConnectionState,
  sessionID: Session.ID,
  connectionID: string,
  requestID: string,
) {
  if (state.status === "disposed") return undefined
  const entry = state.sessions.get(sessionID)

  if (entry?.status !== "attached" || entry.connectionID !== connectionID) return undefined

  return entry.pending.get(requestID)?.command
}

export type Status = {
  readonly attached: boolean
  readonly connectionID?: string
  readonly tabs: readonly Browser.Tab[]
  readonly focusedTabID: Browser.TabID | null
  readonly rendered: boolean
  readonly recovery: string
}

/** What `browser.status` reports: attached only once the grant succeeded and the desktop received `attached`. */
export function selectStatus(state: ConnectionState, sessionID: Session.ID): Status {
  const entry = state.status === "active" ? state.sessions.get(sessionID) : undefined

  if (entry?.status !== "attached")
    return { attached: false, tabs: [], focusedTabID: null, rendered: false, recovery: disconnected().message }

  return {
    attached: true,
    connectionID: entry.connectionID,
    tabs: entry.browserState.tabs,
    focusedTabID: entry.browserState.focusedTabID,
    rendered: true,
    recovery: ATTACHED,
  }
}

/** The preflight error for a session with no attachment, attached or attaching. */
export function selectCapability(state: ConnectionState, sessionID: Session.ID) {
  const entry = state.status === "active" ? state.sessions.get(sessionID) : undefined

  return !entry || entry.status === "revoking" ? disconnected() : undefined
}

/** How many of the session's requests are parked for its next attachment. */
export function selectWaiting(state: ConnectionState, sessionID: Session.ID) {
  if (state.status === "disposed") return 0

  return Array.from(state.parked.values()).filter((request) => request.sessionID === sessionID).length
}

export function isRetired(state: ConnectionState, sessionID: Session.ID) {
  return state.status === "active" && state.retired.has(sessionID)
}

/** The attachment and tab a browser tool call targets, or the error the tool returns. */
export function selectTarget(
  state: ConnectionState,
  sessionID: Session.ID,
  action: Browser.Action,
):
  | { readonly ok: true; readonly connectionID: string; readonly tab: Browser.Tab | undefined }
  | { readonly ok: false; readonly error: Tool.Error } {
  const entry = state.status === "active" ? state.sessions.get(sessionID) : undefined

  if (!entry || entry.status === "revoking") return { ok: false, error: disconnected() }

  if (entry.status === "attaching")
    return {
      ok: false,
      error: new Tool.Error({
        message:
          "[browser.disconnected] The desktop browser is still connecting to this session; no action ran. Call browser.tabs.list({}) once it finishes connecting.",
      }),
    }
  const tab = "tabID" in action ? entry.browserState.tabs.find((tab) => tab.id === action.tabID) : undefined

  if ("tabID" in action && !tab)
    return {
      ok: false,
      error: new Tool.Error({
        message:
          "[browser.tab_unavailable] This tab is closed or does not belong to the connected session. Call browser.tabs.list({}) and use an exact returned tabID. If no tabs exist, use browser.tabs.open({}). Never substitute a request ID, file ID, or element ref for tabID.",
      }),
    }

  return { ok: true, connectionID: entry.connectionID, tab }
}

function disconnectedBeforeDispatch() {
  return new Tool.Error({
    message:
      "[browser.disconnected] The desktop browser disconnected before this action was sent; no action ran. Reconnect this session in the desktop app, then call browser.tabs.list({}).",
  })
}

function disconnectedAfterDispatch() {
  return new Tool.Error({
    message: `[browser.disconnected] Browser connection closed; the action may already have run. Reconnect this session in the desktop app, call browser.status({}) and browser.tabs.list({}), and inspect the target tab with browser.snapshot({tabID}). Do not repeat clicks, submissions, uploads, or evaluations until their outcome is known. ${FALLBACK}`,
  })
}

const FALLBACK =
  "If the desktop app is not available, use Shuvgeist for rendered browser checks. HTTP or curl success only proves reachability or content, not a rendered UI, and must not be reported as UI verification."

const RECOVER = `Open this session in the desktop app and wait for it to connect, then call browser.status({}) and browser.tabs.list({}). ${FALLBACK}`

const ATTACHED =
  "A desktop browser is attached. Use an exact tabID from this status or browser.tabs.list({}) for page operations. HTTP or curl success is not rendered UI verification; use browser.snapshot or browser.screenshot for that."

/** No desktop is attached, so rendered UI checks are unavailable until one is. */
export function disconnected() {
  return new Tool.Error({
    message: `[browser.disconnected] No desktop browser is connected to this session, so rendered UI verification is unavailable. An advertised browser tool is not an attached desktop. ${RECOVER} Repeating browser actions while disconnected will not help.`,
  })
}

/** The desktop never retrieved the command, and it was not replayed. */
export function disconnectedBeforeRun() {
  return new Tool.Error({
    message: `[browser.disconnected] Browser connection closed before the desktop ran this action, so it did not run. ${RECOVER}`,
  })
}

function dispatchFailed(action: Browser.Method, error: unknown) {
  return new Tool.Error({
    message: `Could not dispatch browser.${action}. Check the desktop connection and call browser.tabs.list({}) before deciding whether to retry.`,
    error,
  })
}

function timedOut(action: Browser.Method) {
  return new Tool.Error({
    message: `[browser.timeout] browser.${action} did not finish within ${REQUEST_TIMEOUT_MS / 1000} seconds; its outcome is unknown. Check the desktop connection, call browser.tabs.list({}), and inspect the tab or browser.files.list({tabID}) for completed work. Do not blindly repeat a mutating action or start another recording.`,
  })
}
