import { EOL } from "os"
import { Effect } from "effect"
import { ServiceLifecycle } from "../../../services/service-lifecycle"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.service.commands.start,
  Effect.fn("cli.service.start")(function* () {
    const transport = yield* ServiceLifecycle.ensure()
    process.stdout.write(transport.url + EOL)
  }),
)
