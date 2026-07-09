import { NodeFileSystem } from "@effect/platform-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { run } from "@opencode-ai/tui"
import { loadBuiltinPlugins } from "@opencode-ai/tui/builtins"
import { TuiConfig } from "@opencode-ai/tui/config"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect, Option, Redacted } from "effect"
import { Service } from "@opencode-ai/client/effect"
import { Env } from "../../env"
import { ServiceConfig } from "../../services/service-config"
import { Standalone } from "../../services/standalone"
import { Updater } from "../../services/updater"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const requestedDirectory = Option.getOrUndefined(input.directory)
    if (requestedDirectory !== undefined) process.chdir(requestedDirectory)
    const updater = yield* Updater.Service
    yield* updater.check().pipe(Effect.forkScoped)
    const server = Option.getOrUndefined(input.server)
    if (server !== undefined && input.standalone)
      return yield* Effect.fail(new Error("--server and --standalone cannot be combined"))
    const endpoint = yield* Effect.gen(function* () {
      if (server !== undefined) {
        const password = yield* Env.password
        const explicit = {
          url: server,
          auth: password
            ? { type: "basic" as const, username: "opencode", password: Redacted.value(password) }
            : undefined,
        } satisfies Service.Endpoint
        // Fail loudly before entering the TUI: an explicit server that is
        // unreachable or rejects auth should not present as reconnect churn.
        const response = yield* Effect.tryPromise(() =>
          fetch(new URL("/api/health", server), {
            headers: Service.headers(explicit),
            signal: AbortSignal.timeout(5_000),
          }),
        ).pipe(Effect.mapError((cause) => new Error(`Could not reach server at ${server}`, { cause })))
        if (response.status === 401)
          return yield* Effect.fail(
            new Error(
              password
                ? `Server at ${server} rejected the password`
                : `Server at ${server} requires a password; set OPENCODE_PASSWORD`,
            ),
          )
        if (!response.ok)
          return yield* Effect.fail(new Error(`Server at ${server} responded with status ${response.status}`))
        return explicit
      }
      if (input.standalone) return yield* Standalone.start()
      const options = yield* ServiceConfig.options()
      const found = yield* Service.discover(options)
      return found ?? (yield* Service.start(options))
    })
    // The TUI re-runs discover whenever its event stream drops. For an explicit
    // --server or a standalone child the endpoint is fixed, so reconnects
    // retry the same address; for the managed service discovery re-reads the
    // registration and may start a replacement.
    const serviceOptions = server === undefined && !input.standalone ? yield* ServiceConfig.options() : undefined
    // Only startup enforces the CLI version. A reconnect must accept a server
    // replaced by another client or the two clients will restart it forever.
    const reconnectOptions = serviceOptions ? { ...serviceOptions, version: undefined } : undefined
    const discover = reconnectOptions
      ? () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const found = yield* Service.discover(reconnectOptions)
              return found ?? (yield* Service.start(reconnectOptions))
            }).pipe(Effect.provide(NodeFileSystem.layer)),
          )
      : undefined
    // Restart the managed service in place; start() resolves once the
    // replacement is healthy and the reconnect loop reattaches on its own.
    // Only meaningful in service mode: --server is not ours to restart and a
    // standalone child cannot be respawned.
    const reload = serviceOptions
      ? () =>
          Effect.runPromise(
            Effect.gen(function* () {
              yield* Service.stop(serviceOptions)
              yield* Service.start(serviceOptions)
            }).pipe(Effect.provide(NodeFileSystem.layer)),
          )
      : undefined
    const config = TuiConfig.resolve({}, { terminalSuspend: false })
    let disposeSlots: (() => void) | undefined
    const runFork = Effect.runForkWith(yield* Effect.context())
    yield* run({
      server: {
        endpoint,
        discover,
        reload,
      },
      args: { continue: input.continue, sessionID: Option.getOrUndefined(input.session) },
      config,
      log: (level, message, tags) => {
        const effect =
          level === "debug"
            ? Effect.logDebug(message, tags)
            : level === "warn"
              ? Effect.logWarning(message, tags)
              : level === "error"
                ? Effect.logError(message, tags)
                : Effect.logInfo(message, tags)
        runFork(effect)
      },
      pluginHost: {
        async start(pluginInput) {
          disposeSlots = await loadBuiltinPlugins(pluginInput.api, pluginInput.runtime)
        },
        async dispose() {
          disposeSlots?.()
        },
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
  }),
)
