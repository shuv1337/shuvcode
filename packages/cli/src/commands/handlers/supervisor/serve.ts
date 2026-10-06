import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorAPI } from "../../../supervisor/api"

export default Runtime.handler(
  Commands.commands.supervisor.commands.serve,
  Effect.fn("cli.supervisor.serve")(function* (input) {
    const server = yield* Effect.tryPromise(() =>
      SupervisorAPI.serve({
        home: input.home,
        endpoint: input.endpoint,
        port: input.port,
        password: process.env.SHUVCODE_SUPERVISOR_SERVER_PASSWORD,
      }),
    )
    yield* Effect.addFinalizer(() => Effect.promise(() => server.close()))
    process.stdout.write(server.url + EOL)
    return yield* Effect.never
  }),
)
