import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect/service"
import { OpenCode } from "@opencode-ai/client/promise"
import { renderUnicodeCompact } from "uqr"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServiceConfig } from "../../services/service-config"

export default Runtime.handler(
  Commands.commands.pair,
  Effect.fn("cli.pair")(function* () {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const invitation = yield* Effect.tryPromise(() =>
      OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }).pairing.invitation.create(),
    )
    process.stdout.write(
      [
        "",
        `  URLs      ${invitation.urls[0] ?? "(none)"}`,
        ...invitation.urls.slice(1).map((url) => `            ${url}`),
        `  Expires   ${invitation.expiresAt}`,
        "",
        "  Scan to pair",
        "",
        renderUnicodeCompact(JSON.stringify(invitation), { border: 2 })
          .split(EOL)
          .map((line) => "  " + line)
          .join(EOL),
        "",
      ].join(EOL) + EOL,
    )

    const hostname = new URL(endpoint.url).hostname
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return
    process.stderr.write(
      `  The service is bound to loopback. Configure \`shuvcode service set advertised-urls https://host\` when using Tailscale Serve or a reverse proxy.${EOL}${EOL}`,
    )
  }),
)
