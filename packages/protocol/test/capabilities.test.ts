import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { Capabilities } from "../src/capabilities.js"
import { ClientApi } from "../src/client.js"

describe("mobile capability metadata", () => {
  test("classifies every Protocol operation and derives every mobile route from the contract", () => {
    const paths = OpenApi.fromApi(ClientApi).paths
    const contract = Object.entries(paths).flatMap(([path, operations]) =>
      Object.entries(operations).flatMap(([method, operation]) =>
        method === "parameters" || !operation || !("operationId" in operation) || !operation.operationId
          ? []
          : [{ method: method.toUpperCase(), path, operationID: operation.operationId }],
      ),
    )
    expect(Capabilities.routes).toHaveLength(contract.length)
    expect(
      Capabilities.routes.map((entry) => ({
        method: entry.method,
        path: entry.path.replace(/:([^/]+)/g, "{$1}"),
        operationID: entry.operationID,
      })),
    ).toEqual(contract)
    expect(Capabilities.routes.every((entry) => entry.capability !== undefined)).toBe(true)
    expect(
      new Set(Capabilities.routes.filter((entry) => entry.capability === "mobile").map((entry) => entry.operationID)),
    ).toEqual(Capabilities.mobileOperationIDs)
  })

  test("classification is method-specific and fails closed", () => {
    expect(Capabilities.allowsMobile("GET", "/api/server")).toBe(true)
    expect(Capabilities.allowsMobile("POST", "/api/server")).toBe(false)
    expect(Capabilities.allowsMobile("GET", "/api/debug/location")).toBe(false)
    expect(Capabilities.isPairingRedemption("POST", "/api/pairing/redeem")).toBe(true)
    expect(Capabilities.isPairingRedemption("GET", "/api/pairing/redeem")).toBe(false)
  })

  test("publishes the device name scalar bounds in the redemption contract", () => {
    const request = JSON.stringify(OpenApi.fromApi(ClientApi).components.schemas?.["Pairing.RedeemRequest"])
    expect(request).toContain('"minLength":1')
    expect(request).toContain('"maxLength":80')
  })
})
