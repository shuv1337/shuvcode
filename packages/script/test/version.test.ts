import { describe, expect, test } from "bun:test"
import { nextForkVersion, resolveChannel } from "../src/version.js"

describe("resolveChannel", () => {
  test("prefers an explicit channel without reading git", async () => {
    expect(
      await resolveChannel({
        channel: " beta ",
        branch: () => Promise.reject(new Error("branch should not be read")),
      }),
    ).toBe("beta")
  })

  test("uses latest for releases", async () => {
    expect(await resolveChannel({ bump: "patch", branch: async () => "integration-v2" })).toBe("latest")
    expect(await resolveChannel({ version: "2.0.0-20", branch: async () => "integration-v2" })).toBe("latest")
  })

  test("uses the current branch for preview builds", async () => {
    expect(await resolveChannel({ branch: async () => "integration-v2\n" })).toBe("integration-v2")
  })

  test("falls back to local when git has a detached HEAD", async () => {
    expect(await resolveChannel({ branch: async () => "" })).toBe("local")
  })
})

describe("nextForkVersion", () => {
  test("starts the V2 release line at 2.0.0-1", () => {
    expect(nextForkVersion("1.2.27-4")).toBe("2.0.0-1")
  })

  test("increments the fork release counter", () => {
    expect(nextForkVersion("2.0.0-1")).toBe("2.0.0-2")
    expect(nextForkVersion("2.0.0-17")).toBe("2.0.0-18")
  })

  test("starts the counter for an unnumbered 2.0.0 version", () => {
    expect(nextForkVersion("2.0.0")).toBe("2.0.0-1")
  })

  test("rejects an invalid registry version", () => {
    expect(() => nextForkVersion("not-a-version")).toThrow("Invalid release version")
  })
})
