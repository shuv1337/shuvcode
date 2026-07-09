import { Effect, Option } from "effect"
import path from "node:path"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Server } from "../../services/server"

export default Runtime.handler(Commands.commands.mini, (input) =>
  Effect.gen(function* () {
    const { runMini, validateMiniTerminal } = yield* Effect.promise(() => import("../../mini"))
    yield* Effect.promise(async () => validateMiniTerminal())
    const project = Option.getOrUndefined(input.project)
    const serverURL = Option.getOrUndefined(input.server)
    const server = yield* Server.resolve({ server: serverURL, standalone: input.standalone })
    yield* Effect.promise(() =>
      runMini({
        server,
        directory:
          project === undefined ? process.cwd() : path.resolve(process.env.PWD ?? process.cwd(), project),
        continue: input.continue,
        session: Option.getOrUndefined(input.session),
        fork: input.fork,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        prompt: Option.getOrUndefined(input.prompt),
        replay: input.replay,
        replayLimit: Option.getOrUndefined(input.replayLimit),
        demo: input.demo,
      }),
    )
  }),
)
