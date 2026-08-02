import { Effect } from "effect"
import { ServiceLifecycle } from "../../../services/service-lifecycle"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.service.commands.stop,
  Effect.fn("cli.service.stop")(function* () {
    yield* ServiceLifecycle.stop()
  }),
)
