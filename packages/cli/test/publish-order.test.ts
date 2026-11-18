import { expect, test } from "bun:test"
import { publishDistributions, type PublishPhase } from "../script/publish-order"
import type { ForkDistribution } from "../script/publish-ownership"

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

function recorder(options: { failPlatformWait?: boolean } = {}) {
  const events: string[] = []
  return {
    events,
    operation: {
      prepare: async (distribution: ForkDistribution) => {
        events.push(`prepare:${distribution.name}`)
      },
      verify: async (distribution: ForkDistribution) => {
        events.push(`verify:${distribution.name}`)
      },
      packWrappers: async (items: readonly ForkDistribution[]) => {
        events.push(`pack:${items.map((item) => item.name).join(",")}`)
      },
      publish: async (_root: string, name: string) => {
        events.push(`publish:${name}`)
      },
      waitForPlatforms: async (names: readonly string[], version: string) => {
        events.push(`waitForPlatforms:${names.join(",")}@${version}`)
        if (options.failPlatformWait) throw new Error("platforms never became available")
      },
      waitForWrappers: async (names: readonly string[], version: string) => {
        events.push(`waitForWrappers:${names.join(",")}@${version}`)
      },
    },
  }
}

const platformPublishes = ["publish:shuvcode-a", "publish:shuvcode-b", "publish:shuvcode-node-a"]
const staging = [
  "prepare:shuvcode",
  "prepare:shuvcode-node",
  "verify:shuvcode",
  "verify:shuvcode-node",
  "pack:shuvcode,shuvcode-node",
  ...platformPublishes,
  "waitForPlatforms:shuvcode-a,shuvcode-b,shuvcode-node-a@1.2.3",
]
const wrapperPublishes = ["publish:shuvcode", "publish:shuvcode-node", "waitForWrappers:shuvcode,shuvcode-node@1.2.3"]

test("prepares every wrapper, then publishes all platforms before either umbrella", async () => {
  const events: string[] = []
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

test.each([
  { phase: "all", expected: [...staging, ...wrapperPublishes] },
  { phase: "platforms", expected: staging },
  {
    phase: "wrappers",
    expected: ["waitForPlatforms:shuvcode-a,shuvcode-b,shuvcode-node-a@1.2.3", ...wrapperPublishes],
  },
] satisfies Array<{ phase: PublishPhase; expected: string[] }>)(
  "the $phase phase waits for npm between platforms and wrappers",
  async ({ phase, expected }) => {
    const run = recorder()
    await publishDistributions(distributions, run.operation, phase)
    expect(run.events).toEqual(expected)
  },
)

test.each(["all", "wrappers"] satisfies PublishPhase[])(
  "the %s phase never publishes a wrapper when the platforms do not become available",
  async (phase) => {
    const run = recorder({ failPlatformWait: true })
    const error = await publishDistributions(distributions, run.operation, phase).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect(run.events).not.toContain("publish:shuvcode")
    expect(run.events).not.toContain("publish:shuvcode-node")
    expect(run.events.at(-1)).toBe("waitForPlatforms:shuvcode-a,shuvcode-b,shuvcode-node-a@1.2.3")
  },
)

test("rejects distributions that disagree on the release version before any work", async () => {
  const run = recorder()
  const error = await publishDistributions(
    [distributions[0], { ...distributions[1], version: "1.2.4" }],
    run.operation,
  ).catch((cause: unknown) => cause)
  expect(error instanceof Error && error.message).toBe("Distributions disagree on the release version: 1.2.3, 1.2.4")
  expect(run.events).toEqual([])
})
