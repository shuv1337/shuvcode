import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorManaged } from "../../../supervisor/managed"

export default Runtime.handler(
  Commands.commands.supervisor.commands.daemon,
  Effect.fn("cli.supervisor.daemon")(function* (input) {
    yield* Effect.tryPromise(() => SupervisorManaged.run(input.home))
  }),
)
