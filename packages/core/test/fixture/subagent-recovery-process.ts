import path from "node:path"
import { appendFile } from "node:fs/promises"
import { Deferred, Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { Money } from "@opencode/schema/money"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionRunCoordinator } from "@opencode/core/session/run-coordinator"
import type { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentRecovery } from "@opencode/core/session/subagent-recovery"
import { Tool } from "@opencode/core/tool"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { offlineModels } from "./models"
import { registerToolPlugin } from "../lib/tool"

// The test SIGKILLs the seed once `ready` exists, so its contents may be truncated; both stages take the phase from argv.
const [stage, root, phase] = process.argv.slice(2)
if (!root || (stage !== "seed" && stage !== "recover")) throw new Error("Expected seed|recover and fixture root")

const parentID = Session.ID.make("ses_i407_recovery_parent")
const childID = Session.ID.make("ses_i407_recovery_child")
const assistantID = SessionMessage.ID.make("msg_i407_recovery_assistant")
const inboxID = SessionMessage.ID.make("msg_i407_recovery_inbox")
const model = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("parent") })
const input = { agent: "build", description: "recover child", prompt: "inspect the fixture" }
const isBackground = phase?.startsWith("background-") === true
const callInput = isBackground ? { ...input, background: true } : input
const boundary = phase?.replace(/^background-/, "")

const releaseChild = Deferred.makeUnsafe<void>()

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const coordinator = yield* SessionRunCoordinator.make<Session.ID, SessionRunner.RunError>({
        settled: (id, exit) => {
          const outcome = SessionExecution.terminal(exit)
          return outcome.type === "failed"
            ? bus.publish(
                SessionEvent.Execution.Failed,
                { sessionID: id, error: outcome.error },
                {
                  commit: () => store.release(id),
                },
              )
            : Effect.void
        },
        drain: (id) =>
          id === parentID
            ? Effect.gen(function* () {
                const states = (yield* store.context(id).pipe(Effect.orDie)).flatMap((message) =>
                  message.type === "assistant"
                    ? message.content.flatMap((item) => (item.type === "tool" ? [item.state.status] : []))
                    : [],
                )
                yield* Effect.promise(() => appendFile(path.join(root, "parent-drains"), `${states.join(",")}\n`))
              })
            : Effect.gen(function* () {
                if ((yield* store.context(id).pipe(Effect.orDie)).some((message) => message.type === "idle")) return
                yield* Effect.promise(() => appendFile(path.join(root, "child-runs"), "run\n"))
                if (phase === "prompted") yield* Deferred.await(releaseChild)
                const messageID = SessionMessage.ID.create()
                yield* bus.publish(SessionEvent.Step.Started, {
                  sessionID: id,
                  assistantMessageID: messageID,
                  agent: Agent.ID.make("build"),
                  model,
                  started: 0,
                })
                yield* bus.publish(SessionEvent.Text.Started, {
                  sessionID: id,
                  assistantMessageID: messageID,
                  ordinal: 0,
                })
                yield* bus.publish(SessionEvent.Text.Ended, {
                  sessionID: id,
                  assistantMessageID: messageID,
                  ordinal: 0,
                  text: "child result",
                })
                yield* bus.publish(SessionEvent.Step.Ended, {
                  sessionID: id,
                  assistantMessageID: messageID,
                  finish: "stop",
                  cost: Money.USD.zero,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                })
                yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id })
              }),
      })
      return SessionExecution.Service.of({
        active: coordinator.active,
        isActive: coordinator.isActive,
        wake: coordinator.wake,
        interrupt: () => Effect.succeed(false),
        awaitIdle: coordinator.awaitIdle,
        resume: coordinator.run,
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

const subagentPluginSupervisor = makeLocationNode({
  name: "test/process-subagent-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) => hooks.register("tool", name, callback))
    }),
  ),
  deps: [
    Agent.node,
    Bus.node,
    Config.node,
    Model.node,
    Permission.node,
    Session.node,
    SessionRunnerModel.node,
    Job.node,
    Tool.node,
    PluginHooks.node,
  ],
})

const data = path.join(root, "data")
const cache = path.join(root, "cache")
const globalLayer = Global.layerWith({
  data,
  cache,
  config: path.join(root, "config"),
  state: path.join(root, "state"),
  tmp: path.join(root, "tmp"),
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
})
const layer = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    Bus.node,
    Job.node,
    KV.node,
    Session.node,
    SessionStore.node,
    SessionExecution.node,
    SessionRestart.node,
    LocationServiceMap.node,
    Tool.node,
  ]),
  [
    Database.node.replace(Database.layer({ path: "recovery.db" }).pipe(Layer.provide(globalLayer))),
    Bus.node.replace(Bus.configured({ persist: true })),
    SessionExecution.node.replace(executionNode),
    PluginSupervisor.node.replace(subagentPluginSupervisor),
    Global.node.replace(globalLayer),
    offlineModels,
  ],
)

