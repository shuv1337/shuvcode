import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { Capabilities } from "../src/capabilities.js"
import { ClientApi } from "../src/client.js"

describe("mobile capability metadata", () => {
  test("every governed method and path exists in the Protocol API", () => {
    const paths = OpenApi.fromApi(ClientApi).paths
    for (const [method, template] of Capabilities.mobile) {
      const path = template.replace(/:([^/]+)/g, "{$1}")
      expect(paths[path]?.[method.toLowerCase() as keyof (typeof paths)[string]]).toBeDefined()
    }
  })

  test("classification is method-specific and fails closed", () => {
    expect(Capabilities.allowsMobile("GET", "/api/server")).toBe(true)
    expect(Capabilities.allowsMobile("POST", "/api/server")).toBe(false)
    expect(Capabilities.allowsMobile("GET", "/api/debug/location")).toBe(false)
    expect(Capabilities.isPairingRedemption("POST", "/api/pairing/redeem")).toBe(true)
    expect(Capabilities.isPairingRedemption("GET", "/api/pairing/redeem")).toBe(false)
  })
})
