import { describe, expect, test } from "bun:test"
import { nextForkVersion } from "../src/version.js"

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
