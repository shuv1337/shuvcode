import { describe, expect, test } from "bun:test"
import {
  DEFAULT_NOUS_PORTAL_URL,
  readBoundedText,
  resolvePortalBaseURL,
  retryAfterMs,
  sanitizeErrorCode,
  timingSafeEqualString,
  validateAuthorizeURL,
  validateHttpsOrLoopback,
} from "../src/url"

describe("URL validation & security helpers", () => {
  test("validateHttpsOrLoopback accepts https and literal loopback IPs, stripping trailing slashes", () => {
    expect(validateHttpsOrLoopback("https://portal.nousresearch.com/", "portal")).toBe(
      "https://portal.nousresearch.com",
    )
    expect(validateHttpsOrLoopback("https://portal.nousresearch.com/sub///", "portal")).toBe(
      "https://portal.nousresearch.com/sub",
    )
    expect(validateHttpsOrLoopback("http://127.0.0.1:8787/", "portal")).toBe("http://127.0.0.1:8787")
    expect(validateHttpsOrLoopback("http://[::1]:8787/", "portal")).toBe("http://[::1]:8787")
  })

  test("validateHttpsOrLoopback rejects http://localhost, plain http hosts, credentials, query, and fragments", () => {
    for (const bad of [
      "",
      "not-a-url",
      "http://localhost:8787",
      "http://example.com",
      "ftp://portal.nousresearch.com",
      "https://user:pass@portal.nousresearch.com",
      "https://portal.nousresearch.com?foo=bar",
      "https://portal.nousresearch.com#frag",
    ]) {
      expect(() => validateHttpsOrLoopback(bad, "portal")).toThrow()
    }
    expect(
      validateHttpsOrLoopback("https://portal.nousresearch.com/device?user_code=ABCD", "verify", { allowQuery: true }),
    ).toBe("https://portal.nousresearch.com/device?user_code=ABCD")
  })

  test("validateAuthorizeURL allows accounts.google.com and loopback only when portal is loopback", () => {
    expect(
      validateAuthorizeURL("https://accounts.google.com/o/oauth2/v2/auth?hd=example.com", DEFAULT_NOUS_PORTAL_URL).href,
    ).toBe("https://accounts.google.com/o/oauth2/v2/auth?hd=example.com")
    expect(() => validateAuthorizeURL("https://evil.example/o/oauth2/v2/auth", DEFAULT_NOUS_PORTAL_URL)).toThrow()
    expect(() => validateAuthorizeURL("http://127.0.0.1:9999/auth", DEFAULT_NOUS_PORTAL_URL)).toThrow()
    expect(validateAuthorizeURL("http://127.0.0.1:9999/auth", "http://127.0.0.1:8787").href).toBe(
      "http://127.0.0.1:9999/auth",
    )
  })

  test("resolvePortalBaseURL obeys precedence and rejects invalid explicit values without fallback", () => {
    expect(resolvePortalBaseURL(undefined, {})).toBe(DEFAULT_NOUS_PORTAL_URL)
    expect(
      resolvePortalBaseURL(undefined, {
        HERMES_PORTAL_BASE_URL: "https://hermes.example/",
      }),
    ).toBe("https://hermes.example")
    expect(
      resolvePortalBaseURL(undefined, {
        NOUS_PORTAL_BASE_URL: "https://nous.example/",
        HERMES_PORTAL_BASE_URL: "https://hermes.example/",
      }),
    ).toBe("https://nous.example")
    expect(
      resolvePortalBaseURL(undefined, {
        SHUVCODE_NOUS_PORTAL_URL: "https://shuv.example/",
        NOUS_PORTAL_BASE_URL: "https://nous.example/",
      }),
    ).toBe("https://shuv.example")
    expect(
      resolvePortalBaseURL("http://127.0.0.1:8080/", {
        SHUVCODE_NOUS_PORTAL_URL: "https://shuv.example/",
      }),
    ).toBe("http://127.0.0.1:8080")
    expect(() => resolvePortalBaseURL("http://localhost:8080", {})).toThrow()
    expect(() => resolvePortalBaseURL(undefined, { SHUVCODE_NOUS_PORTAL_URL: "http://evil.example" })).toThrow()
  })

  test("timingSafeEqualString, sanitizeErrorCode, retryAfterMs, and readBoundedText behave safely", async () => {
    expect(timingSafeEqualString("abc123", "abc123")).toBe(true)
    expect(timingSafeEqualString("abc123", "abc124")).toBe(false)
    expect(timingSafeEqualString("abc123", "abc")).toBe(false)
    expect(timingSafeEqualString("abc123", null)).toBe(false)

    expect(sanitizeErrorCode("invalid_grant")).toBe("invalid_grant")
    expect(sanitizeErrorCode("  access.denied-1  ")).toBe("access.denied-1")
    expect(sanitizeErrorCode("contains spaces")).toBeUndefined()
    expect(sanitizeErrorCode("<script>alert(1)</script>")).toBeUndefined()
    expect(sanitizeErrorCode("a".repeat(65))).toBeUndefined()
    expect(sanitizeErrorCode(42)).toBeUndefined()

    const now = 1_700_000_000_000
    expect(retryAfterMs(new Response("", { headers: { "retry-after": "12" } }), now)).toBe(12_000)
    expect(retryAfterMs(new Response("", { headers: { "retry-after": "999" } }), now)).toBe(60_000)
    expect(
      retryAfterMs(new Response("", { headers: { "retry-after": new Date(now + 15_000).toUTCString() } }), now),
    ).toBe(15_000)

    const big = new Response("x".repeat(200))
    expect((await readBoundedText(big, 32)).length).toBe(32)
  })
})
