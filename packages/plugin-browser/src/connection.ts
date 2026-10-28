export * as BrowserConnection from "./connection.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { RpcRegistration } from "@opencode/plugin/effect/rpc"
import type { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Clock, Deferred, Duration, Effect, Option, Schema, Stream } from "effect"
import { Browser } from "./rpc.js"
import { BrowserTunnel } from "./tunnel.js"

const recover =
  "Open this session in the desktop app and wait for it to connect, then call browser.status({}) and browser.tabs.list({}). If the desktop app is not available, use Shuvgeist for rendered browser checks. HTTP or curl success only proves reachability or content, not a rendered UI, and must not be reported as UI verification."

/** No desktop has attached. Rendered UI checks are unavailable until one does. */
export const disconnected = `[browser.disconnected] No desktop browser is connected to this session, so rendered UI verification is unavailable. An advertised browser tool is not an attached desktop. ${recover} Repeating browser actions while disconnected will not help.`

/** The desktop never retrieved the command, so the action did not run. */
export const closedBefore = `[browser.disconnected] Browser connection closed before the desktop ran this action, so it did not run. ${recover}`

/** The desktop already took the command. It may have run; do not replay it. */
export const closedAfter = `[browser.disconnected] Browser connection closed; the action may already have run. Reconnect this session in the desktop app, call browser.status({}) and browser.tabs.list({}), and inspect the target tab with browser.snapshot({tabID}). Do not repeat clicks, submissions, uploads, or evaluations until their outcome is known. If the desktop app is not available, use Shuvgeist for rendered browser checks. HTTP or curl success only proves reachability or content, not a rendered UI, and must not be reported as UI verification.`

/** A desktop is attached. HTTP success is still not rendered UI verification. */
export const attached =
  "A desktop browser is attached. Use an exact tabID from this status or browser.tabs.list({}) for page operations. HTTP or curl success is not rendered UI verification; use browser.snapshot or browser.screenshot for that."

// A replacement is installed before its tab list exists. An ordinary reconnect
// (the desktop's first retry) lands about a second later. Both waits are bounded
// so a missing desktop still fails instead of hanging for the command timeout.
export const replayGrace = "2 seconds"
export const inventoryGrace = "2 seconds"

type CloseReason = "closed" | "replaced" | "retired"

type Pending = {
  command: Browser.Command
  result: Deferred.Deferred<Browser.Result, Tool.Error>
  /** Set once the desktop has retrieved the command. A later disconnect must not replay it. */
  retrieved: boolean
}

type Attachment = {
  connectionID: string
  state: Browser.State
  closed: Deferred.Deferred<CloseReason>
  /** Completed by the first `state` publication, which is the first real tab list. */
  inventory: Deferred.Deferred<void>
  inventoryReady: boolean
  pending: Map<string, Pending>
  tunnels: BrowserTunnel.Tunnels
}

export interface Status {
  readonly attached: boolean
  readonly connectionID?: string
  readonly tabs: readonly Browser.Tab[]
  readonly focusedTabID: Browser.TabID | null
  readonly rendered: boolean
  readonly recovery: string
}

export type Connection = Effect.Success<ReturnType<typeof make>>

