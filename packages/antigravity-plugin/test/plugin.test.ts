import { describe, expect, test } from "bun:test"
import plugin, { GoogleAntigravityOAuth, GoogleAntigravityPlugin, GoogleAntigravityWire, ID } from "../src/index"
import { OauthCallbackPage } from "../src/page"

const nativeBody = {
  contents: [{ role: "user", parts: [{ text: "hello" }] }],
  systemInstruction: { parts: [{ text: "be brief" }] },
  tools: [
    {
      functionDeclarations: [
        {
          name: "read",
          description: "Read a file",
          parameters: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {
              path: { type: "string", default: ".", const: "README.md" },
            },
            $defs: { unused: { type: "string" } },
            $ref: "#/$defs/unused",
          },
        },
      ],
    },
  ],
  generationConfig: { maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 1000 } },
}

describe("GoogleAntigravityPlugin package", () => {
  test("default export is the Effect plugin", () => {
    expect(plugin).toBe(GoogleAntigravityPlugin)
    expect(plugin.id).toBe(ID)
    expect(plugin.id).toBe("opencode.provider.google-antigravity")
    expect(typeof plugin.effect).toBe("function")
  })

  test("builds an official CLI user agent and authorize URL", () => {
    const pkce = GoogleAntigravityOAuth.pkce()
    const url = new URL(GoogleAntigravityOAuth.authorizeURL(pkce.challenge, "state-1"))
    expect(GoogleAntigravityOAuth.userAgent()).toMatch(
      /^antigravity\/cli\/1\.1\.13 \(aidev_client; os_type=(linux|darwin|windows); arch=(amd64|arm64); cl=964361259; auth_method=consumer\)$/,
    )
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(url.searchParams.get("client_id")).toBe(GoogleAntigravityOAuth.clientID)
    expect(url.searchParams.get("redirect_uri")).toBe(GoogleAntigravityOAuth.redirectURI)
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toBe("consent")
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GoogleAntigravityOAuth.scopes])
  })

  test("keeps the current refresh token when Google omits a new one", () => {
    expect(GoogleAntigravityOAuth.nextRefresh("1//current", undefined)).toBe("1//current")
    expect(GoogleAntigravityOAuth.nextRefresh("1//current", "1//next")).toBe("1//next")
  })

  test("parses V1 accounts and oauth token blobs without live Google", () => {
    const imported = GoogleAntigravityOAuth.parseV1Accounts(
      JSON.stringify({
        version: 2,
        activeIndex: 0,
        accounts: [{ refreshToken: "1//abc|canvas-wallaby-dvmxc", projectId: "canvas-wallaby-dvmxc" }],
      }),
    )
    expect(imported).toMatchObject({ refresh: "1//abc", projectId: "canvas-wallaby-dvmxc" })
    expect(
      GoogleAntigravityOAuth.parseOAuthTokenBlob(
        JSON.stringify({ refresh_token: "1//blob", access_token: "ya29.a", expires_in: 3600, email: "user@gmail.com" }),
      ),
    ).toMatchObject({ refresh: "1//blob", access: "ya29.a", email: "user@gmail.com" })
    expect(GoogleAntigravityOAuth.parseOAuthTokenBlob("not-json")).toBeUndefined()
  })

  test("documents Bun SQLite as the vscdb import requirement", () => {
    const source = Bun.file(new URL("../src/oauth.ts", import.meta.url)).text()
    return source.then((text) => {
      expect(text).toContain('await import("bun:sqlite")')
      expect(text).toContain("Bun SQLite")
    })
  })
})

