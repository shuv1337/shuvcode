import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect"
import { OpenCode } from "@opencode-ai/client/promise"
import { renderUnicodeCompact } from "uqr"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServiceConfig } from "../../services/service-config"

export default Runtime.handler(
  Commands.commands.link,
  Effect.fn("cli.link")(function* () {
    const transport = yield* Service.start(yield* ServiceConfig.options())
    const password = yield* ServiceConfig.password()
    const server = yield* Effect.tryPromise(() =>
      OpenCode.make({ baseUrl: transport.url, headers: transport.headers }).server.get(),
    )
    const info = { urls: server.urls, username: "opencode", password }
    process.stdout.write(
      [
        "",
        `  URLs      ${info.urls[0] ?? "(none)"}`,
        ...info.urls.slice(1).map((url) => `            ${url}`),
        `  Username  ${info.username}`,
        `  Password  ${info.password}`,
        "",
        "  Scan to connect",
        "",
        renderUnicodeCompact(JSON.stringify(info), { border: 2 })
          .split(EOL)
          .map((line) => "  " + line)
          .join(EOL),
        "",
      ].join(EOL) + EOL,
    )

    const hostname = new URL(transport.url).hostname
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return
    process.stderr.write(
      `  Run \`opencode service set hostname 0.0.0.0\` to access the service remotely.${EOL}${EOL}`,
    )
  }),
)
