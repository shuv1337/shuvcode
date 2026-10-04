import { describe, expect, test } from "bun:test"
import { createFetch } from "./tui-client"

describe("createFetch", () => {
  test("returns 404 for GET / on an ephemeral listener", async () => {
    const calls = createFetch()
    using server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
    const response = await fetch(server.url)
    expect(response.status).toBe(404)
  })

  test("still throws for unexpected API routes", async () => {
    const calls = createFetch()
    await expect(calls.fetch("http://127.0.0.1/api/missing")).rejects.toThrow("unexpected request: /api/missing")
  })

  test("still throws for non-GET requests to /", async () => {
    const calls = createFetch()
    await expect(calls.fetch("http://127.0.0.1/", { method: "POST" })).rejects.toThrow("unexpected request: /")
  })
})