describe("GoogleAntigravityWire", () => {
  test("wraps a native Gemini body in the Cloud Code envelope", () => {
    const wrapped = GoogleAntigravityWire.wrapGenerateRequest({
      body: nativeBody,
      projectId: "canvas-wallaby-dvmxc",
      model: "gemini-3.7-flash-low",
      sessionID: "ses_test",
      modelEnum: "MODEL_PLACEHOLDER_M300",
      now: 1_700_000_000_000,
      trajectory: "traj-1",
    }) as {
      project: string
      requestId: string
      model: string
      userAgent: string
      requestType: string
      request: {
        systemInstruction: { role: string }
        toolConfig: { functionCallingConfig: { mode: string } }
        tools: Array<{ functionDeclarations: Array<{ parameters: Record<string, unknown> }> }>
        labels: Record<string, string>
        generationConfig: { thinkingConfig: { includeThoughts: boolean; thinkingBudget: number } }
      }
    }
    expect(wrapped.project).toBe("canvas-wallaby-dvmxc")
    expect(wrapped.model).toBe("gemini-3.7-flash-low")
    expect(wrapped.userAgent).toBe("antigravity")
    expect(wrapped.requestType).toBe("agent")
    expect(wrapped.requestId).toBe("agent/ses_test/1700000000000/traj-1/2")
    expect(wrapped.request.systemInstruction.role).toBe("user")
    expect(wrapped.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED")
    expect(wrapped.request.labels).toEqual({
      last_step_index: "1",
      model_enum: "MODEL_PLACEHOLDER_M300",
      request_id: "traj-1-0",
      trajectory_id: "traj-1",
      used_claude: "false",
      used_claude_conservative: "false",
      used_non_gemini_model: "false",
    })
    expect(wrapped.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 1000 })
    expect(wrapped.request.tools[0]?.functionDeclarations[0]?.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string", enum: ["README.md"] } },
    })
  })

  test("maps the deprecated 3.1 Pro alias and never marks Claude usage", () => {
    const wrapped = GoogleAntigravityWire.wrapGenerateRequest({
      body: { contents: [] },
      projectId: "proj",
      model: "gemini-3.1-pro-high",
      sessionID: "ses_x",
      trajectory: "t",
      now: 1,
    }) as { model: string; request: { labels: Record<string, string> } }
    expect(wrapped.model).toBe("gemini-pro-agent")
    expect(wrapped.request.labels.used_claude).toBe("false")
    expect(wrapped.request.labels.used_non_gemini_model).toBe("false")
  })

  test("unwraps Cloud Code SSE response envelopes", () => {
    const native = { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }] }
    const text = `data: ${JSON.stringify({ response: native, traceId: "tr", metadata: {} })}\n\ndata: [DONE]\n`
    expect(GoogleAntigravityWire.unwrapSSEText(text)).toBe(`data: ${JSON.stringify(native)}\n\ndata: [DONE]\n`)
  })

  test("filters Claude, GPT, tab, and image models out of the Cloud Code catalog", () => {
    const filtered = GoogleAntigravityWire.filterGoogleModels([
      { id: "gemini-3.7-flash-high", provider: "MODEL_PROVIDER_GOOGLE", recommended: true },
      { id: "claude-sonnet-4-6", provider: "MODEL_PROVIDER_ANTHROPIC", recommended: true },
      { id: "gpt-oss-120b-medium", provider: "MODEL_PROVIDER_OPENAI", recommended: true },
      { id: "tab_flash_lite_preview", provider: "MODEL_PROVIDER_GOOGLE" },
      { id: "gemini-3.1-flash-image", provider: "MODEL_PROVIDER_GOOGLE" },
      { id: "chat_20706", provider: "MODEL_PROVIDER_GOOGLE", internal: true },
    ])
    expect(filtered.map((model) => model.id)).toEqual(["gemini-3.7-flash-high"])
  })
})

describe("OAuth callback HTML", () => {
  test("vendors success and error pages without Core oauth/page", () => {
    const ok = OauthCallbackPage.success({ provider: "Google AI Pro" })
    const fail = OauthCallbackPage.error("denied", { provider: "Google AI Pro" })
    expect(ok).toContain("Authorization successful")
    expect(ok).toContain("Google AI Pro")
    expect(fail).toContain("Authorization failed")
    expect(fail).toContain("denied")
  })
})
