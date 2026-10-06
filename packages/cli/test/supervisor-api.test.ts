import { expect, test } from "bun:test"
import { SupervisorAPI } from "../src/supervisor/api"
import { createSupervisorFixture } from "./fixtures/supervisor"

test("authenticated status survives a native response beyond the former 10-second idle timeout", async () => {
  await using fixture = await createSupervisorFixture()
  const native = await fixture.startServer()
  let delayed = 0
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const source = new URL(request.url)
      if (source.pathname === "/api/session/active") {
        delayed++
        await Bun.sleep(11_000)
      }
      return fetch(new Request(new URL(source.pathname + source.search, native.url), request))
    },
  })
  let api: Awaited<ReturnType<typeof SupervisorAPI.serve>> | undefined
  try {
    api = await SupervisorAPI.serve({
      home: fixture.home,
      endpoint: proxy.url.toString(),
      password: native.password,
      intervalMs: 60_000,
    })
    const started = performance.now()
    const result = await SupervisorAPI.request(fixture.home, { type: "status" })
    expect(result).toMatchObject({ tasks: [] })
    expect(delayed).toBe(1)
    expect(performance.now() - started).toBeGreaterThanOrEqual(10_500)
  } finally {
    await api?.close()
    await proxy.stop(true)
  }
}, 30_000)
