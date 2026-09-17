import { describe, expect, test } from "bun:test"
import { errorText, humanizePlan, json, jwtPayload, percentUsed, time } from "../src/shared"

describe("errorText", () => {
  test("empty body falls back to the status", () => {
    expect(errorText(500, "   ")).toBe("HTTP 500")
  })

  test("prefers a JSON error.message", () => {
    const body = JSON.stringify({ error: { type: "oauth_scope_insufficient", message: "Missing scope user:profile" } })
    expect(errorText(403, body)).toBe("HTTP 403: Missing scope user:profile")
  })

  test("accepts top-level message and string error", () => {
    expect(errorText(500, JSON.stringify({ message: "boom" }))).toBe("HTTP 500: boom")
    expect(errorText(500, JSON.stringify({ error: "nope" }))).toBe("HTTP 500: nope")
  })

  test("collapses whitespace and truncates non-JSON bodies", () => {
    const body = "<html>\n  <body>\n    " + "x".repeat(300) + "\n  </body>\n</html>"
    const text = errorText(502, body)
    expect(text.startsWith("HTTP 502: <html> <body> xxx")).toBe(true)
    expect(text).not.toContain("\n")
    expect(text.length).toBeLessThanOrEqual("HTTP 502: ".length + 120)
  })
})

describe("json", () => {
  // Bun's `typeof fetch` also declares `preconnect`; the stubs only need the call signature.
  const stub = (fn: (url: URL | RequestInfo, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch
  const respond = (status: number, body = "") => stub(async () => new Response(body, { status }))

  test("maps 401/403 to sign-in and 429 to rate limited", async () => {
    expect(await json("https://x.test", {}, { fetch: respond(401) })).toEqual({ ok: false, error: "Sign in required", status: 401 })
    expect(await json("https://x.test", {}, { fetch: respond(403) })).toEqual({ ok: false, error: "Sign in required", status: 403 })
    expect(await json("https://x.test", {}, { fetch: respond(429) })).toEqual({ ok: false, error: "Rate limited", status: 429 })
  })

  test("other failures use errorText", async () => {
    const result = await json("https://x.test", {}, { fetch: respond(500, JSON.stringify({ error: { message: "down" } })) })
    expect(result).toEqual({ ok: false, error: "HTTP 500: down", status: 500 })
  })

  test("returns parsed body on success and flags invalid JSON", async () => {
    expect(await json("https://x.test", {}, { fetch: respond(200, '{"a":1}') })).toEqual({ ok: true, body: { a: 1 } })
    expect(await json("https://x.test", {}, { fetch: respond(200, "not json") })).toEqual({ ok: false, error: "Invalid JSON response" })
  })

  test("aborts on timeout", async () => {
    const hang = stub(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
        }),
    )
    expect(await json("https://x.test", {}, { fetch: hang, timeoutMs: 5 })).toEqual({ ok: false, error: "Request timed out" })
  })
})

describe("coercion", () => {
  test("percentUsed treats fractional (0,1) as ratio and clamps", () => {
    expect(percentUsed(0.25)).toBe(25)
    expect(percentUsed(1)).toBe(1)
    expect(percentUsed(93)).toBe(93)
    expect(percentUsed(150)).toBe(100)
    expect(percentUsed("0.5")).toBe(50)
    expect(percentUsed("n/a")).toBeUndefined()
  })

  test("time parses ISO, epoch seconds and epoch millis", () => {
    expect(time("2026-09-20T00:00:00Z")).toBe(Date.parse("2026-09-20T00:00:00Z"))
    expect(time(1_790_000_000)).toBe(1_790_000_000_000)
    expect(time(1_790_000_000_000)).toBe(1_790_000_000_000)
    expect(time("1790000000")).toBe(1_790_000_000_000)
    expect(time(0)).toBeUndefined()
    expect(time("")).toBeUndefined()
    expect(time(null)).toBeUndefined()
    expect(time("garbage")).toBeUndefined()
  })

  test("humanizePlan title-cases slugs and keeps Nx multipliers", () => {
    expect(humanizePlan("default_claude_max_20x")).toBe("Default Claude Max 20x")
    expect(humanizePlan("claude-opus-4")).toBe("Claude Opus 4")
  })

  test("jwtPayload decodes base64url payloads and rejects garbage", () => {
    const payload = Buffer.from(JSON.stringify({ tier: 5, email: "a@b.test" })).toString("base64url")
    expect(jwtPayload(`hdr.${payload}.sig`)).toEqual({ tier: 5, email: "a@b.test" })
    expect(jwtPayload("not-a-jwt")).toBeUndefined()
    expect(jwtPayload("a.!!!.c")).toBeUndefined()
  })
})
