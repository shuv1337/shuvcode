import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorOperator } from "../../../supervisor/operator"

export const attach = Runtime.handler(
  Commands.commands.supervisor.commands.attach,
  Effect.fn("cli.supervisor.attach")(function* (input) {
    const target = { home: input.home, homeID: input.homeID, sessionID: input.session, location: input.location }
    if (input.json) {
      const result = yield* Effect.tryPromise(() => SupervisorOperator.resolveAttachment(target))
      process.stdout.write(JSON.stringify(result.attachment) + "\n")
      return
    }
    yield* Effect.tryPromise(() => SupervisorOperator.attach(target))
  }),
)

export const presentation = Runtime.handler(
  Commands.commands.supervisor.commands.presentation,
  Effect.fn("cli.supervisor.presentation")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.presentation({ home: Option.getOrUndefined(input.home) }),
    )
    process.stdout.write(
      input.json
        ? JSON.stringify(result) + "\n"
        : result.entries
            .map((entry) => `${entry.title}  ${entry.state}${entry.label ? `  ${entry.label}` : ""}`)
            .join("\n") + "\n",
    )
  }),
)
