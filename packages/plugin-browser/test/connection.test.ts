import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { Context } from "@opencode/plugin/effect/plugin"
import { AbsolutePath } from "@opencode/schema/schema"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { BrowserConnection } from "../src/connection.js"
import { BrowserTools } from "../src/tools.js"
import { Browser } from "../src/rpc.js"

// Papercut pc_dfda6c59c814: a disconnected session must fail before a browser workflow
// with a recovery path, and a later attachment must be able to run page operations.

const directory = AbsolutePath.make("/tmp/shuvcode-browser-preflight")
const sessionID = Session.ID.make("ses_browser_preflight")
interface Call {
  error(type: string, message: string): never
}

const call: Call = {
  error: (type, message) => {
    throw new Error(`${type}: ${message}`)
  },
}

const tabID = Browser.TabID.make("tab_11111111-1111-4111-8111-111111111111")
const tab = {
  id: tabID,
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}
const state = { tabs: [tab], focusedTabID: tabID }

type Control = Browser.Control

interface Desktop {
  attach(
    input: { sessionID: Session.ID; connectionID: string; version: 4 },
    call: Call,
  ): Effect.Effect<"closed" | "replaced", unknown>
  state(
    input: { sessionID: Session.ID; connectionID: string; state: Browser.State },
    call: Call,
  ): Effect.Effect<void, unknown>
  command(
    input: { sessionID: Session.ID; connectionID: string; requestID: string },
    call: Call,
  ): Effect.Effect<Browser.Command, unknown>
  result(
    input: { sessionID: Session.ID; connectionID: string; requestID: string; outcome: Browser.Outcome },
    call: Call,
  ): Effect.Effect<void, unknown>
}

const toolContext: Tool.Context = {
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_browser_preflight"),
  id: Tool.CallID.make("call_browser_preflight"),
  progress: () => Effect.void,
}

const open = Effect.gen(function* () {
  const events = yield* Queue.unbounded<Control>()
  const sessionEvents = yield* Queue.unbounded<{ type: string; data: { sessionID: Session.ID } }>()
  const tools = new Map<string, Tool.Info>()
  let permissions: { action: string; resource: string; effect: "allow" | "deny" | "ask" }[] = []
  let desktop: Desktop | undefined
  const ctx = {
    location: { directory },
    agent: {
      transform: () => Effect.succeed({ dispose: Effect.void }),
    },
    event: { subscribe: () => Stream.fromQueue(sessionEvents) },
    session: {
      get: () => Effect.succeed({ location: { directory }, permissions }),
      update: (input: { permissions: typeof permissions }) =>
        Effect.sync(() => {
          permissions = input.permissions
        }),
    },
    rpc: {
      register: (_definition: unknown, handlers: Desktop) => {
        desktop = handlers
        return Effect.succeed({
          events: {
            emit: (_name: string, data: Control) => Queue.offer(events, data).pipe(Effect.asVoid),
          },
          dispose: Effect.void,
        })
      },
    },
    tool: {
      transform: (apply: (editor: { namespace(input: unknown): void; add(tool: Tool.Info): void }) => void) => {
        apply({
          namespace: () => undefined,
          add: (tool) => {
            const namespace = tool.options?.namespace
            tools.set(namespace === undefined ? tool.name : `${namespace}.${tool.name}`, tool)
          },
        })
        return Effect.succeed({ dispose: Effect.void })
      },
    },
    skill: {
      transform: (apply: (editor: { add(info: unknown): void }) => void) => {
        apply({ add: () => undefined })
        return Effect.succeed({ dispose: Effect.void })
      },
    },
  } as unknown as Pick<Context, "agent" | "rpc" | "session" | "location" | "event" | "tool" | "skill">
  const connection = yield* BrowserConnection.make(ctx)
  yield* BrowserTools.register(ctx, connection)
  const methods = desktop
  if (!methods) return yield* Effect.die(new Error("Browser RPC was not registered"))

  const take = (type: Control["type"], connectionID: string) =>
    Effect.gen(function* () {
      const skipped: Control[] = []
      while (true) {
        const event = yield* Queue.take(events)
        if (event.type === type && event.connectionID === connectionID) {
          for (const item of skipped) yield* Queue.offer(events, item)
          return event
        }
        skipped.push(event)
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "2 seconds",
        orElse: () => Effect.die(new Error(`timed out waiting for browser ${type}`)),
      }),
    )

  const connect = (connectionID: string) =>
    Effect.gen(function* () {
      const fiber = yield* methods
        .attach({ sessionID, connectionID, version: 4 }, call)
        .pipe(Effect.forkScoped({ startImmediately: true }))
      yield* take("attached", connectionID)
      return fiber
    })

  const invoke = (name: string, input: object) => {
    const tool = tools.get(name)
    if (!tool) return Effect.die(new Error(`missing browser tool ${name}`))
    return tool.execute(input, toolContext)
  }

  const end = (type: "session.deleted" | "session.moved") =>
    Queue.offer(sessionEvents, { type, data: { sessionID } }).pipe(Effect.asVoid)

  return { events, methods, connect, invoke, take, connection, end }
})

