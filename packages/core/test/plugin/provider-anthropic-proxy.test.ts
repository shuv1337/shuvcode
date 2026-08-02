import { describe, expect, test } from "bun:test"
import { AnthropicClaudeCode } from "@opencode-ai/core/plugin/provider/anthropic-claude-code"
import { AnthropicClaudeCodeProxy } from "@opencode-ai/core/plugin/provider/anthropic-claude-code-proxy"

describe("AnthropicClaudeCodeProxy", () => {
  test("authorizes forwarded requests with a fresh token and Claude Code headers", async () => {
    const seen: { url: string; headers: Headers; body: string }[] = []
    const upstream = async (input: Request | string | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      seen.push({ url: request.url, headers: request.headers, body: await request.text() })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "11" },
      })
    }
    const proxy = await AnthropicClaudeCodeProxy.start({ getAccessToken: async () => "token-123", fetchImpl: upstream })

    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "stale-resolver-key",
        "anthropic-beta": "provider-extra-flag",
      },
      body: JSON.stringify({ model: "claude", messages: [] }),
    })
    await proxy.close()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages")
    expect(seen[0].headers.get("authorization")).toBe("Bearer token-123")
    expect(seen[0].headers.get("x-api-key")).toBeNull()
    expect(seen[0].headers.get("user-agent")).toBe(AnthropicClaudeCode.userAgent)
    expect(seen[0].headers.get("x-app")).toBe("cli")
    // Required flags and the caller-supplied flag both survive the merge.
    for (const flag of [...AnthropicClaudeCode.betaFlags.split(","), "provider-extra-flag"]) {
      expect(seen[0].headers.get("anthropic-beta")).toContain(flag)
    }
    // The body passes through untouched: shaping belongs to the transport.
    expect(JSON.parse(seen[0].body)).toEqual({ model: "claude", messages: [] })
  })

  test("rejects with 401 when no subscription credential is available", async () => {
    let called = false
    const upstream = async () => {
      called = true
      return new Response("{}")
    }
    const proxy = await AnthropicClaudeCodeProxy.start({ getAccessToken: async () => undefined, fetchImpl: upstream })

    const response = await fetch(`${proxy.url}/v1/messages`, { method: "POST", body: "{}" })
    await proxy.close()

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ type: "error", error: { type: "authentication_error" } })
    expect(called).toBe(false)
  })
})
