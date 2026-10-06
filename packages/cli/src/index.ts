#!/usr/bin/env bun

import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Cause, Effect } from "effect"
import { getErrorReported } from "effect/Runtime"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Observability } from "@opencode/util/observability"
import { Updater } from "./services/updater"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "./version"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Config } from "./config"
import { Npm } from "@opencode/util/npm"
import { EffectFlock } from "@opencode/util/effect-flock"
import { Heap } from "./heap"
import { CpuProfile } from "./cpu-profile"

if (process.env.OPENCODE_SSH_ASKPASS_PORT) {
  const { askpass } = await import("./ssh-askpass")
  process.exit(await Effect.runPromise(askpass.pipe(Effect.provide(NodeServices.layer))))
}

const Handlers = Runtime.handlers(Commands, {
  $: () => import("./commands/handlers/default"),
  upgrade: () => import("./commands/handlers/upgrade"),
  uninstall: () => import("./commands/handlers/uninstall"),
  acp: () => import("./commands/handlers/acp"),
  api: () => import("./commands/handlers/api"),
  auth: {
    list: () => import("./commands/handlers/auth/list"),
    login: () => import("./commands/handlers/auth/login"),
    logout: () => import("./commands/handlers/auth/logout"),
    export: () => import("./commands/handlers/auth/export"),
    import: () => import("./commands/handlers/auth/import"),
    switch: () => import("./commands/handlers/auth/switch"),
  },
  debug: {
    agents: () => import("./commands/handlers/debug/agents"),
    config: () => import("./commands/handlers/debug/config"),
    paths: () => import("./commands/handlers/debug/paths"),
  },
  mcp: {
    list: () => import("./commands/handlers/mcp/list"),
    add: () => import("./commands/handlers/mcp/add"),
    auth: () => import("./commands/handlers/mcp/auth"),
    logout: () => import("./commands/handlers/mcp/logout"),
  },
  plugin: {
    list: () => import("./commands/handlers/plugin/list"),
    add: () => import("./commands/handlers/plugin/add"),
    check: () => import("./commands/handlers/plugin/check"),
    update: () => import("./commands/handlers/plugin/update"),
    remove: () => import("./commands/handlers/plugin/remove"),
  },
  models: () => import("./commands/handlers/models"),
  stats: () => import("./commands/handlers/stats"),
  mini: () => import("./commands/handlers/mini"),
  run: () => import("./commands/handlers/run"),
  pair: () => import("./commands/handlers/pair"),
  reload: () => import("./commands/handlers/reload"),
  session: {
    list: () => import("./commands/handlers/session/list"),
    delete: () => import("./commands/handlers/session/delete"),
    export: () => import("./commands/handlers/session/export"),
    import: () => import("./commands/handlers/session/import"),
  },
  service: {
    start: () => import("./commands/handlers/service/start"),
    restart: () => import("./commands/handlers/service/restart"),
    status: () => import("./commands/handlers/service/status"),
    stop: () => import("./commands/handlers/service/stop"),
    get: () => import("./commands/handlers/service/get"),
    set: () => import("./commands/handlers/service/set"),
    unset: () => import("./commands/handlers/service/unset"),
  },
  supervisor: {
    up: () => import("./commands/handlers/supervisor/up"),
    init: () => import("./commands/handlers/supervisor/init"),
    start: () => import("./commands/handlers/supervisor/start"),
    stop: () => import("./commands/handlers/supervisor/stop"),
    lead: () => import("./commands/handlers/supervisor/lead"),
    send: () => import("./commands/handlers/supervisor/send"),
    read: () => import("./commands/handlers/supervisor/read"),
    status: () => import("./commands/handlers/supervisor/status"),
    projects: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projects })),
    project: {
      add: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projectAdd })),
      clone: () =>
        import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projectClone })),
      new: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projectNew })),
      set: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projectSet })),
      default: () =>
        import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projectDefault })),
      archive: () =>
        import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projectArchive })),
      restore: () =>
        import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.projectRestore })),
    },
    backlog: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.backlog })),
    bearings: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.bearings })),
    task: () => import("./commands/handlers/supervisor/task"),
    board: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.board })),
    discard: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.discard })),
    delivery: {
      prepare: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.prepare })),
      publish: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.publish })),
      approve: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.approve })),
      land: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.land })),
      cancel: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.cancel })),
      reconcile: () =>
        import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.reconcile })),
      cleanup: () => import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.cleanup })),
    },
    validate: {
      start: () =>
        import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.validateStart })),
      status: () =>
        import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.validateStatus })),
      abort: () =>
        import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.validateAbort })),
      respond: () =>
        import("./commands/handlers/supervisor/delivery").then((module) => ({ default: module.validateRespond })),
    },
    hold: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.hold })),
    release: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.release })),
    retry: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.retry })),
    dispatch: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.dispatch })),
    interrupt: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.interrupt })),
    resume: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.resume })),
    show: () => import("./commands/handlers/supervisor/show"),
    steer: () => import("./commands/handlers/supervisor/steer"),
    cancel: () => import("./commands/handlers/supervisor/cancel"),
    recover: () => import("./commands/handlers/supervisor/recover"),
    complete: () => import("./commands/handlers/supervisor/complete"),
    cleanup: () => import("./commands/handlers/supervisor/cleanup"),
    decisions: () => import("./commands/handlers/supervisor/decisions"),
    answer: () => import("./commands/handlers/supervisor/answer"),
    approve: () => import("./commands/handlers/supervisor/approve"),
    doctor: () => import("./commands/handlers/supervisor/doctor"),
    daemon: () => import("./commands/handlers/supervisor/daemon"),
    native: () => import("./commands/handlers/supervisor/native"),
    serve: () => import("./commands/handlers/supervisor/serve"),
    request: () => import("./commands/handlers/supervisor/request"),
    voice: () => import("./commands/handlers/supervisor/voice"),
    channel: () => import("./commands/handlers/supervisor/parity").then((module) => ({ default: module.channel })),
    inbox: () => import("./commands/handlers/supervisor/parity").then((module) => ({ default: module.inbox })),
    reply: () => import("./commands/handlers/supervisor/parity").then((module) => ({ default: module.reply })),
    away: () => import("./commands/handlers/supervisor/parity").then((module) => ({ default: module.away })),
    knowledge: () => import("./commands/handlers/supervisor/parity").then((module) => ({ default: module.knowledge })),
    delegate: () => import("./commands/handlers/supervisor/parity").then((module) => ({ default: module.delegate })),
    handoff: () => import("./commands/handlers/supervisor/parity").then((module) => ({ default: module.handoff })),
    bridge: () => import("./commands/handlers/supervisor/actions").then((module) => ({ default: module.bridge })),
  },
  serve: () => import("./commands/handlers/serve"),
})