export const make = Effect.fn("BrowserConnection.make")(function* (
  ctx: Pick<Context, "agent" | "rpc" | "session" | "location" | "event">,
) {
  const browsers = new Map<Session.ID, Attachment>()
  // In-flight commands waiting for an ordinary reconnect, not a replacement that is already installed.
  const subscribers = new Map<Session.ID, Array<Deferred.Deferred<Attachment, Tool.Error>>>()
  // Session ids that must not replay, and the time that ban lifts. A move or delete
  // extends the deadline instead of clearing another event's entry.
  const retiredUntil = new Map<Session.ID, number>()
  // Appended after config, so every agent hides the browser until an attachment allows it.
  yield* ctx.agent.transform((editor) =>
    editor.list().forEach((agent) => agent.permissions.push({ action: "browser", resource: "*", effect: "deny" })),
  )
  // Each attachment adds and removes its own allow, so a replaced attachment keeps the new one's.
  const grant = (sessionID: Session.ID) =>
    Effect.acquireRelease(
      ctx.session.get({ sessionID }).pipe(
        Effect.flatMap((session) =>
          ctx.session.update({
            sessionID,
            permissions: [...(session.permissions ?? []), { action: "browser", resource: "*", effect: "allow" }],
          }),
        ),
        Effect.orDie,
      ),
      () =>
        ctx.session.get({ sessionID }).pipe(
          Effect.flatMap((session) => {
            const permissions = session.permissions ?? []
            const index = permissions.findIndex(
              (rule) => rule.action === "browser" && rule.resource === "*" && rule.effect === "allow",
            )
            if (index === -1) return Effect.void
            return ctx.session.update({ sessionID, permissions: permissions.toSpliced(index, 1) })
          }),
          Effect.ignore,
        ),
    )
  let active = true
  // Drop the attachment without waking waiters. Replacement installs the next
  // attachment first, then signals, so an in-flight request can see it.
  const detach = (sessionID: Session.ID) => {
    const browser = browsers.get(sessionID)
    if (!browser) return
    browsers.delete(sessionID)
    browser.tunnels.dispose()
    return browser
  }
  const drop = (sessionID: Session.ID, waiter: Deferred.Deferred<Attachment, Tool.Error>) => {
    const queued = subscribers.get(sessionID)
    if (!queued) return
    const rest = queued.filter((item) => item !== waiter)
    if (rest.length === 0) subscribers.delete(sessionID)
    else subscribers.set(sessionID, rest)
  }
  const forget = (sessionID: Session.ID) => {
    const queued = subscribers.get(sessionID)
    if (!queued) return Effect.void
    subscribers.delete(sessionID)
    return Effect.forEach(
      queued,
      (waiter) => Deferred.fail(waiter, new Tool.Error({ message: closedBefore })).pipe(Effect.ignore),
      { discard: true },
    )
  }
  const close = (sessionID: Session.ID, reason: CloseReason = "closed") =>
    Effect.gen(function* () {
      // Drop anyone still parked from an earlier grace window before this close wakes them.
      yield* forget(sessionID)
      const browser = detach(sessionID)
      if (!browser) return
      yield* Deferred.succeed(browser.closed, reason)
    })
  const announce = (sessionID: Session.ID, browser: Attachment) => {
    const queued = subscribers.get(sessionID)
    if (!queued) return Effect.void
    subscribers.delete(sessionID)
    return Effect.forEach(queued, (waiter) => Deferred.succeed(waiter, browser).pipe(Effect.ignore), { discard: true })
  }
  // `replaced` already installed the next attachment. `closed` is an ordinary drop:
  // give the desktop one reconnect attempt before reporting that the action did not run.
  // Attach carries sessionID, connectionID, and version. connectionID is new on every
  // registration, and the desktop does not send a stable id, so replay follows the session.
  const isRetired = (sessionID: Session.ID) =>
    Effect.gen(function* () {
      const deadline = retiredUntil.get(sessionID)
      if (deadline === undefined) return false
      if ((yield* Clock.currentTimeMillis) < deadline) return true
      retiredUntil.delete(sessionID)
      return false
    })
  // Holds the ban for one reconnect grace. A later move or delete only lengthens it.
  const markRetired = (sessionID: Session.ID) =>
    Effect.gen(function* () {
      const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(replayGrace)
      const current = retiredUntil.get(sessionID)
      if (current === undefined || until > current) retiredUntil.set(sessionID, until)
      yield* Effect.sleep(replayGrace).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const deadline = retiredUntil.get(sessionID)
            if (deadline !== undefined && (yield* Clock.currentTimeMillis) >= deadline) retiredUntil.delete(sessionID)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    })
  const adopt = (sessionID: Session.ID, previous: Attachment, reason: CloseReason) =>
    Effect.gen(function* () {
      // The reason travels with the wake. close only schedules this command, so a
      // flag cleared by the handler would already be gone by the time we run.
      if (reason === "retired" || (yield* isRetired(sessionID))) return undefined
      const installed = browsers.get(sessionID)
      if (installed && installed !== previous) return installed
      if (reason === "replaced") return undefined
      const waiter = yield* Deferred.make<Attachment, Tool.Error>()
      subscribers.set(sessionID, [...(subscribers.get(sessionID) ?? []), waiter])
      const raced = browsers.get(sessionID)
      if (yield* isRetired(sessionID)) {
        drop(sessionID, waiter)
        return undefined
      }
      if (raced && raced !== previous) {
        drop(sessionID, waiter)
        return raced
      }
      return yield* Deferred.await(waiter).pipe(
        Effect.ensuring(Effect.sync(() => drop(sessionID, waiter))),
        Effect.timeoutOrElse({
          duration: replayGrace,
          orElse: () => Effect.succeed(undefined),
        }),
      )
    })
  yield* Effect.addFinalizer(() => {
    active = false
    const ids = new Set([...browsers.keys(), ...subscribers.keys()])
    return Effect.forEach(ids, (id) => close(id), { discard: true })
  })
  const tunnels = (input: {
    sessionID: Session.ID
    connectionID: string
  }): Effect.Effect<BrowserTunnel.Tunnels, Error> => {
    const browser = browsers.get(input.sessionID)
    return browser?.connectionID === input.connectionID
      ? Effect.succeed(browser.tunnels)
      : Effect.fail(new Error("Browser attachment is unavailable; its network connections were closed."))
  }
  const rpc: RpcRegistration<typeof Browser.Definition> = yield* ctx.rpc
    .register(Browser.Definition, {
      attach: (input, call) =>
        Effect.gen(function* () {
          const session = yield* ctx.session
            .get({ sessionID: input.sessionID })
            .pipe(Effect.mapError(() => call.error("unavailable", "Session not found.", {})))
          if (session.location.directory !== ctx.location.directory)
            return yield* Effect.fail(call.error("unavailable", "Session belongs to another location.", {}))
          const browser = yield* Effect.acquireRelease(
            Effect.gen(function* () {
              if (!active) return yield* Effect.fail(call.error("unavailable", "Browser is unavailable.", {}))
              const previous = detach(input.sessionID)
              const browser: Attachment = {
                connectionID: input.connectionID,
                state: { tabs: [], focusedTabID: null },
                closed: yield* Deferred.make<CloseReason>(),
                inventory: yield* Deferred.make<void>(),
                inventoryReady: false,
                pending: new Map(),
                tunnels: BrowserTunnel.make(),
              }
              browsers.set(input.sessionID, browser)
              // A new attachment does not lift a delete or move ban early. The deadline does.
              // Wake reconnect waiters before the previous command observes `replaced` or `closed`.
              yield* announce(input.sessionID, browser)
              if (previous) yield* Deferred.succeed(previous.closed, "replaced")
              return browser
            }),
            (browser) => (browsers.get(input.sessionID) === browser ? close(input.sessionID) : Effect.void),
          )
          yield* grant(input.sessionID)
          yield* rpc.events
            .emit("control", { type: "attached", connectionID: input.connectionID, version: 4 })
            .pipe(Effect.orDie)
          // In-flight commands see "retired". The desktop protocol only has closed and replaced.
          const outcome = yield* Deferred.await(browser.closed)
          return outcome === "retired" ? "closed" : outcome
        }).pipe(Effect.scoped),
      state: (input, call) =>
        Effect.gen(function* () {
          const browser = browsers.get(input.sessionID)
          if (!browser || browser.connectionID !== input.connectionID)
            return yield* Effect.fail(call.error("unavailable", "Browser is unavailable.", {}))
          browser.state = input.state
          if (browser.inventoryReady) return
          browser.inventoryReady = true
          yield* Deferred.succeed(browser.inventory, undefined)
        }),
      command: (input, call) =>
        Effect.gen(function* () {
          const browser = browsers.get(input.sessionID)
          const pending =
            browser?.connectionID === input.connectionID ? browser.pending.get(input.requestID) : undefined
          if (!pending)
            return yield* Effect.fail(call.error("unavailable", "Browser request is no longer available.", {}))
          pending.retrieved = true
          return pending.command
        }),
      result: (input, call) =>
        Effect.gen(function* () {
          const browser = browsers.get(input.sessionID)
          if (!browser || browser.connectionID !== input.connectionID)
            return yield* Effect.fail(call.error("unavailable", "Browser is unavailable.", {}))
          const pending = browser.pending.get(input.requestID)
          if (!pending) return
          if (input.outcome.type === "failure")
            return yield* Deferred.fail(
              pending.result,
              new Tool.Error({ message: `[browser.${input.outcome.code}] ${input.outcome.message}` }),
            ).pipe(Effect.asVoid)
          yield* Deferred.succeed(pending.result, input.outcome.result)
        }).pipe(Effect.asVoid),
      "tunnel.open": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.open(input.target)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
      "tunnel.read": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.read(input.tunnelID)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
      "tunnel.write": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.write(input.tunnelID, input.data, input.end)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
      "tunnel.close": (input, call) =>
        tunnels(input).pipe(
          Effect.flatMap((network) => network.close(input.tunnelID)),
          Effect.mapError((error) => call.error("unavailable", error.message, {})),
        ),
    })
    .pipe(Effect.orDie)
  yield* ctx.event.subscribe().pipe(
    Stream.filter((event) => event.type === "session.deleted" || event.type === "session.moved"),
    Stream.runForEach((event) =>
      markRetired(event.data.sessionID).pipe(
        Effect.andThen(close(event.data.sessionID, "retired")),
        // close only schedules the command it wakes. That command reads the retired
        // reason, so it does not park a reconnect after this handler returns.
        Effect.andThen(forget(event.data.sessionID)),
        // The id stays retired for replayGrace. Another move or delete extends that
        // deadline; clearing it here would let a late adopt replay onto a session that came back.
      ),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )

  const status = (sessionID: Session.ID): Status => {
    const browser = browsers.get(sessionID)
    if (!browser) return { attached: false, tabs: [], focusedTabID: null, rendered: false, recovery: disconnected }
    return {
      attached: true,
      connectionID: browser.connectionID,
      tabs: [...browser.state.tabs],
      focusedTabID: browser.state.focusedTabID,
      rendered: true,
      recovery: attached,
    }
  }

  return {
    status,
    waiting: (sessionID: Session.ID) => subscribers.get(sessionID)?.length ?? 0,
    retired: (sessionID: Session.ID) => retiredUntil.has(sessionID),
    // Fails before a browser tool reads files or dispatches. Status stays available either way.
    require: Effect.fn("BrowserConnection.require")(function* (sessionID: Session.ID) {
      if (browsers.has(sessionID)) return
      return yield* new Tool.Error({ message: disconnected })
    }),
    target: Effect.fn("BrowserConnection.target")(function* (sessionID: Session.ID, action: Browser.Action) {
      const browser = browsers.get(sessionID)
      // `require` is the capability preflight. Reaching this without an attachment is a caller bug.
      if (!browser) return yield* Effect.die(new Error("Browser capability was not checked before use"))
      const tab = "tabID" in action ? browser.state.tabs.find((tab) => tab.id === action.tabID) : undefined
      if ("tabID" in action && !tab)
        return yield* new Tool.Error({
          message:
            "[browser.tab_unavailable] This tab is closed or does not belong to the connected session. Call browser.tabs.list({}) and use an exact returned tabID. If no tabs exist, use browser.tabs.open({}). Never substitute a request ID, file ID, or element ref for tabID.",
        })
      // Keep the selected attachment and document, even while permissions or file IO wait.
      return {
        tab,
        inspect: () =>
          request(
            rpc,
            (previous, reason) => adopt(sessionID, previous, reason),
            browser,
            action,
            tab,
            [],
            { inspect: true },
            false,
          ).pipe(
            Effect.flatMap((result) => Schema.decodeUnknownEffect(Browser.Target)(result.value)),
            Effect.mapError(
              (error) =>
                new Tool.Error({
                  message:
                    error instanceof Tool.Error
                      ? error.message
                      : "Browser returned invalid target metadata. Check desktop/plugin versions; no action was authorized.",
                  error,
                }),
            ),
          ),
        request: (files: readonly Browser.File[], target?: Browser.Target) =>
          request(
            rpc,
            (previous, reason) => adopt(sessionID, previous, reason),
            browser,
            action,
            tab,
            files,
            { target },
            false,
          ),
      }
    }),
  }
})

const request = Effect.fn("BrowserConnection.request")(function* (
  rpc: RpcRegistration<typeof Browser.Definition>,
  adopt: (previous: Attachment, reason: CloseReason) => Effect.Effect<Attachment | undefined, Tool.Error>,
  browser: Attachment,
  action: Browser.Action,
  tab: Browser.Tab | undefined,
  files: readonly Browser.File[],
  inspection: Pick<Browser.Command, "inspect" | "target">,
  recovered: boolean,
): Effect.fn.Return<Browser.Result, Tool.Error> {
  const requestID = crypto.randomUUID()
  const pending = yield* Deferred.make<Browser.Result, Tool.Error>()
  const command =
    (action.type === "files.upload" || action.type === "files.drop") && !inspection.inspect
      ? { ...action, paths: files.map((file) => file.name) }
      : action
  const entry: Pending = {
    command: { action: command, ...(tab ? { generation: tab.generation } : {}), files, ...inspection },
    result: pending,
    retrieved: false,
  }
  browser.pending.set(requestID, entry)
  return yield* rpc.events.emit("control", { type: "command", connectionID: browser.connectionID, requestID }).pipe(
    Effect.mapError(
      (error) =>
        new Tool.Error({
          message: `Could not dispatch browser.${action.type}. Check the desktop connection and call browser.tabs.list({}) before deciding whether to retry.`,
          error,
        }),
    ),
    Effect.andThen(Deferred.await(pending)),
    Effect.raceFirst(
      Deferred.await(browser.closed).pipe(
        Effect.flatMap((reason) =>
          Effect.gen(function* () {
            // A result that landed in the same turn as the close is the action's real outcome.
            const settled = yield* Deferred.poll(pending)
            if (Option.isSome(settled)) return yield* settled.value
            if (recovered || entry.retrieved) return yield* missed(entry.retrieved)
            const next = yield* adopt(browser, reason)
            if (!next) return yield* missed(false)
            const nextTab = yield* tabAfterInventory(next, action)
            // Inspection only reads metadata. An approved target must be read again: replaying
            // the old one with this attachment's generation makes the document-changed check pass.
            if (inspection.inspect)
              return yield* request(rpc, adopt, next, action, nextTab, files, { inspect: true }, true)
            if (!inspection.target) return yield* request(rpc, adopt, next, action, nextTab, files, {}, true)
            // The original action has not run. A failed re-inspect is that same miss, not a
            // desktop error the caller should retry unchanged.
            const inspected = yield* request(rpc, adopt, next, action, nextTab, [], { inspect: true }, true).pipe(
              Effect.mapError(() => new Tool.Error({ message: closedBefore })),
            )
            const fresh = yield* Schema.decodeUnknownEffect(Browser.Target)(inspected.value).pipe(
              Effect.mapError(() => new Tool.Error({ message: closedBefore })),
            )
            if (JSON.stringify(fresh) !== JSON.stringify(inspection.target)) return yield* missed(false)
            return yield* request(rpc, adopt, next, action, nextTab, files, { target: fresh }, true)
          }),
        ),
      ),
    ),
    Effect.onInterrupt(() =>
      rpc.events.emit("control", { type: "cancel", connectionID: browser.connectionID, requestID }).pipe(Effect.ignore),
    ),
    Effect.timeoutOrElse({
      duration: "60 seconds",
      orElse: () =>
        Effect.fail(
          new Tool.Error({
            message: `[browser.timeout] browser.${action.type} did not finish within 60 seconds; its outcome is unknown. Check the desktop connection, call browser.tabs.list({}), and inspect the tab or browser.files.list({tabID}) for completed work. Do not blindly repeat a mutating action or start another recording.`,
          }),
        ),
    }),
    Effect.ensuring(Effect.sync(() => browser.pending.delete(requestID))),
  )
})

const missed = (retrieved: boolean) => new Tool.Error({ message: retrieved ? closedAfter : closedBefore })

// The first state event is the desktop's tab list. It is published after `attached`,
// so a replay that runs at the close signal cannot see those tabs yet.
const tabAfterInventory = Effect.fn("BrowserConnection.tabAfterInventory")(function* (
  next: Attachment,
  action: Browser.Action,
) {
  if (!("tabID" in action)) return undefined
  // A desktop that closes while we wait must not hold the command for the whole grace.
  yield* Effect.raceFirst(
    Deferred.await(next.inventory),
    Deferred.await(next.closed).pipe(Effect.andThen(Effect.fail(new Tool.Error({ message: closedBefore })))),
  ).pipe(
    Effect.timeoutOrElse({
      duration: inventoryGrace,
      orElse: () => Effect.fail(new Tool.Error({ message: closedBefore })),
    }),
  )
  const found = next.state.tabs.find((item) => item.id === action.tabID)
  if (!found) return yield* new Tool.Error({ message: closedBefore })
  return found
})
