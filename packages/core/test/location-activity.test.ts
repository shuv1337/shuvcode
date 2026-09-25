import { describe, expect } from "bun:test"
import { Clock, Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, RcMap, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Location } from "@opencode/core/location"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationServiceMap, type LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Image } from "@opencode/core/image"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { ToolActivity } from "@opencode/core/tool-activity"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { createLLMEventPublisher } from "@opencode/core/session/runner/publish-llm-event"
import { Workspace } from "@opencode/core/workspace"
import { LLMEvent } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionMessage } from "@opencode/schema/session-message"
import { CallID, Error, type Info } from "@opencode/schema/tool"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

// Keep real execution ownership, location caching, forms, and eviction. The fixture
// runner waits on a form instead of making a model request before asking a question.
const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        // The fixture only exercises these three Location services.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.merge(
          Layer.succeed(
            Location.Service,
            Location.Service.of({
              directory: ref.directory,
              workspaceID: ref.workspaceID,
              project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
            }),
          ),
          Layer.effect(
            SessionRunner.Service,
            Effect.gen(function* () {
              const forms = yield* Form.Service
              return SessionRunner.Service.of({
                drain: ({ sessionID }) =>
                  forms
                    .ask({
                      sessionID,
                      title: "Questions",
                      fields: [{ key: "runtime", type: "string" }],
                    })
                    .pipe(
                      Effect.orDie,
                      Effect.as(SessionRunner.DrainResult.Complete()),
                      Effect.onInterrupt(() => Effect.sleep("5 minutes")),
                    ),
              })
            }),
          ),
        ).pipe(
          Layer.provideMerge(Form.layer),
          Layer.provide(Layer.succeed(Bus.Service, bus)),
          Layer.fresh,
        ) as unknown as Layer.Layer<LocationServices>,
      { idleTimeToLive: Duration.infinity },
    )
    return {
      ...map,
      get: (ref: Location.Ref) => map.get(LocationServiceMap.canonical(ref)),
      contextEffect: (ref: Location.Ref) => map.contextEffect(LocationServiceMap.canonical(ref)),
      contextEffectOption: (ref: Location.Ref) => map.contextEffectOption(LocationServiceMap.canonical(ref)),
      invalidate: (ref: Location.Ref) => map.invalidate(LocationServiceMap.canonical(ref)),
    }
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      LocationServiceMap.node,
      SessionExecution.node,
      LocationActivity.node,
    ]),
    [
      LocationServiceMap.node.replace(
        makeGlobalNode({
          service: LocationServiceMap.Service,
          layer: locations,
          deps: [Bus.node],
        }),
      ),
    ],
  ),
)

