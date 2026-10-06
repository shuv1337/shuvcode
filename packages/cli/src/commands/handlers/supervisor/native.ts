import { Effect, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerProcess } from "../../../server-process"
import { SupervisorManaged } from "../../../supervisor/managed"

export default Runtime.handler(
  Commands.commands.supervisor.commands.native,
  Effect.fn("cli.supervisor.native")(function* (input) {
    yield* Effect.tryPromise(async () => SupervisorManaged.awaitLaunch())
    const recoveryReady = Effect.callback<string, Error>((resume) => {
      let input = ""
      const ready = (data: Buffer) => {
        input += data.toString("utf8")
        if (input.length > 1024 * 1024) return resume(Effect.fail(new Error("Supervisor recovery input is too large")))
        const end = input.indexOf("\n")
        if (end !== -1) resume(Effect.succeed(input.slice(0, end)))
      }
      const closed = () => resume(Effect.interrupt)
      process.stdin.on("data", ready)
      process.stdin.once("end", closed)
      return Effect.sync(() => {
        process.stdin.off("data", ready)
        process.stdin.off("end", closed)
      })
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Session.ID)))), Effect.orDie)
    return yield* ServerProcess.run({ mode: "stdio", hostname: "127.0.0.1", port: input.port, recoveryReady })
  }),
)
