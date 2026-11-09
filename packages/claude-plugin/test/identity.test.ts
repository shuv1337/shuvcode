import { expect, test } from "bun:test"
import { createUserAgent, fallbackVersion } from "../src/identity.js"

const fallback = `claude-cli/${fallbackVersion} (external, cli)`

test.each(["2.1.319", "2.1.400", "2.2.0", "3.0.0"])("uses installed Claude Code %s", async (version) => {
  const identity = createUserAgent(async () => `${version} (Claude Code)\n`)
  expect(await identity()).toBe(`claude-cli/${version} (external, cli)`)
})

test.each(["2.1.280", "2.1.290", "2.0.999", "1.99.999"])("does not regress for older CLI %s", async (version) => {
  expect(await createUserAgent(async () => `${version} (Claude Code)`)()).toBe(fallback)
})

test.each(["", "garbage", "2.1.400", "2.1.400 (unrelated CLI)", "2.1.400-beta (Claude Code)"])(
  "falls back for malformed output %j",
  async (output) => {
    expect(await createUserAgent(async () => output)()).toBe(fallback)
  },
)

test.each(["ENOENT", "EACCES", "nonzero exit", "timeout", "maxBuffer exceeded"])(
  "caches subprocess failure: %s",
  async (reason) => {
    let calls = 0
    const identity = createUserAgent(async () => {
      calls++
      throw new Error(reason)
    })
    expect(await identity()).toBe(fallback)
    expect(await identity()).toBe(fallback)
    expect(calls).toBe(1)
  },
)

test("lazy resolution is shared by concurrent callers and cached afterwards", async () => {
  let calls = 0
  const pending = Promise.withResolvers<string>()
  const identity = createUserAgent(() => {
    calls++
    return pending.promise
  })
  expect(calls).toBe(0)
  const first = identity()
  const second = identity()
  expect(second).toBe(first)
  pending.resolve("2.1.400 (Claude Code)")
  expect(await first).toBe("claude-cli/2.1.400 (external, cli)")
  expect(await identity()).toBe(await first)
  expect(calls).toBe(1)
})

test("fallback meets Fable 5.2's documented minimum (2.1.290)", () => {
  expect(Bun.semver.satisfies(fallbackVersion, ">=2.1.290")).toBe(true)
})
