import { describe, expect, test } from "bun:test"
import { bumpVersion } from "../src/version.js"

describe("bumpVersion", () => {
  test("bumps a stable patch version", () => {
    expect(bumpVersion("1.2.27", "patch")).toBe("1.2.28")
  })

  test("bumps past a fork release suffix", () => {
    expect(bumpVersion("1.2.27-4", "patch")).toBe("1.2.28")
  })

  test("bumps major and minor versions", () => {
    expect(bumpVersion("1.2.27-4", "major")).toBe("2.0.0")
    expect(bumpVersion("1.2.27-4", "minor")).toBe("1.3.0")
  })

  test("rejects an invalid registry version", () => {
    expect(() => bumpVersion("not-a-version", "patch")).toThrow("Invalid release version")
  })
})
