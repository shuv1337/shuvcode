import { run } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { loadBuiltinPlugins } from "@opencode-ai/tui/builtins"
import { OpenCode } from "@opencode-ai/client/promise"
import type { Service } from "@opencode-ai/client/effect"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { Args } from "@opencode-ai/tui/context/args"

export function runTui(
  transport: Service.Transport,
  args: Args,
  discover?: () => Promise<Service.Transport>,
  reload?: () => Promise<void>,
) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  let disposeSlots: (() => void) | undefined
  return Effect.gen(function* () {
    const runFork = Effect.runForkWith(yield* Effect.context())
    const options = { baseUrl: transport.url, headers: transport.headers }
    const api = OpenCode.make(options)
    const directory = yield* Effect.tryPromise(() => api.file.list({ location: { directory: process.cwd() } })).pipe(
      Effect.map((response) => response.location.directory),
      Effect.catch(() =>
        Effect.tryPromise(() => api.location.get()).pipe(Effect.map((response) => response.directory)),
      ),
    )
    return yield* run({
      client: createOpencodeClient({ ...options, directory }),
      api,
      link: linkCredentials(transport),
      discover: discover
        ? async () => {
            const next = await discover()
            return {
              client: createOpencodeClient({ baseUrl: next.url, headers: next.headers, directory }),
              api: OpenCode.make({ baseUrl: next.url, headers: next.headers }),
            }
          }
        : undefined,
      reload,
      args,
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
        async start(input) {
          disposeSlots = await loadBuiltinPlugins(input.api, input.runtime)
        },
        async dispose() {
          disposeSlots?.()
        },
      },
    })
  }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

function linkCredentials(transport: Service.Transport) {
  const authorization = new Headers(transport.headers).get("authorization")
  if (!authorization?.startsWith("Basic ")) return { username: "opencode", password: "" }
  const value = atob(authorization.slice("Basic ".length))
  const separator = value.indexOf(":")
  if (separator === -1) return { username: "opencode", password: "" }
  return { username: value.slice(0, separator), password: value.slice(separator + 1) }
}