describe("LocationActivity eviction", () => {
  for (const [count, admission] of [
    [1, "none"],
    [2, "none"],
    [1, "other"],
    [1, "same"],
  ] as const) {
    const newWork = admission !== "none"
    it.effect(
      `interrupts ${count} waiting executions before eviction (${admission} session admitted during cleanup)`,
      () =>
        Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const bus = yield* Bus.Service
          const map = yield* LocationServiceMap.Service
          const execution = yield* SessionExecution.Service
          const store = yield* SessionStore.Service
          const sessionIDs = Array.from({ length: count }, (_, index) =>
            Session.ID.make(`ses_waiting_question_${index}`),
          )
          const newcomer = admission === "same" ? sessionIDs[0] : Session.ID.make("ses_new_question")
          const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/project") })
          const idle = Location.Ref.make({ directory: ref.directory, workspaceID: Workspace.ID.make("wrk_idle") })
          yield* db
            .insert(ProjectTable)
            .values({ id: Project.ID.global, worktree: ref.directory, sandboxes: [] })
            .run()
            .pipe(Effect.orDie)
          yield* db
            .insert(SessionTable)
            .values(
              Array.from(new Set([...sessionIDs, newcomer]), (sessionID) => ({
                id: sessionID,
                project_id: Project.ID.global,
                slug: "question",
                directory: ref.directory,
                title: "Waiting question",
                version: "test",
              })),
            )
            .run()
            .pipe(Effect.orDie)

          const created = yield* Deferred.make<void>()
          const newCreated = yield* Deferred.make<void>()
          const pending: Form.Info[] = []
          const interrupted: SessionEvent.Execution.Interrupted["data"][] = []
          const unsubscribe = yield* bus.listen((event) =>
            Effect.gen(function* () {
              if (event.type === SessionEvent.Execution.Interrupted.type) {
                interrupted.push(Schema.decodeUnknownSync(SessionEvent.Execution.Interrupted.data)(event.data))
              }
              if (event.type !== Form.Event.Created.type) return
              pending.push(Schema.decodeUnknownSync(Form.Event.Created.data)(event.data).form)
              if (pending.length === count) yield* Deferred.succeed(created, undefined)
              if (pending.length > count) yield* Deferred.succeed(newCreated, undefined)
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const running = yield* Effect.forEach(sessionIDs, (sessionID) =>
            execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped),
          )
          yield* Effect.addFinalizer(() =>
            Effect.forEach([...sessionIDs, newcomer], (sessionID) => execution.interrupt(sessionID)).pipe(
              Effect.andThen(TestClock.adjust("5 minutes")),
            ),
          )
          yield* Deferred.await(created)
          const context = yield* map.contextEffect(ref).pipe(Effect.scoped)
          const forms = Context.get(context, Form.Service)
          expect((yield* store.listSuspended()).toSorted()).toEqual(sessionIDs.toSorted())
          yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)

          // Human input produces no durable activity while the question is pending.
          yield* TestClock.adjust("1 minute")
          yield* TestClock.adjust("62 minutes")
          // Interruption has cancelled each question, but slow cleanup still owns the graph.
          expect(Array.from(yield* execution.active).toSorted()).toEqual(sessionIDs.toSorted())
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
          expect(yield* forms.list()).toEqual([])
          for (const form of pending) expect(yield* forms.state(form.id)).toEqual({ status: "cancelled" })

          if (newWork) {
            yield* execution.wake(newcomer)
            if (admission === "other") yield* Deferred.await(newCreated)
          }
          yield* TestClock.adjust("5 minutes")
          if (newWork) yield* Deferred.await(newCreated)
          const results = yield* Effect.forEach(running, Fiber.join)
          expect(results.every((exit) => exit._tag === "Failure")).toBe(true)
          expect(Array.from(yield* execution.active)).toEqual(newWork ? [newcomer] : [])
          expect(yield* store.listSuspended()).toEqual(newWork ? [newcomer] : [])
          expect(interrupted.toSorted((a, b) => a.sessionID.localeCompare(b.sessionID))).toEqual(
            sessionIDs.map((sessionID) => ({ sessionID, reason: "inactivity" })),
          )
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual(newWork ? [ref] : [])
          if (newWork) {
            expect(yield* forms.list({ sessionID: newcomer })).toEqual([pending[count]])
            if (admission === "same") {
              const later = LocationServiceMap.canonical({ directory: AbsolutePath.make("/later") })
              yield* Location.Service.pipe(Effect.provide(map.get(later)), Effect.scoped)
              yield* TestClock.adjust("30 minutes")
              // Keep fresh work active while a different graph reaches its own deadline.
              yield* bus.publish(SessionEvent.Execution.Started, { sessionID: newcomer }, { location: ref })
              yield* TestClock.adjust("32 minutes")
              expect(Array.from(yield* execution.active)).toEqual([newcomer])
              expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
            }
            yield* execution.interrupt(newcomer)
            yield* TestClock.adjust("5 minutes")
            yield* execution.awaitIdle(newcomer)
            yield* TestClock.adjust("62 minutes")
            expect(yield* store.listSuspended()).toEqual([])
            expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
          }
        }),
    )
  }
})

type ToolGate = {
  mode: "hold" | "fail" | "die" | "idle" | "hosted" | "hooks"
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<string>
  readonly afterStarted: Deferred.Deferred<void>
  readonly afterRelease: Deferred.Deferred<void>
  readonly settle: Deferred.Deferred<void>
  readonly delivered: Deferred.Deferred<string>
}

const toolServices = LayerNode.compile(LayerNode.group([Tool.node, PluginHooks.node]), {
  replacements: [Image.node.replace(Layer.mock(Image.Service, { normalize: () => Effect.die("unused") }))],
})

const gates = new Map<string, ToolGate>()

