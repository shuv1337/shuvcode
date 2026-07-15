import { EOL } from "os"
import { OpenCode } from "@opencode-ai/client/promise"
import { Service } from "@opencode-ai/client/effect"
import { Effect } from "effect"
import { Pairing } from "@opencode-ai/schema/pairing"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.device.commands.revoke,
  Effect.fn("cli.device.revoke")(function* (input) {
    const endpoint = yield* Service.start(yield* ServiceConfig.options())
    yield* Effect.tryPromise(() =>
      OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }).pairing.device.revoke({
        deviceID: Pairing.DeviceID.make(input.deviceID),
      }),
    )
    process.stdout.write(`Revoked ${input.deviceID}${EOL}`)
  }),
)