const recovery = (message: string) => {
  expect(message).toContain("[browser.disconnected]")
  expect(message).toContain("desktop app")
  expect(message).toContain("browser.status")
  expect(message).toContain("browser.tabs.list")
  expect(message).toContain("Shuvgeist")
  expect(message).toContain("HTTP or curl")
  expect(message).toContain("rendered UI")
}

const message = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return `succeeded: ${JSON.stringify(exit.value)}`
  const error = Cause.squash(exit.cause)
  if (error instanceof Tool.Error) return error.message
  return `unexpected failure: ${error instanceof Error ? error.message : String(error)}`
}

test("preflight fails a disconnected browser tool with a recovery path", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        const status = yield* app.invoke("browser.status", {})
        expect(status.output).toMatchObject({
          attached: false,
          rendered: false,
          tabs: [],
          focusedTabID: null,
        })
        const guidance = status.output as { recovery: string }
        recovery(guidance.recovery)
        expect(status.content).toEqual([{ type: "text", text: guidance.recovery }])

        const exit = yield* Effect.exit(
          app.invoke("browser.tabs.open", { url: "https://example.com" }).pipe(Effect.timeout("1 second")),
        )
        const failure = message(exit)
        recovery(failure)
        expect(failure).toContain("Repeating browser actions while disconnected will not help")
        const pathExit = yield* Effect.exit(app.invoke("browser.tabs.open", { url: "/tmp/page.html" }))
        const pathFailure = message(pathExit)
        recovery(pathFailure)
        expect(pathFailure).not.toContain("Invalid browser URL")
        expect(yield* Queue.size(app.events)).toBe(0)
      }),
    ),
  )
})

test("a disconnect before the desktop takes the command says the action did not run", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        const attachment = yield* app.connect("desktop-a")
        const pending = yield* app
          .invoke("browser.tabs.open", { url: "https://example.com" })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* Fiber.interrupt(attachment)
        yield* Effect.yieldNow
        expect(app.connection.waiting(sessionID)).toBe(1)
        yield* TestClock.adjust(BrowserConnection.replayGrace)
        const failure = message(yield* Effect.exit(Fiber.join(pending)))
        recovery(failure)
        expect(failure).toContain("did not run")
        expect(failure).not.toContain("may already have run")
        expect(app.connection.waiting(sessionID)).toBe(0)
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

test("a dropped connection reports that the action may have run and how to recover", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        const attachment = yield* app.connect("desktop-a")
        const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
        const event = yield* app.take("command", "desktop-a")
        if (event.type !== "command") return yield* Effect.die(new Error("expected a browser command"))
        yield* app.methods.command({ sessionID, connectionID: "desktop-a", requestID: event.requestID }, call)
        yield* Fiber.interrupt(attachment)
        const failure = message(yield* Effect.exit(Fiber.join(pending)))
        recovery(failure)
        expect(failure).toContain("may already have run")
        expect(failure).toContain("browser.snapshot")
        expect(failure).toContain("Do not repeat clicks")
        expect(yield* Queue.size(app.events)).toBe(0)
      }),
    ),
  )
})