const timeToLive = "5 seconds"
const sweepInterval = "1 second"

const toolLocations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        // The fixture only exercises Location, the runner, and the test gate.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        (() => {
          const gate: ToolGate = {
            mode: "hold",
            started: Deferred.makeUnsafe<void>(),
            release: Deferred.makeUnsafe<string>(),
            afterStarted: Deferred.makeUnsafe<void>(),
            afterRelease: Deferred.makeUnsafe<void>(),
            settle: Deferred.makeUnsafe<void>(),
            delivered: Deferred.makeUnsafe<string>(),
          }
          gates.set(ref.directory, gate)
          const tool: Info = {
            name: "hold",
            description: "Hold",
            input: {},
            options: { codemode: false },
            execute: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(gate.started, undefined)
                if (gate.mode === "fail") return yield* new Error({ message: "nope" })
                if (gate.mode === "die") return yield* Effect.die("tool defect")
                const value = yield* Deferred.await(gate.release)
                return { content: value }
              }),
          }
          const context = {
            agent: Agent.ID.make("build"),
            messageID: SessionMessage.ID.make("msg_hold"),
            id: CallID.make("call_hold"),
            progress: () => Effect.void,
          }
          return Layer.merge(
            Layer.merge(
              Layer.succeed(
                Location.Service,
                Location.Service.of({
                  directory: ref.directory,
                  workspaceID: ref.workspaceID,
                  project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
                }),
              ),
              Layer.succeed(
                SessionRunner.Service,
                SessionRunner.Service.of({
                  drain: ({ sessionID }) =>
                    Effect.gen(function* () {
                      if (gate.mode === "idle") {
                        yield* Deferred.succeed(gate.started, undefined)
                        yield* Deferred.await(gate.settle)
                        return SessionRunner.DrainResult.Complete()
                      }
                      if (gate.mode === "hosted") {
                        const publisher = createLLMEventPublisher(
                          { publish: () => Effect.void } as never,
                          {
                            sessionID,
                            assistantMessageID: SessionMessage.ID.make("msg_hosted"),
                            agent: Agent.ID.make("build"),
                            model: { id: Model.ID.make("test"), providerID: Provider.ID.opencode },
                            providerMetadataKey: "openai",
                            started: 0,
                          },
                        )
                        yield* publisher.publish(
                          LLMEvent.toolCall({
                            id: "call_hosted",
                            name: "web_search",
                            input: {},
                            providerExecuted: true,
                          }),
                        )
                        yield* Deferred.succeed(gate.started, undefined)
                        yield* Effect.yieldNow
                        const value = yield* Deferred.await(gate.release)
                        if (value === "missing") {
                          yield* publisher.failUnsettledTools({ type: "aborted", message: "stream ended" })
                        } else {
                          yield* publisher.publish(
                            LLMEvent.toolResult({
                              id: "call_hosted",
                              name: "web_search",
                              providerExecuted: true,
                              result: { type: "text", value },
                            }),
                          )
                        }
                        yield* Deferred.succeed(gate.delivered, value)
                        yield* Deferred.await(gate.settle)
                        return SessionRunner.DrainResult.Complete()
                      }
                      if (gate.mode === "hooks") {
                        const tools = yield* Tool.Service
                        const hooks = yield* PluginHooks.Service
                        yield* hooks.register("tool", "execute.before", () =>
                          Effect.gen(function* () {
                            yield* Deferred.succeed(gate.started, undefined)
                            yield* Effect.yieldNow
                            yield* Deferred.await(gate.release)
                          }),
                        )
                        yield* hooks.register("tool", "execute.after", () =>
                          Effect.gen(function* () {
                            yield* Deferred.succeed(gate.afterStarted, undefined)
                            yield* Effect.yieldNow
                            yield* Deferred.await(gate.afterRelease)
                          }),
                        )
                        yield* tools.transform((editor) => editor.add(tool))
                        const snapshot = yield* tools.snapshot()
                        const result = yield* snapshot.execute({
                          sessionID,
                          ...context,
                          call: { type: "tool-call", id: "call_hold", name: "hold", input: {} },
                        })
                        const item = result.content[0]
                        if (item?.type !== "text") return yield* Effect.die("expected text")
                        yield* Deferred.succeed(gate.delivered, item.text)
                        return SessionRunner.DrainResult.Complete()
                      }
                      const activity = yield* ToolActivity.Service
                      const result = yield* activity.lease(sessionID).pipe(
                        Effect.andThen(
                          execute(tool, {}, { sessionID, ...context }).pipe(Effect.orDie),
                        ),
                        Effect.scoped,
                      )
                      const item = result.content[0]
                      if (item?.type !== "text") return yield* Effect.die("expected text")
                      yield* Deferred.succeed(gate.delivered, item.text)
                      yield* Deferred.await(gate.settle)
                      return SessionRunner.DrainResult.Complete()
                    }) as unknown as Effect.Effect<SessionRunner.DrainResult, SessionRunner.RunError>,
                }),
              ),
            ),
            toolServices,
          ).pipe(Layer.fresh)
        })() as unknown as Layer.Layer<LocationServices>,
      { idleTimeToLive: Duration.infinity },
    )
    return {
      ...map,
      get: (ref: Location.Ref) => map.get(LocationServiceMap.canonical(ref)),
      contextEffect: (ref: Location.Ref) => map.contextEffect(LocationServiceMap.canonical(ref)),
      contextEffectOption: (ref: Location.Ref) => map.contextEffectOption(LocationServiceMap.canonical(ref)),
      invalidate: (ref: Location.Ref) => map.invalidate(LocationServiceMap.canonical(ref)),
    }
  }),
)

