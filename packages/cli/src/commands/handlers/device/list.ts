import { EOL } from "os"
import { OpenCode } from "@opencode-ai/client/promise"
import { Service } from "@opencode-ai/client/effect"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.device.commands.list,
  Effect.fn("cli.device.list")(function* () {
    const endpoint = yield* Service.start(yield* ServiceConfig.options())
    const devices = yield* Effect.tryPromise(() =>
      OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }).pairing.device.list(),
    )
    if (devices.length === 0) {
      process.stdout.write("No paired devices" + EOL)
      return
    }
    const width = Math.max(...devices.map((device) => device.deviceID.length))
    process.stdout.write(
      devices
        .map(
          (device) =>
            `${device.deviceID.padEnd(width)}  ${device.name}  ${device.revokedAt ? `revoked ${device.revokedAt}` : "active"}`,
        )
        .join(EOL) + EOL,
    )
  }),
)