Effect.gen(function* () {
  yield* Heap.listen
  yield* CpuProfile.listen
  const runFork = Effect.runForkWith(yield* Effect.context<never>())
  const uncaughtException = (cause: Error, origin: "uncaughtException" | "unhandledRejection") => {
    runFork(Effect.logError("uncaught exception", { cause, origin }))
  }
  const unhandledRejection = (cause: unknown) => {
    runFork(Effect.logError("unhandled rejection", { cause }))
  }
  process.on("uncaughtException", uncaughtException)
  process.on("unhandledRejection", unhandledRejection)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      process.off("uncaughtException", uncaughtException)
      process.off("unhandledRejection", unhandledRejection)
    }),
  )
  yield* Effect.logInfo("cli starting", {
    version: OPENCODE_VERSION,
    channel: OPENCODE_CHANNEL,
    local: OPENCODE_LOCAL,
    args: process.argv.slice(2),
  })
  return yield* Runtime.run(Commands, Handlers, { version: OPENCODE_VERSION })
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logError("cli process failed", {
      cause,
      args: process.argv.slice(2),
    }).pipe(Effect.andThen(Effect.failCause(cause))),
  ),
  Effect.annotateLogs({ role: "cli" }),
  Effect.provide(Config.layer),
  Effect.provide(Updater.layer),
  Effect.provide(
    LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, Npm.node, EffectFlock.node]), {
      replacements: [
        Global.node.replace(
          Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
        ),
      ],
    }),
  ),
  Effect.provide(
    Observability.layer({
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
      client: process.env.OPENCODE_CLIENT ?? OPENCODE_ARTIFACT,
      version: OPENCODE_VERSION,
      channel: OPENCODE_CHANNEL,
    }),
  ),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  Effect.tap(() => Effect.sync(() => process.exit(process.exitCode ?? 0))),
  // runMain's default reporter logs the fatal cause to stdout. Write it to stderr instead: the
  // desktop and `Service.ensure` only capture stderr from `serve --service`, so this is the only
  // channel through which a startup failure's reason reaches the user.
  Effect.tapCause((cause) =>
    Effect.sync(() => {
      if (Cause.hasInterruptsOnly(cause)) return
      if (!getErrorReported(Cause.squash(cause))) return
      process.stderr.write(Cause.pretty(cause) + "\n")
    }),
  ),
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
