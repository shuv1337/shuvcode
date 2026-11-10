import type { OpenCodeClient } from "@opencode/client"
import { Effect, Schedule } from "effect"
import { requireConfig } from "./config-diagnostics"

// A cold Location answers reads before its config MCP plugin has registered the servers.
// Wait on the client, not in the server handler, and never call an unfinished catalog "unconfigured".
export const waitForMcp = (client: OpenCodeClient, directory: string, fail: "never" | "any" = "never") =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: (signal) => requireConfig(client, directory, signal, fail),
      catch: (cause) => cause,
    })
    const plugins = yield* Effect.tryPromise((signal) =>
      client.plugin.list({ location: { directory } }, { signal }),
    ).pipe(
      Effect.repeat({
        until: (plugins) => plugins.data.some((plugin) => plugin.id === "opencode.config.mcp"),
        schedule: Schedule.spaced("25 millis").pipe(Schedule.upTo({ duration: "5 seconds" })),
      }),
    )
    const plugin = plugins.data.find((plugin) => plugin.id === "opencode.config.mcp")
    if (!plugin) return yield* Effect.fail(new Error("MCP configuration is still loading; try again shortly."))
    if (plugin.state.status === "failed")
      return yield* Effect.fail(new Error(`Failed to load MCP configuration: ${plugin.state.error}`))
  })