test("a replacement runs an unretrieved command, and a later attachment can read the page", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        const replaced = yield* app.connect("desktop-b")
        const replayed = yield* app.take("command", "desktop-b")
        if (replayed.type !== "command") return yield* Effect.die(new Error("expected the replayed command"))
        const command = yield* app.methods.command(
          { sessionID, connectionID: "desktop-b", requestID: replayed.requestID },
          call,
        )
        expect(command.action.type).toBe("tabs.list")
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-b",
            requestID: replayed.requestID,
            outcome: { type: "success", result: { value: { tabs: [], focusedTabID: null }, files: [] } },
          },
          call,
        )
        expect((yield* Fiber.join(pending)).output).toEqual({ tabs: [], focusedTabID: null })
        yield* Fiber.interrupt(replaced)

        const detached = yield* app.invoke("browser.status", {})
        expect(detached.output).toMatchObject({ attached: false, rendered: false })
        recovery((detached.output as { recovery: string }).recovery)

        yield* app.connect("desktop-c")
        yield* app.methods.state({ sessionID, connectionID: "desktop-c", state }, call)
        const attached = yield* app.invoke("browser.status", {})
        expect(attached.output).toMatchObject({
          attached: true,
          rendered: true,
          connectionID: "desktop-c",
          focusedTabID: tabID,
          tabs: [tab],
        })
        expect((attached.output as { recovery: string }).recovery).toContain("not rendered UI verification")

        const shot = yield* app
          .invoke("browser.snapshot", { tabID })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        const request = yield* app.take("command", "desktop-c")
        if (request.type !== "command") return yield* Effect.die(new Error("expected a snapshot command"))
        const action = yield* app.methods.command(
          { sessionID, connectionID: "desktop-c", requestID: request.requestID },
          call,
        )
        expect(action.action).toMatchObject({ type: "snapshot", tabID })
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-c",
            requestID: request.requestID,
            outcome: {
              type: "success",
              result: { value: { tab, content: "Example heading", truncated: false }, files: [] },
            },
          },
          call,
        )
        expect((yield* Fiber.join(shot)).output).toEqual({ tab, content: "Example heading", truncated: false })
      }),
    ),
  )
})

const restored = { ...tab, generation: 7 }

test("a replacement replays a tab command after the new desktop publishes its tabs", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        yield* app.methods.state({ sessionID, connectionID: "desktop-a", state }, call)
        const pending = yield* app
          .invoke("browser.snapshot", { tabID })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* app.connect("desktop-b")
        yield* app.methods.state(
          { sessionID, connectionID: "desktop-b", state: { tabs: [restored], focusedTabID: tabID } },
          call,
        )
        const replayed = yield* app.take("command", "desktop-b")
        if (replayed.type !== "command") return yield* Effect.die(new Error("expected the replayed snapshot"))
        const command = yield* app.methods.command(
          { sessionID, connectionID: "desktop-b", requestID: replayed.requestID },
          call,
        )
        expect(command.action).toMatchObject({ type: "snapshot", tabID })
        expect(command.generation).toBe(restored.generation)
        expect(command.target).toBeUndefined()
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-b",
            requestID: replayed.requestID,
            outcome: {
              type: "success",
              result: { value: { tab: restored, content: "Restored heading", truncated: false }, files: [] },
            },
          },
          call,
        )
        expect((yield* Fiber.join(pending)).output).toEqual({
          tab: restored,
          content: "Restored heading",
          truncated: false,
        })
      }),
    ),
  )
})

