import { validateRoutes } from "@opentunnel/client/effect"
import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import { RemoteTunnel } from "../src/services/remote-tunnel"

const { WEBSOCKET_SUBPROTOCOL } = createRequire(
  createRequire(import.meta.url).resolve("@opentunnel/client/package.json"),
)("@opentunnel/protocol/bridge-protocol") as { WEBSOCKET_SUBPROTOCOL: string }

test("each channel serves remote access on its own valid subdomain of the shared tunnel", () => {
  const channels = ["latest", "dev", "beta", "Preview/Feature_X.1", "a".repeat(80), "trailing-"]
  const routes = channels.map((channel) => RemoteTunnel.route(channel))

  expect(routes.slice(0, 3)).toEqual(["shuvcode", "shuvcode-dev", "shuvcode-beta"])
  expect(new Set(routes).size).toBe(routes.length)
  // The SDK rejects invalid route names, which would keep the service from ever attaching.
  expect(() => validateRoutes(Object.fromEntries(routes.map((name) => [name, "127.0.0.1:4096"])))).not.toThrow()
  // The published client speaks this subprotocol; ShuvTunnel's bridge requires it.
  expect(WEBSOCKET_SUBPROTOCOL).toBe("shuvtunnel")
})