const activityGraph = (beforeDecision?: Effect.Effect<void, never, ToolActivity.Service>) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      LocationServiceMap.node,
      SessionExecution.node,
      LocationActivity.node,
      ToolActivity.node,
    ]),
    [
      LocationServiceMap.node.replace(
        makeGlobalNode({
          service: LocationServiceMap.Service,
          layer: toolLocations,
          deps: [],
        }),
      ),
      LocationActivity.node.replace(
        makeGlobalNode({
          service: LocationActivity.Service,
          layer: LocationActivity.layer({
            timeToLive,
            sweepInterval,
            ...(beforeDecision ? { beforeDecision } : {}),
          }),
          deps: [Bus.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node, ToolActivity.node],
        }),
      ),
    ],
  )

const activity = testEffect(activityGraph())

let acquireSession: Session.ID | undefined
const acquireDecision = Effect.gen(function* () {
  if (!acquireSession) return
  const leases = yield* ToolActivity.Service
  if ((yield* leases.count(acquireSession)) > 0) return
  yield* leases.acquire(acquireSession)
})

let releaseGate: ToolGate | undefined
let releasedAt = 0
let decisionAt = 0
const releaseDecision = Effect.gen(function* () {
  const gate = releaseGate
  if (!gate) return
  releaseGate = undefined
  yield* Deferred.succeed(gate.release, "done")
  yield* Deferred.await(gate.delivered)
  releasedAt = yield* Clock.currentTimeMillis
  yield* Effect.sleep("2 seconds")
  decisionAt = yield* Clock.currentTimeMillis
})

const acquireRace = testEffect(activityGraph(acquireDecision))
const releaseRace = testEffect(activityGraph(releaseDecision))

const watchInterruptions = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const interrupted: SessionEvent.Execution.Interrupted["data"][] = []
  const unsubscribe = yield* bus.listen((event) =>
    Effect.sync(() => {
      if (event.type !== SessionEvent.Execution.Interrupted.type) return
      interrupted.push(Schema.decodeUnknownSync(SessionEvent.Execution.Interrupted.data)(event.data))
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return interrupted
})

const seed = (sessionID: Session.ID, directory: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make(directory) })
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: ref.directory, sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "tool",
        directory: ref.directory,
        title: "Tool",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    return ref
  })

