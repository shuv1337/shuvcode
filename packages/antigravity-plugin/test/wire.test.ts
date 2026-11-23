import { describe, expect, test } from "bun:test"
import { Model } from "@opencode/plugin/effect"
import { GoogleSolsticeWire } from "../src/wire"

describe("GoogleSolsticeWire", () => {
  test("rewrites native Gemini generateContent URLs to v1alpha PerUserQuota and strips key param", () => {
    expect(
      GoogleSolsticeWire.rewriteGenerateURL(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-neon:streamGenerateContent?key=secret-key",
      ),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1alpha/models/gemini-4-neon:streamGenerateContentPerUserQuota?alt=sse",
    )

    expect(
      GoogleSolsticeWire.rewriteGenerateURL(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=secret&trace=1",
      ),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1alpha/models/gemini-4-hydrogen:generateContentPerUserQuota?trace=1",
    )

    // Idempotent when already PerUserQuota
    expect(
      GoogleSolsticeWire.rewriteGenerateURL(
        "https://generativelanguage.googleapis.com/v1alpha/models/gemini-4-carbon:streamGenerateContentPerUserQuota?alt=sse",
      ),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1alpha/models/gemini-4-carbon:streamGenerateContentPerUserQuota?alt=sse",
    )

    // Custom test/proxy origin preserves origin and rewrites /v1beta -> /v1alpha
    expect(
      GoogleSolsticeWire.rewriteGenerateURL(
        "http://127.0.0.1:9999/v1beta/models/gemini-4-neon:streamGenerateContent?key=k",
      ),
    ).toBe("http://127.0.0.1:9999/v1alpha/models/gemini-4-neon:streamGenerateContentPerUserQuota?alt=sse")

    // Non-generateContent endpoints return undefined so the hook fails closed
    expect(
      GoogleSolsticeWire.rewriteGenerateURL("https://generativelanguage.googleapis.com/v1beta/models"),
    ).toBeUndefined()
    expect(
      GoogleSolsticeWire.rewriteGenerateURL("https://generativelanguage.googleapis.com/v1beta/files"),
    ).toBeUndefined()
    expect(
      GoogleSolsticeWire.rewriteGenerateURL("file:///v1beta/models/gemini-4-neon:streamGenerateContent"),
    ).toBeUndefined()
    expect(GoogleSolsticeWire.rewriteGenerateURL("not-a-url")).toBeUndefined()
  })

  test("applyRequestHeaders swaps x-goog-api-key for Bearer auth without spoofing User-Agent", () => {
    const headers = new Headers({
      "x-goog-api-key": "remove-me",
      "user-agent": "opencode/test",
      "content-type": "application/json",
    })
    GoogleSolsticeWire.applyRequestHeaders(headers, "fixture-solstice-token")
    expect(headers.has("x-goog-api-key")).toBe(false)
    expect(headers.get("authorization")).toBe("Bearer fixture-solstice-token")
    expect(headers.get("user-agent")).toBe("opencode/test")
  })

  test("ships the 4 confirmed Solstice models with 20-minute chunk timeout", () => {
    expect(GoogleSolsticeWire.defaultModelID).toBe(Model.ID.make("gemini-4-neon"))
    expect(GoogleSolsticeWire.CHUNK_TIMEOUT_MS).toBe(1_200_000)
    expect(GoogleSolsticeWire.shippedModels.map((model) => model.id)).toEqual([
      "gemini-4-neon",
      "gemini-4-hydrogen",
      "gemini-4-carbon",
      "gemini-3.5-flash-lite",
    ])
    expect(GoogleSolsticeWire.shippedModels.find((m) => m.id === "gemini-4-neon")?.efforts).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ])
    expect(GoogleSolsticeWire.shippedModels.find((m) => m.id === "gemini-4-hydrogen")?.efforts).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ])
    expect(GoogleSolsticeWire.shippedModels.find((m) => m.id === "gemini-4-carbon")?.efforts).toEqual([
      "low",
      "medium",
      "high",
    ])
    expect(GoogleSolsticeWire.shippedModels.find((m) => m.id === "gemini-4-carbon")?.minOutput).toBe(65_536)
    expect(GoogleSolsticeWire.shippedModels.find((m) => m.id === "gemini-3.5-flash-lite")?.family).toBe(
      "gemini-flash-lite",
    )
  })
})
