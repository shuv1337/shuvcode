import { Effect, Option } from "effect"
import { Flag, GlobalFlag } from "effect/unstable/cli"

export const StandaloneSetting = GlobalFlag.setting("standalone")({
  flag: Flag.boolean("standalone").pipe(
    Flag.withDescription("Run client commands with a private server; unsupported by service, pair, acp, and serve"),
    Flag.optional,
  ),
})

export const ServerSetting = GlobalFlag.setting("server")({
  flag: Flag.string("server").pipe(
    Flag.withDescription("Connect client commands to a server URL; unsupported by service, pair, acp, and serve"),
    Flag.optional,
  ),
})

export const read = Effect.fn("cli.server-flags.read")(function* () {
  const standaloneSetting = yield* Effect.serviceOption(StandaloneSetting)
  const serverSetting = yield* Effect.serviceOption(ServerSetting)
  return {
    standalone: Option.getOrElse(Option.flatten(standaloneSetting), () => false),
    server: Option.getOrUndefined(Option.flatMap(serverSetting, (value) => value)),
  }
})

export const reject = Effect.fn("cli.server-flags.reject")(function* (command: string) {
  const standalone = yield* Effect.serviceOption(StandaloneSetting)
  const server = yield* Effect.serviceOption(ServerSetting)
  if (Option.isNone(Option.flatten(standalone)) && Option.isNone(Option.flatten(server))) return
  return yield* Effect.fail(
    new Error(`${command} does not support --server or --standalone; use a client command instead`),
  )
})

export * as ServerFlags from "./server-flags"
