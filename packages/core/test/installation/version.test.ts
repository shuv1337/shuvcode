import { describe, expect, test } from "bun:test"
import { isVersionGreater, parseForkVersion } from "../../src/installation/version"

describe("parseForkVersion", () => {
  test("parses fork builds with optional v prefix", () => {
    expect(parseForkVersion("1.17.13-1")).toEqual({ base: "1.17.13", iteration: 1 })
    expect(parseForkVersion("v1.17.13-2")).toEqual({ base: "1.17.13", iteration: 2 })
    expect(parseForkVersion("1.17.13")).toBeUndefined()
    expect(parseForkVersion("1.17.13-rc1")).toBeUndefined()
  })
})

describe("isVersionGreater", () => {
  test("compares plain semver versions", () => {
    expect(isVersionGreater("1.2.4", "1.2.3")).toBe(true)
    expect(isVersionGreater("1.2.3", "1.2.4")).toBe(false)
    expect(isVersionGreater("1.2.3", "1.2.3")).toBe(false)
  })

  test("treats bare upstream as not newer than fork builds on the same base", () => {
    expect(isVersionGreater("1.17.13", "1.17.13-1")).toBe(false)
    expect(isVersionGreater("1.17.13-1", "1.17.13")).toBe(false)
  })

  test("compares fork iterations on the same base", () => {
    expect(isVersionGreater("1.17.13-2", "1.17.13-1")).toBe(true)
    expect(isVersionGreater("1.17.13-1", "1.17.13-2")).toBe(false)
  })

  test("compares fork bases before iterations", () => {
    expect(isVersionGreater("1.17.14-1", "1.17.13-2")).toBe(true)
    expect(isVersionGreater("1.17.13-9", "1.17.14-1")).toBe(false)
  })
})