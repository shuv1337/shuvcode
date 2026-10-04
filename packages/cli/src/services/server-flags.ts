import { Effect, Option } from "effect"
import { Flag, GlobalFlag } from "effect/unstable/cli"

export const StandaloneSetting = GlobalFlag.setting("standalone")({
  flag: Flag.boolean("standalone").pipe(
    Flag.withDescription("Run with a private server instead of the background service"),
    Flag.withDefault(false),
  ),
})

export const ServerSetting = GlobalFlag.setting("server")({
  flag: Flag.string("server").pipe(
    Flag.withDescription("Connect to a server URL instead of the background service"),
    Flag.optional,
  ),
})

export const read = Effect.fn("cli.server-flags.read")(function* () {
  const standaloneSetting = yield* Effect.serviceOption(StandaloneSetting)
  const serverSetting = yield* Effect.serviceOption(ServerSetting)
  return {
    standalone: Option.getOrElse(standaloneSetting, () => false),
    server: Option.getOrUndefined(Option.flatMap(serverSetting, (value) => value)),
  }
})

export * as ServerFlags from "./server-flags"
