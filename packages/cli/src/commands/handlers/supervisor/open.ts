import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorOperator } from "../../../supervisor/operator"

export default Runtime.handler(
  Commands.commands.supervisor,
  Effect.fn("cli.supervisor.open")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.open({
        home: Option.getOrUndefined(input.home),
        project: Option.getOrUndefined(input.project),
        model: Option.getOrUndefined(input.model),
        auto: input.auto,
        endpoint: Option.getOrUndefined(input.endpoint),
        providerURL: Option.getOrUndefined(input.providerURL),
        profile: Option.getOrUndefined(input.profile),
        noOpen: input.noOpen,
      }),
    )
  }),
)
