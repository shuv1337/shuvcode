import { EOL } from "os"
import { Effect } from "effect"
import { ServiceLifecycle } from "../../../services/service-lifecycle"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.service.commands.status,
  Effect.fn("cli.service.status")(function* () {
    const found = yield* ServiceLifecycle.status()
    process.stdout.write((found?.url ?? "stopped") + EOL)
  }),
)
