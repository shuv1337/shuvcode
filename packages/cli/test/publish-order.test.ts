import { expect, test } from "bun:test"
import { publishDistributions } from "../script/publish-order"
import type { ForkDistribution } from "../script/publish-ownership"

test("prepares every wrapper, then publishes all platforms before either umbrella", async () => {
  const events: string[] = []
  const distributions: ForkDistribution[] = [
    {
      root: "/bun",
      name: "shuvcode",
      binary: "shuvcode",
      packagePrefix: "shuvcode-",
      packages: ["shuvcode-a", "shuvcode-b"],
      binaries: { "shuvcode-a": "1.2.3", "shuvcode-b": "1.2.3" },
      version: "1.2.3",
    },
    {
      root: "/node",
      name: "shuvcode-node",
      binary: "shuvcode-node",
      packagePrefix: "shuvcode-node-",
      packages: ["shuvcode-node-a"],
      binaries: { "shuvcode-node-a": "1.2.3" },
      version: "1.2.3",
    },
  ]
  await publishDistributions(distributions, {
    prepare: async (distribution) => {
      events.push(`prepare:${distribution.name}`)
    },
    verify: async (distribution) => {
      events.push(`verify:${distribution.name}`)
    },
    publish: async (_root, name) => {
      events.push(`publish:${name}`)
    },
  })
  expect(events).toEqual([
    "prepare:shuvcode",
    "prepare:shuvcode-node",
    "verify:shuvcode",
    "verify:shuvcode-node",
    "publish:shuvcode-a",
    "publish:shuvcode-b",
    "publish:shuvcode-node-a",
    "publish:shuvcode",
    "publish:shuvcode-node",
  ])
})