const program = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const bus = yield* Bus.Service
  const store = yield* SessionStore.Service
  if (stage === "seed") {
    const parent = yield* sessions.create({ id: parentID, location: { directory: AbsolutePath.make(root) }, model })
    const location = (yield* LocationServiceMap.Service).get(parent.location)
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(location))
    const registry = yield* Tool.Service.pipe(Effect.provide(location))
    if (!(yield* registry.snapshot()).definitions.some((tool) => tool.name === "subagent"))
      return yield* Effect.die(new Error("Subagent tool was not registered"))
    if (phase === "ambiguous") {
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parentID,
        assistantMessageID: assistantID,
        agent: Agent.ID.make("build"),
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID: parentID,
        assistantMessageID: assistantID,
        id: "call-ambiguous",
        name: "echo",
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID: parentID,
        assistantMessageID: assistantID,
        id: "call-ambiguous",
        input: { text: "external side effect may have happened" },
        executed: false,
      })
      yield* Effect.promise(() => appendFile(path.join(root, "generic-effects"), "invoked\n"))
      yield* store.claim(parentID)
      yield* Effect.promise(() => Bun.write(path.join(root, "ready"), phase))
      return yield* Effect.never
    }
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID: parentID,
      assistantMessageID: assistantID,
      agent: Agent.ID.make("build"),
      model,
      started: 0,
    })
    yield* bus.publish(SessionEvent.Tool.Input.Started, {
      sessionID: parentID,
      assistantMessageID: assistantID,
      id: "call-recovery",
      name: "subagent",
    })
    yield* bus.publish(SessionEvent.Tool.Called, {
      sessionID: parentID,
      assistantMessageID: assistantID,
      id: "call-recovery",
      input: callInput,
      executed: false,
    })
    if (phase === "unprepared") {
      yield* store.claim(parentID)
      yield* Effect.promise(() => Bun.write(path.join(root, "ready"), phase))
      return yield* Effect.never
    }
    yield* bus.publish(SessionEvent.Tool.SubagentPrepared, {
      sessionID: parentID,
      assistantMessageID: assistantID,
      id: "call-recovery",
      recovery: {
        childSessionID: childID,
        inboxID,
        inputDigest: SubagentRecovery.digest(callInput),
        agent: Agent.ID.make("build"),
        model,
      },
    })
    if (boundary !== "prepared" && boundary !== "exhausted") {
      yield* sessions.create({ id: childID, parentID, agent: Agent.ID.make("build"), model })
      if (boundary !== "created") {
        yield* sessions.prompt({ id: inboxID, sessionID: childID, text: input.prompt, resume: false })
        if (boundary === "running") yield* store.claim(childID)
        if (boundary === "cancelled-pending")
          yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: childID, reason: "user" })
        if (boundary === "cancelled") {
          yield* SessionInbox.promote((yield* Database.Service).db, bus, childID, "input")
          yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: childID, reason: "user" })
        }
        if (boundary === "settled" || boundary === "result") {
          yield* SessionInbox.promote((yield* Database.Service).db, bus, childID, "input")
          yield* (yield* SessionExecution.Service).resume(childID)
          if (boundary === "result")
            yield* bus.publish(SessionEvent.Tool.Success, {
              sessionID: parentID,
              assistantMessageID: assistantID,
              id: "call-recovery",
              content: [
                {
                  type: "text",
                  text: isBackground
                    ? `The subagent is working in the background (sessionID: ${childID}).`
                    : `<subagent sessionID="${childID}" state="completed">\nchild result\n</subagent>`,
                },
              ],
              metadata: { sessionID: childID, status: isBackground ? "running" : "completed" },
              executed: false,
            })
        }
      }
    }
    yield* store.claim(parentID)
    if (phase === "exhausted") for (let i = 0; i < 10; i++) yield* store.countResume(parentID)
    yield* Effect.promise(() => Bun.write(path.join(root, "ready"), phase ?? ""))
    console.log(JSON.stringify({ ready: phase }))
    return yield* Effect.never
  }
  const restart = yield* SessionRestart.Service
  yield* Effect.all([restart.resumeSuspendedSessions, restart.resumeSuspendedSessions], {
    concurrency: 2,
    discard: true,
  })
  if (phase === "prompted") {
    yield* Effect.repeat(
      Effect.sleep("10 millis").pipe(
        Effect.andThen(Effect.promise(() => Bun.file(path.join(root, "child-runs")).exists())),
      ),
      {
        until: (started) => started,
      },
    ).pipe(Effect.timeout("5 seconds"))
    yield* sessions.prompt({ sessionID: parentID, text: "a new prompt while the subagent recovers" })
    yield* Effect.sleep("100 millis")
    yield* Deferred.succeed(releaseChild, undefined)
  }
  if (["ambiguous", "unprepared", "exhausted", "cancelled", "cancelled-pending"].includes(phase ?? "")) {
    yield* Effect.repeat(Effect.sleep("10 millis").pipe(Effect.andThen(sessions.get(parentID))), {
      until: (parent) => parent.outcome === "failed",
    }).pipe(Effect.timeout("5 seconds"))
    const parent = yield* sessions.get(parentID)
    const message = yield* sessions.message({ sessionID: parentID, messageID: assistantID })
    console.log(
      JSON.stringify({
        outcome: parent.outcome,
        tool:
          message?.type === "assistant"
            ? message.content.find((part) => part.type === "tool")?.state.status
            : undefined,
        childCount: (yield* sessions.list({ parentID })).data.length,
        ...(phase === "ambiguous"
          ? {
              effectInvocations: (yield* Effect.promise(() => Bun.file(path.join(root, "generic-effects")).text()))
                .trim()
                .split("\n").length,
            }
          : {}),
      }),
    )
    return
  }
  yield* Effect.repeat(
    Effect.sleep("10 millis").pipe(Effect.andThen(sessions.message({ sessionID: parentID, messageID: assistantID }))),
    {
      until: (message) =>
        message?.type === "assistant" &&
        message.content.some((tool) => tool.type === "tool" && tool.state.status === "completed"),
    },
  ).pipe(Effect.timeout("5 seconds"))
  if (isBackground && boundary !== "result")
    yield* Effect.repeat(Effect.sleep("10 millis").pipe(Effect.andThen(sessions.inbox(parentID))), {
      until: (inbox) => inbox.some((item) => item.type === "synthetic" && item.payload.metadata?.source === "subagent"),
    }).pipe(Effect.timeout("5 seconds"))
  const first = yield* sessions.message({ sessionID: parentID, messageID: assistantID })
  yield* restart.resumeSuspendedSessions
  const second = yield* sessions.message({ sessionID: parentID, messageID: assistantID })
  const children = yield* sessions.list({ parentID })
  const pending = yield* sessions.inbox(childID)
  const messages = yield* sessions.messages({ sessionID: childID })
  const runs = Bun.file(path.join(root, "child-runs"))
  const childRuns = (yield* Effect.promise(() => runs.exists()))
    ? (yield* Effect.promise(() => runs.text())).trim().split("\n").length
    : 0
  if (phase === "prompted") yield* (yield* SessionExecution.Service).awaitIdle(parentID)
  const parentDrains = (yield* Effect.promise(() => Bun.file(path.join(root, "parent-drains")).exists()))
    ? (yield* Effect.promise(() => Bun.file(path.join(root, "parent-drains")).text())).trim().split("\n")
    : []
  const events = yield* Stream.runCollect(sessions.log({ sessionID: parentID, follow: false }))
  const notices = isBackground
    ? (yield* sessions.inbox(parentID)).filter(
        (item) => item.type === "synthetic" && item.payload.metadata?.source === "subagent",
      )
    : []
  const notice = notices[0]
  console.log(
    JSON.stringify({
      childCount: children.data.length,
      admissionCount:
        pending.filter((item) => item.id === inboxID).length +
        messages.filter((message) => message.id === inboxID).length,
      childRuns,
      first:
        first?.type === "assistant"
          ? first.content.filter((item) => item.type === "tool").map((item) => item.state.status)
          : [],
      second:
        second?.type === "assistant"
          ? second.content.filter((item) => item.type === "tool").map((item) => item.state.status)
          : [],
      results: Array.from(events).filter(
        (event) => event.type === "session.tool.success" && event.data.id === "call-recovery",
      ).length,
      ...(phase === "prompted" ? { parentDrains: [...new Set(parentDrains)] } : {}),
      ...(isBackground && boundary !== "result" ? { notices: notices.length } : {}),
      ...(isBackground && boundary === "cancelled"
        ? { noticeState: notice?.type === "synthetic" ? notice.payload.metadata?.state : undefined }
        : {}),
    }),
  )
})

if (stage === "seed") setInterval(() => {}, 1000)
await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(layer)))
