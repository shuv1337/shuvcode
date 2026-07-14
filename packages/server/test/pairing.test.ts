import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Layer } from "effect"
import { randomBytes, randomUUID } from "node:crypto"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createRoutes } from "../src/routes"

process.env.OPENCODE_DB = ":memory:"

const password = "admin-secret"
const basic = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
const app = HttpRouter.toWebHandler(
  createRoutes(password, () => ["https://shuvdev.example"]).pipe(Layer.provide(HttpServer.layerServices)),
)

beforeAll(async () => {
  await app.handler(new Request("http://localhost/api/health", { headers: { authorization: basic } }))
})

afterAll(() => app.dispose())

describe("pairing HTTP authorization", () => {
  test("redeems without server credentials but keeps management administrator-only", async () => {
    const invitationResponse = await app.handler(
      new Request("http://localhost/api/pairing/invitation", {
        method: "POST",
        headers: { authorization: basic },
      }),
    )
    expect(invitationResponse.status).toBe(200)
    const invitation = await invitationResponse.json()
    expect(invitation).toMatchObject({ v: 1, kind: "shuvcode.pair", urls: ["https://shuvdev.example"] })

    const credential = `scd_v1_${randomBytes(32).toString("base64url")}`
    const redemptionResponse = await app.handler(
      new Request("http://localhost/api/pairing/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: invitation.token,
          requestID: randomUUID(),
          deviceName: "Test Phone",
          credential,
        }),
      }),
    )
    expect(redemptionResponse.status).toBe(200)

    expect(
      (
        await app.handler(
          new Request("http://localhost/api/server", { headers: { authorization: `Bearer ${credential}` } }),
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await app.handler(
          new Request("http://localhost/api/pairing/invitation", {
            method: "POST",
            headers: { authorization: `Bearer ${credential}` },
          }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.handler(
          new Request("http://localhost/api/debug/location", {
            headers: { authorization: `Bearer ${credential}` },
          }),
        )
      ).status,
    ).toBe(403)
  })

  test("preserves the exact PTY ticket bypass and rejects unrelated unauthenticated routes", async () => {
    const unauthorized = await app.handler(new Request("http://localhost/api/server"))
    expect(await unauthorized.clone().text()).toContain("UnauthorizedError")
    expect(unauthorized.status).toBe(401)
    expect(
      (await app.handler(new Request("http://localhost/api/pairing/device", { headers: { authorization: basic } })))
        .status,
    ).toBe(200)
    expect((await app.handler(new Request("http://localhost/api/pty/pty_missing/connect"))).status).toBe(401)
    expect(
      (await app.handler(new Request("http://localhost/api/pty/pty_missing/connect?ticket=one-time"))).status,
    ).toBe(404)
    expect(
      (
        await app.handler(
          new Request("http://localhost/api/pairing/redeem", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(400)
  })
})
