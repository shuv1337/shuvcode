import { EOL } from "node:os"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorAPI } from "../../../supervisor/api"
import { SupervisorProtocol } from "../../../supervisor/protocol"
import { readStdin } from "../../../util/io"

export default Runtime.handler(
  Commands.commands.supervisor.commands.request,
  Effect.fn("cli.supervisor.request")(function* (input) {
    const file = Option.getOrUndefined(input.file)
    if (!file && process.stdin.isTTY)
      return yield* Effect.fail(new Error("Pass --file or pipe a JSON supervisor request into stdin"))
    const text = yield* Effect.tryPromise(() => (file ? Bun.file(file).text() : readStdin()))
    const request = yield* Effect.try(() =>
      Schema.decodeUnknownSync(Schema.fromJsonString(SupervisorProtocol.Request))(text),
    )
    const result = yield* Effect.tryPromise(() =>
      SupervisorAPI.request(
        input.home,
        request.operation,
        request.sessionID ? { sessionID: request.sessionID } : { operator: true },
      ),
    )
    process.stdout.write(JSON.stringify(result) + EOL)
  }),
)
