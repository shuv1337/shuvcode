import { describe, expect, test } from "bun:test"
import { forkRepository, publishPlan, upstreamRepository } from "./publish-plan"

describe("publish plan", () => {
  test("publishes only Shuvcode CLI distributions for the fork", () => {
    expect(publishPlan(forkRepository)).toEqual({
      packages: ["cli"],
      desktop: false,
      updateArtifacts: false,
    })
  })

  test("keeps upstream package and finalizer behavior explicit", () => {
    expect(publishPlan(upstreamRepository)).toEqual({
      packages: ["schema", "ai", "util", "protocol", "client", "cli", "plugin", "ui"],
      desktop: true,
      updateArtifacts: true,
    })
  })

  test("rejects publication from unconfigured repositories", () => {
    expect(() => publishPlan("example/unknown")).toThrow("Publishing is not configured")
    expect(() => publishPlan(undefined)).toThrow("Publishing is not configured")
  })
})