describe("LocationActivity tool leases", () => {
  activity.effect("keeps a Location active while a tool is in flight and evicts one TTL after it completes", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_holding")
      const ref = yield* seed(sessionID, "/hold")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)

      yield* TestClock.adjust("30 seconds")
      expect(Array.from(yield* execution.active)).toEqual([sessionID])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect(interrupted).toEqual([])
      expect(yield* leases.count(sessionID)).toBe(1)

      yield* Deferred.succeed(gate.release, "done")
      expect(yield* Deferred.await(gate.delivered)).toBe("done")
      expect(yield* leases.count(sessionID)).toBe(0)
      expect(Array.from(yield* execution.active)).toEqual([sessionID])
      yield* TestClock.adjust("4 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect(interrupted).toEqual([])

      yield* TestClock.adjust("2 seconds")
      expect(interrupted).toEqual([{ sessionID, reason: "inactivity" }])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      expect((yield* Fiber.join(running))._tag).toBe("Failure")
    }),
  )

  activity.effect("evicts a Location with no in-flight tools on schedule", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_idle")
      const ref = yield* seed(sessionID, "/idle")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      gate.mode = "idle"
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)

      yield* TestClock.adjust("5 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect(interrupted).toEqual([])
      yield* TestClock.adjust("2 seconds")
      expect(interrupted).toEqual([{ sessionID, reason: "inactivity" }])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      expect((yield* Fiber.join(running))._tag).toBe("Failure")
    }),
  )

  for (const mode of ["fail", "die"] as const) {
    activity.effect(
      `releases the lease when a tool ${mode === "fail" ? "fails" : "defects"} so eviction stays on schedule`,
      () =>
        Effect.gen(function* () {
          const map = yield* LocationServiceMap.Service
          const execution = yield* SessionExecution.Service
          const leases = yield* ToolActivity.Service
          const interrupted = yield* watchInterruptions
          const sessionID = Session.ID.make(`ses_${mode}`)
          const ref = yield* seed(sessionID, `/${mode}`)
          yield* map.contextEffect(ref).pipe(Effect.scoped)
          const gate = gates.get(ref.directory)
          if (!gate) return yield* Effect.die("missing tool gate")
          gate.mode = mode
          const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
          yield* Deferred.await(gate.started)
          expect((yield* Fiber.join(running))._tag).toBe("Failure")
          expect(yield* leases.count(sessionID)).toBe(0)

          yield* TestClock.adjust("4 seconds")
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
          expect(interrupted).toEqual([])
          yield* TestClock.adjust("2 seconds")
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
        }),
    )
  }

  activity.effect("releases the lease when a tool is interrupted so eviction stays on schedule", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_interrupted")
      const ref = yield* seed(sessionID, "/interrupted")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)
      yield* TestClock.adjust("30 seconds")
      expect(interrupted).toEqual([])
      expect(yield* leases.count(sessionID)).toBe(1)
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])

      yield* execution.interrupt(sessionID, { awaitSettlement: true })
      expect(yield* leases.count(sessionID)).toBe(0)
      expect(interrupted).toEqual([{ sessionID, reason: "user" }])
      yield* TestClock.adjust("4 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      yield* TestClock.adjust("2 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      expect(interrupted.some((event) => event.reason === "inactivity")).toBe(false)
      expect((yield* Fiber.join(running))._tag).toBe("Failure")
    }),
  )

  activity.effect("keeps a Location active across execute.before and execute.after", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_hooks")
      const ref = yield* seed(sessionID, "/hooks")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      gate.mode = "hooks"
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)
      yield* Effect.yieldNow
      yield* TestClock.adjust("30 seconds")
      expect(interrupted).toEqual([])
      expect(yield* leases.count(sessionID)).toBe(1)
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])

      yield* Deferred.succeed(gate.release, "done")
      yield* Deferred.await(gate.afterStarted)
      yield* Effect.yieldNow
      yield* TestClock.adjust("30 seconds")
      expect(interrupted).toEqual([])
      expect(yield* leases.count(sessionID)).toBe(1)

      yield* Deferred.succeed(gate.afterRelease, undefined)
      expect(yield* Deferred.await(gate.delivered)).toBe("done")
      expect(yield* leases.count(sessionID)).toBe(0)
      yield* Fiber.join(running)
      yield* TestClock.adjust("4 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      yield* TestClock.adjust("2 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  activity.effect("keeps a Location active while a hosted tool call is in flight", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_hosted")
      const ref = yield* seed(sessionID, "/hosted")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      gate.mode = "hosted"
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)
      yield* TestClock.adjust("30 seconds")
      expect(interrupted).toEqual([])
      expect(yield* leases.count(sessionID)).toBe(1)
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])

      yield* Deferred.succeed(gate.release, "done")
      expect(yield* Deferred.await(gate.delivered)).toBe("done")
      expect(yield* leases.count(sessionID)).toBe(0)
      yield* Deferred.succeed(gate.settle, undefined)
      yield* Fiber.join(running)
      yield* TestClock.adjust("4 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      yield* TestClock.adjust("2 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  activity.effect("releases a hosted lease when the execution is interrupted", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const sessionID = Session.ID.make("ses_hosted_interrupt")
      const ref = yield* seed(sessionID, "/hosted-interrupt")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      gate.mode = "hosted"
      yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)
      yield* Effect.yieldNow
      expect(yield* leases.count(sessionID)).toBe(1)
      yield* execution.interrupt(sessionID, { awaitSettlement: true })
      expect(yield* leases.count(sessionID)).toBe(0)
    }),
  )

  activity.effect("releases a hosted lease when the stream ends without a result", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const sessionID = Session.ID.make("ses_hosted_end")
      const ref = yield* seed(sessionID, "/hosted-end")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      gate.mode = "hosted"
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)
      expect(yield* leases.count(sessionID)).toBe(1)
      yield* Deferred.succeed(gate.release, "missing")
      expect(yield* Deferred.await(gate.delivered)).toBe("missing")
      expect(yield* leases.count(sessionID)).toBe(0)
      yield* Deferred.succeed(gate.settle, undefined)
      yield* Fiber.join(running)
      yield* TestClock.adjust("8 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  activity.effect("follows a lease to the session's placement at sweep time", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_moved")
      const from = yield* seed(sessionID, "/from")
      const to = LocationServiceMap.canonical({ directory: AbsolutePath.make("/to") })
      yield* map.contextEffect(from).pipe(Effect.scoped)
      const gate = gates.get(from.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)
      yield* TestClock.adjust("30 seconds")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([from])
      expect(yield* leases.count(sessionID)).toBe(1)

      yield* db.update(SessionTable).set({ directory: to.directory }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      yield* map.contextEffect(to).pipe(Effect.scoped)
      yield* TestClock.adjust("8 seconds")
      expect(interrupted).toEqual([])
      expect(Array.from(yield* execution.active)).toEqual([sessionID])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([to])
      expect(yield* leases.count(sessionID)).toBe(1)

      yield* Deferred.succeed(gate.release, "done")
      yield* Deferred.succeed(gate.settle, undefined)
      yield* Fiber.join(running)
    }),
  )
})

