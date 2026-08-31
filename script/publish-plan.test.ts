import { describe, expect, test } from "bun:test"
import { forkRepository, publishPlan } from "./publish-plan"

describe("publish plan", () => {
  test("publishes only Shuvcode CLI distributions for the fork", () => {
    expect(publishPlan(forkRepository)).toEqual({
      packages: ["cli"],
    })
  })

  test("rejects publication from unconfigured repositories", () => {
    expect(() => publishPlan("example/unknown")).toThrow("Publishing is not configured")
    expect(() => publishPlan(undefined)).toThrow("Publishing is not configured")
  })
})
