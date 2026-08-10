import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { OPENCODE_VERSION } from "./version"

export function run() {
  Runtime.run(Commands, [], { version: OPENCODE_VERSION }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.scoped,
    Effect.tap(() => Effect.sync(() => process.exit(process.exitCode ?? 0))),
    NodeRuntime.runMain,
  )
}