test("closing the new desktop ends the tab-list wait", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        yield* app.methods.state({ sessionID, connectionID: "desktop-a", state }, call)
        const pending = yield* app
          .invoke("browser.snapshot", { tabID })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        const settled = yield* Deferred.make<Exit.Exit<unknown, unknown>>()
        yield* Effect.exit(Fiber.join(pending)).pipe(
          Effect.flatMap((exit) => Deferred.succeed(settled, exit)),
          Effect.forkScoped({ startImmediately: true }),
        )
        yield* app.take("command", "desktop-a")
        const next = yield* app.connect("desktop-b")
        yield* Fiber.interrupt(next)
        yield* Effect.yieldNow
        const ready = yield* Deferred.poll(settled)
        if (Option.isNone(ready)) return yield* Effect.die(new Error("tab-list wait ignored the desktop closing"))
        expect(message(yield* ready.value)).toContain("did not run")
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

test("an ordinary reconnect replays onto the new connection id", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        const first = yield* app.connect("desktop-a")
        const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* Fiber.interrupt(first)
        yield* app.connect("desktop-b")
        const replayed = yield* app.take("command", "desktop-b")
        if (replayed.type !== "command") return yield* Effect.die(new Error("expected the reconnected command"))
        expect(replayed.connectionID).toBe("desktop-b")
        yield* app.methods.command({ sessionID, connectionID: "desktop-b", requestID: replayed.requestID }, call)
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-b",
            requestID: replayed.requestID,
            outcome: { type: "success", result: { value: { tabs: [], focusedTabID: null }, files: [] } },
          },
          call,
        )
        expect((yield* Fiber.join(pending)).output).toEqual({ tabs: [], focusedTabID: null })
        expect(app.connection.waiting(sessionID)).toBe(0)
      }),
    ),
  )
})

test("interrupting a reconnect wait removes it from the session", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        const attachment = yield* app.connect("desktop-a")
        const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* Fiber.interrupt(attachment)
        yield* Effect.yieldNow
        expect(app.connection.waiting(sessionID)).toBe(1)
        yield* Fiber.interrupt(pending)
        expect(app.connection.waiting(sessionID)).toBe(0)
      }),
    ),
  )
})

test("the command timeout removes a reconnect wait", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        const attachment = yield* app.connect("desktop-a")
        const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* TestClock.adjust("59 seconds")
        yield* Fiber.interrupt(attachment)
        yield* Effect.yieldNow
        expect(app.connection.waiting(sessionID)).toBe(1)
        yield* TestClock.adjust("1 second")
        const failure = message(yield* Effect.exit(Fiber.join(pending)))
        expect(failure).toContain("[browser.timeout]")
        expect(app.connection.waiting(sessionID)).toBe(0)
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

for (const type of ["session.deleted", "session.moved"] as const) {
  test(`${type} drops reconnect waits`, async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const app = yield* open
          const attachment = yield* app.connect("desktop-a")
          const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
          yield* app.take("command", "desktop-a")
          yield* Fiber.interrupt(attachment)
          yield* Effect.yieldNow
          expect(app.connection.waiting(sessionID)).toBe(1)
          yield* app.end(type)
          yield* Effect.yieldNow
          expect(app.connection.waiting(sessionID)).toBe(0)
          expect(app.connection.retired(sessionID)).toBe(true)
          const failure = message(yield* Effect.exit(Fiber.join(pending)))
          expect(failure).toContain("did not run")
        }),
      ),
    )
  })
}

for (const type of ["session.deleted", "session.moved"] as const) {
  test(`${type} fails an untaken command while the desktop is still attached`, async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const app = yield* open
          yield* app.connect("desktop-a")
          const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
          const settled = yield* Deferred.make<Exit.Exit<unknown, unknown>>()
          yield* Effect.exit(Fiber.join(pending)).pipe(
            Effect.flatMap((exit) => Deferred.succeed(settled, exit)),
            Effect.forkScoped({ startImmediately: true }),
          )
          // Seen by the desktop, but not retrieved, so the close reaches adopt.
          yield* app.take("command", "desktop-a")
          yield* app.end(type)
          yield* Effect.yieldNow
          const ready = yield* Deferred.poll(settled)
          if (Option.isNone(ready)) return yield* Effect.die(new Error("command waited after the session ended"))
          const failure = message(yield* ready.value)
          expect(failure).toContain("did not run")
          expect(failure).not.toContain("may already have run")
          expect(app.connection.waiting(sessionID)).toBe(0)
          // The ban outlives the handler, so this command cannot be replayed onto a later attach.
          expect(app.connection.retired(sessionID)).toBe(true)
          const again = yield* app.connect("desktop-b")
          yield* Effect.yieldNow
          const replayed: string[] = []
          let queued = yield* Queue.poll(app.events)
          while (Option.isSome(queued)) {
            if (queued.value.type === "command") replayed.push(queued.value.connectionID)
            queued = yield* Queue.poll(app.events)
          }
          expect(replayed).toEqual([])
          const next = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
          const nextSettled = yield* Deferred.make<Exit.Exit<unknown, unknown>>()
          yield* Effect.exit(Fiber.join(next)).pipe(
            Effect.flatMap((exit) => Deferred.succeed(nextSettled, exit)),
            Effect.forkScoped({ startImmediately: true }),
          )
          yield* app.take("command", "desktop-b")
          yield* Fiber.interrupt(again)
          yield* Effect.yieldNow
          const dropped = yield* Deferred.poll(nextSettled)
          if (Option.isNone(dropped)) return yield* Effect.die(new Error("re-attach drop waited out the ban"))
          expect(message(yield* dropped.value)).toContain("did not run")
          expect(app.connection.waiting(sessionID)).toBe(0)
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    )
  })
}

