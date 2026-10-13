import { expect, test } from "bun:test"
import worker from "../src/index"

test("returns a retryable 503 when D1 rejects a lookup", async () => {
  const overloaded = new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long.")
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: () => Promise.reject(overloaded) }) }) },
    EVENTS: { send: () => Promise.resolve() },
  } as unknown as Parameters<typeof worker.fetch>[1]
  const response = await worker.fetch(
    new Request("https://opencode.ai/update/api/latest/desktop/opencode/opencode-desktop-win-x64.exe"),
    env,
    { waitUntil: () => {} },
  )
  expect(response.status).toBe(503)
  expect(response.headers.get("Retry-After")).toBe("60")
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(await response.json()).toEqual({ error: "Update service temporarily unavailable" })
})
