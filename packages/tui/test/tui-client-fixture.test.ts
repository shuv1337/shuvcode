import { expect, test } from "bun:test"
import { createFetch } from "./fixture/tui-client"

test("the TUI fixture rejects root discovery probes without failing the active test", async () => {
  const client = createFetch()
  expect((await client.fetch("http://localhost/")).status).toBe(404)
  expect((await client.fetch("http://localhost/?probe=1")).status).toBe(404)
})

test("the TUI fixture still rejects unexpected API routes and root writes", async () => {
  const client = createFetch()
  await expect(client.fetch("http://localhost/api/unexpected")).rejects.toThrow("unexpected request: /api/unexpected")
  await expect(client.fetch("http://localhost/", { method: "POST" })).rejects.toThrow("unexpected request: /")
})