test("a later delete extends the ban started by a move", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* app.end("session.moved")
        yield* Effect.yieldNow
        expect(message(yield* Effect.exit(Fiber.join(pending)))).toContain("did not run")
        expect(app.connection.waiting(sessionID)).toBe(0)
        yield* TestClock.adjust("1 second")
        yield* app.end("session.deleted")
        yield* Effect.yieldNow
        yield* TestClock.adjust("1 second")
        yield* Effect.yieldNow
        expect(app.connection.retired(sessionID)).toBe(true)
        yield* TestClock.adjust("1 second")
        yield* Effect.yieldNow
        expect(app.connection.retired(sessionID)).toBe(false)
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

test("a close that already has the result keeps that result", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        const attachment = yield* app.connect("desktop-a")
        const pending = yield* app.invoke("browser.tabs.list", {}).pipe(Effect.forkScoped({ startImmediately: true }))
        const event = yield* app.take("command", "desktop-a")
        if (event.type !== "command") return yield* Effect.die(new Error("expected a browser command"))
        yield* app.methods.command({ sessionID, connectionID: "desktop-a", requestID: event.requestID }, call)
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-a",
            requestID: event.requestID,
            outcome: { type: "success", result: { value: { tabs: [tab], focusedTabID: tabID }, files: [] } },
          },
          call,
        )
        yield* Fiber.interrupt(attachment)
        expect((yield* Fiber.join(pending)).output).toEqual({ tabs: [tab], focusedTabID: tabID })
      }),
    ),
  )
})

test("cancelling a replay cancels the command on the new desktop", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        yield* app.methods.state({ sessionID, connectionID: "desktop-a", state }, call)
        const pending = yield* app
          .invoke("browser.snapshot", { tabID })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* app.connect("desktop-b")
        yield* app.methods.state(
          { sessionID, connectionID: "desktop-b", state: { tabs: [restored], focusedTabID: tabID } },
          call,
        )
        const replayed = yield* app.take("command", "desktop-b")
        if (replayed.type !== "command") return yield* Effect.die(new Error("expected the replayed snapshot"))
        yield* Fiber.interrupt(pending)
        const cancel = yield* app.take("cancel", "desktop-b")
        if (cancel.type !== "cancel") return yield* Effect.die(new Error("expected a cancel"))
        expect(cancel.requestID).toBe(replayed.requestID)
      }),
    ),
  )
})

