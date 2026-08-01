import { EOL } from "os"
import { Effect } from "effect"
import { ServiceLifecycle } from "../../../services/service-lifecycle"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.service.commands.restart,
  Effect.fn("cli.service.restart")(function* () {
    const transport = yield* ServiceLifecycle.restart()
    process.stdout.write(transport.url + EOL)
  }),
)