describe("LocationActivity lease races", () => {
  acquireRace.effect("does not interrupt when a lease arrives after expiry is observed", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const leases = yield* ToolActivity.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_race_acquire")
      acquireSession = sessionID
      const ref = yield* seed(sessionID, "/race-acquire")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      gate.mode = "idle"
      yield* execution.resume(sessionID).pipe(Effect.forkScoped)
      yield* Deferred.await(gate.started)
      yield* TestClock.adjust("8 seconds")
      expect(interrupted).toEqual([])
      expect(yield* leases.count(sessionID)).toBe(1)
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      yield* leases.release(sessionID)
      yield* execution.interrupt(sessionID, { awaitSettlement: true })
      yield* Deferred.succeed(gate.settle, undefined)
    }),
  )

  releaseRace.effect("does not restart the idle TTL when a lease releases before the sweep decides", () =>
    Effect.gen(function* () {
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const interrupted = yield* watchInterruptions
      const sessionID = Session.ID.make("ses_race_release")
      const ref = yield* seed(sessionID, "/race-release")
      yield* map.contextEffect(ref).pipe(Effect.scoped)
      const gate = gates.get(ref.directory)
      if (!gate) return yield* Effect.die("missing tool gate")
      releaseGate = gate
      releasedAt = 0
      decisionAt = 0
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(gate.started)
      yield* TestClock.adjust("8 seconds")
      expect(decisionAt - releasedAt).toBeGreaterThanOrEqual(2_000)
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      yield* TestClock.adjust("4 seconds")
      expect(interrupted).toEqual([{ sessionID, reason: "inactivity" }])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      expect((yield* Fiber.join(running))._tag).toBe("Failure")
    }),
  )
})
