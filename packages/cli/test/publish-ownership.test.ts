import { describe, expect, test } from "bun:test"
import { forkRepository } from "../../../script/publish-plan"
import {
  expectedNpmMaintainer,
  forkNpmPackages,
  parseNpmMaintainers,
  planForkNpmPublish,
  planPlatformPackages,
  preflightForkNpmOwnership,
  validateForkNpmOwnership,
} from "../script/publish-ownership"

const owned = () =>
  forkNpmPackages.map((name) => ({
    name,
    exitCode: 0,
    stdout: JSON.stringify([`${expectedNpmMaintainer} <release@example.com>`]),
  }))

describe("fork npm publish ownership", () => {
  test("defines the complete 19-package publication", () => {
    expect(forkNpmPackages).toHaveLength(19)
    expect(new Set(forkNpmPackages).size).toBe(19)
    expect(forkNpmPackages.filter((name) => name.startsWith("shuvcode-node"))).toEqual([
      "shuvcode-node",
      "shuvcode-node-linux-arm64",
      "shuvcode-node-linux-x64",
      "shuvcode-node-darwin-arm64",
      "shuvcode-node-windows-arm64",
      "shuvcode-node-windows-x64",
    ])
  })

  test("parses npm string and object maintainer responses", () => {
    expect(parseNpmMaintainers(JSON.stringify(["kcrommett <release@example.com>", { name: "other" }]))).toEqual([
      "kcrommett",
      "other",
    ])
    expect(parseNpmMaintainers(JSON.stringify({ name: "kcrommett", email: "release@example.com" }))).toEqual([
      "kcrommett",
    ])
    expect(() => parseNpmMaintainers("not json")).toThrow()
    expect(() => parseNpmMaintainers(JSON.stringify([{ email: "release@example.com" }]))).toThrow(
      "npm returned an invalid maintainer entry",
    )
  })

  test("accepts only a complete owned package set", () => {
    expect(validateForkNpmOwnership(owned())).toEqual(forkNpmPackages)
    expect(() => validateForkNpmOwnership(owned().slice(1))).toThrow("Missing npm ownership responses")

    const unavailable = owned()
    unavailable[0] = { ...unavailable[0], exitCode: 1, stdout: "" }
    expect(() => validateForkNpmOwnership(unavailable)).toThrow("npm package is missing or unavailable: shuvcode")

    const hijacked = owned()
    hijacked[0] = { ...hijacked[0], stdout: JSON.stringify(["other <other@example.com>"]) }
    expect(() => validateForkNpmOwnership(hijacked)).toThrow("npm package is not maintained by kcrommett: shuvcode")
  })

  test("plans a complete coherent artifact set before publication", () => {
    expect(planPlatformPackages(["a", "b"], { a: "1.0.0", b: "1.0.0" }, "1.0.0")).toEqual({
      binaries: { a: "1.0.0", b: "1.0.0" },
      version: "1.0.0",
    })
    expect(() => planPlatformPackages(["a", "b"], { a: "1.0.0" }, "1.0.0")).toThrow("Missing platform packages: b")
    expect(() => planPlatformPackages(["a"], { a: "1.0.0", b: "1.0.0" }, "1.0.0")).toThrow(
      "Unexpected platform packages: b",
    )
    expect(() => planPlatformPackages(["a", "b"], { a: "1.0.0", b: "2.0.0" }, "1.0.0")).toThrow(
      "Platform package versions do not match release 1.0.0: b",
    )
    expect(() => planPlatformPackages(["a", "b"], { a: "2.0.0", b: "2.0.0" }, "1.0.0")).toThrow(
      "Platform package versions do not match release 1.0.0: a, b",
    )
  })

  test("fails repository planning before ownership parsing", () => {
    const invalid = [{ name: "shuvcode", exitCode: 0, stdout: "not json" }]
    expect(() => planForkNpmPublish(undefined, invalid)).toThrow("Publishing is not configured for repository: unknown")
    expect(planForkNpmPublish(forkRepository, owned()).packages).toEqual(forkNpmPackages)
  })

  test("fails a missing repository before querying npm", async () => {
    const queried: string[] = []
    await expect(
      preflightForkNpmOwnership(undefined, async (name) => {
        queried.push(name)
        throw new Error("must not query")
      }),
    ).rejects.toThrow("Publishing is not configured for repository: unknown")
    expect(queried).toEqual([])
  })
})