test("a replay that never finishes times out and cancels the new command", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        yield* app.methods.state({ sessionID, connectionID: "desktop-a", state }, call)
        const pending = yield* app
          .invoke("browser.snapshot", { tabID })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* app.connect("desktop-b")
        yield* app.methods.state(
          { sessionID, connectionID: "desktop-b", state: { tabs: [restored], focusedTabID: tabID } },
          call,
        )
        const replayed = yield* app.take("command", "desktop-b")
        if (replayed.type !== "command") return yield* Effect.die(new Error("expected the replayed snapshot"))
        yield* TestClock.adjust("60 seconds")
        const failure = message(yield* Effect.exit(Fiber.join(pending)))
        expect(failure).toContain("[browser.timeout]")
        expect(failure).toContain("browser.snapshot")
        const cancel = yield* app.take("cancel", "desktop-b")
        if (cancel.type !== "cancel") return yield* Effect.die(new Error("expected a cancel"))
        expect(cancel.requestID).toBe(replayed.requestID)
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

const approved = { resources: ["https://example.com/"], key: "tab-1" }
const changed = { resources: ["https://example.com/"], key: "tab-2" }
const click = { type: "click" as const, tabID, ref: Browser.Ref.make("e1") }

test("a replay re-inspects an approved target and drops the action when it changed", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        yield* app.methods.state({ sessionID, connectionID: "desktop-a", state }, call)
        const aimed = yield* app.connection.target(sessionID, click)
        const pending = yield* aimed.request([], approved).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* app.connect("desktop-b")
        yield* app.methods.state(
          { sessionID, connectionID: "desktop-b", state: { tabs: [restored], focusedTabID: tabID } },
          call,
        )
        const replayed = yield* app.take("command", "desktop-b")
        if (replayed.type !== "command") return yield* Effect.die(new Error("expected a re-inspect"))
        const command = yield* app.methods.command(
          { sessionID, connectionID: "desktop-b", requestID: replayed.requestID },
          call,
        )
        expect(command.inspect).toBe(true)
        expect(command.target).toBeUndefined()
        expect(command.generation).toBe(restored.generation)
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-b",
            requestID: replayed.requestID,
            outcome: { type: "success", result: { value: changed, files: [] } },
          },
          call,
        )
        const failure = message(yield* Effect.exit(Fiber.join(pending)))
        expect(failure).toContain("did not run")
        expect(yield* Queue.size(app.events)).toBe(0)
      }),
    ),
  )
})

test("a replay runs an approved action when re-inspection still matches", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        yield* app.methods.state({ sessionID, connectionID: "desktop-a", state }, call)
        const aimed = yield* app.connection.target(sessionID, click)
        const pending = yield* aimed.request([], approved).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* app.connect("desktop-b")
        yield* app.methods.state(
          { sessionID, connectionID: "desktop-b", state: { tabs: [restored], focusedTabID: tabID } },
          call,
        )
        const inspect = yield* app.take("command", "desktop-b")
        if (inspect.type !== "command") return yield* Effect.die(new Error("expected a re-inspect"))
        yield* app.methods.command({ sessionID, connectionID: "desktop-b", requestID: inspect.requestID }, call)
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-b",
            requestID: inspect.requestID,
            outcome: { type: "success", result: { value: approved, files: [] } },
          },
          call,
        )
        const replayed = yield* app.take("command", "desktop-b")
        if (replayed.type !== "command") return yield* Effect.die(new Error("expected the approved click"))
        const command = yield* app.methods.command(
          { sessionID, connectionID: "desktop-b", requestID: replayed.requestID },
          call,
        )
        expect(command.inspect).toBeUndefined()
        expect(command.target).toEqual(approved)
        expect(command.generation).toBe(restored.generation)
        expect(command.action).toMatchObject(click)
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-b",
            requestID: replayed.requestID,
            outcome: { type: "success", result: { value: restored, files: [] } },
          },
          call,
        )
        expect((yield* Fiber.join(pending)).value).toEqual(restored)
      }),
    ),
  )
})

test("a failed re-inspection reports that the action did not run", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* open
        yield* app.connect("desktop-a")
        yield* app.methods.state({ sessionID, connectionID: "desktop-a", state }, call)
        const aimed = yield* app.connection.target(sessionID, click)
        const pending = yield* aimed.request([], approved).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* app.take("command", "desktop-a")
        yield* app.connect("desktop-b")
        yield* app.methods.state(
          { sessionID, connectionID: "desktop-b", state: { tabs: [restored], focusedTabID: tabID } },
          call,
        )
        const inspect = yield* app.take("command", "desktop-b")
        if (inspect.type !== "command") return yield* Effect.die(new Error("expected a re-inspect"))
        yield* app.methods.command({ sessionID, connectionID: "desktop-b", requestID: inspect.requestID }, call)
        yield* app.methods.result(
          {
            sessionID,
            connectionID: "desktop-b",
            requestID: inspect.requestID,
            outcome: { type: "failure", code: "operation_failed", message: "inspect broke" },
          },
          call,
        )
        const failure = message(yield* Effect.exit(Fiber.join(pending)))
        expect(failure).toContain("did not run")
        expect(failure).not.toContain("inspect broke")
        expect(app.connection.waiting(sessionID)).toBe(0)
      }),
    ),
  )
})
