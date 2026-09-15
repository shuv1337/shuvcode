import { describe, expect, test } from "bun:test"
import { nextForkVersion, parseForkVersion, resolveChannel } from "../src/version.js"

describe("resolveChannel", () => {
  test("prefers an explicit channel without reading git", async () => {
    expect(
      await resolveChannel({ channel: " beta ", branch: () => Promise.reject(new Error("branch should not be read")) }),
    ).toBe("beta")
  })

  test("uses latest for releases", async () => {
    expect(await resolveChannel({ bump: "patch", branch: async () => "v2-rewrite" })).toBe("latest")
    expect(await resolveChannel({ version: "2.0.3-shuv.1", branch: async () => "v2-rewrite" })).toBe("latest")
  })

  test("uses the current branch for preview builds", async () => {
    expect(await resolveChannel({ branch: async () => "v2-rewrite\n" })).toBe("v2-rewrite")
  })

  test("falls back to local without a git branch", async () => {
    expect(await resolveChannel({ branch: async () => "" })).toBe("local")
    expect(await resolveChannel({ branch: () => Promise.reject(new Error("not a git repository")) })).toBe("local")
  })
})

describe("parseForkVersion", () => {
  test("accepts only <upstream>-shuv.<n>", () => {
    expect(parseForkVersion("2.0.3-shuv.1")).toEqual({ base: "2.0.3", iteration: 1 })
    expect(parseForkVersion("2.0.3")).toBeUndefined()
    expect(parseForkVersion("2.0.3-shuv")).toBeUndefined()
    expect(parseForkVersion("2.0.3-shuv.1.2")).toBeUndefined()
    expect(parseForkVersion("2.0.0-alpha-20")).toBeUndefined()
    expect(parseForkVersion("nope")).toBeUndefined()
  })
})

describe("nextForkVersion", () => {
  test("starts at shuv.1 when nothing is published or the base moved", () => {
    expect(nextForkVersion({ base: "2.0.3" })).toBe("2.0.3-shuv.1")
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.0-alpha-20" })).toBe("2.0.3-shuv.1")
    expect(nextForkVersion({ base: "2.0.4", published: "2.0.3-shuv.7" })).toBe("2.0.4-shuv.1")
  })

  test("increments the counter on the same base", () => {
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.3-shuv.1" })).toBe("2.0.3-shuv.2")
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.3-shuv.17" })).toBe("2.0.3-shuv.18")
  })

  test("never produces a bare upstream version", () => {
    expect(nextForkVersion({ base: "2.0.3", published: "2.0.3" })).toBe("2.0.3-shuv.1")
  })

  test("rejects invalid input", () => {
    expect(() => nextForkVersion({ base: "2.0.3-rc.1" })).toThrow("Invalid upstream base version")
    expect(() => nextForkVersion({ base: "2.0.3", published: "not-a-version" })).toThrow("Invalid published version")
  })
})
