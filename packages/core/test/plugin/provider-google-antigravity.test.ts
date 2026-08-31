import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/schema/session"
import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { GoogleAntigravityPlugin } from "@opencode-ai/core/plugin/provider/google-antigravity-adapter"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { GoogleAntigravityOAuth, GoogleAntigravityWire } from "@shuvcode/antigravity-plugin"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Provider } from "@opencode-ai/core/provider"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/tmpdir"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const itDefault = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), [
    [Global.node, tempGlobalLayer],
  ]),
)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GoogleAntigravityPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

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

describe("GoogleAntigravityOAuth", () => {
  it.effect("is registered in ProviderPlugins by the default-activation adapter", () =>
    Effect.sync(() => {
      expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.google-antigravity")
      expect(ProviderPlugins.find((item) => item.id === GoogleAntigravityPlugin.id)).toBe(GoogleAntigravityPlugin)
    }),
  )

  it.effect("builds an official CLI user agent and authorize URL", () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect("keeps the current refresh token when Google omits a new one", () =>
    Effect.sync(() => {
      expect(GoogleAntigravityOAuth.nextRefresh("1//current", undefined)).toBe("1//current")
      expect(GoogleAntigravityOAuth.nextRefresh("1//current", "1//next")).toBe("1//next")
    }),
  )

  it.effect("parses V1 accounts and oauth token blobs without live Google", () =>
    Effect.sync(() => {
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
    }),
  )
})

describe("GoogleAntigravityWire", () => {
  it.effect("wraps a native Gemini body in the Cloud Code envelope", () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect("maps the deprecated 3.1 Pro alias and never marks Claude usage", () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect("unwraps Cloud Code SSE response envelopes", () =>
    Effect.sync(() => {
      const native = { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }] }
      const text = `data: ${JSON.stringify({ response: native, traceId: "tr", metadata: {} })}\n\ndata: [DONE]\n`
      expect(GoogleAntigravityWire.unwrapSSEText(text)).toBe(`data: ${JSON.stringify(native)}\n\ndata: [DONE]\n`)
    }),
  )

  it.effect("filters Claude, GPT, tab, and image models out of the Cloud Code catalog", () =>
    Effect.sync(() => {
      const filtered = GoogleAntigravityWire.filterGoogleModels([
        { id: "gemini-3.7-flash-high", provider: "MODEL_PROVIDER_GOOGLE", recommended: true },
        { id: "claude-sonnet-4-6", provider: "MODEL_PROVIDER_ANTHROPIC", recommended: true },
        { id: "gpt-oss-120b-medium", provider: "MODEL_PROVIDER_OPENAI", recommended: true },
        { id: "tab_flash_lite_preview", provider: "MODEL_PROVIDER_GOOGLE" },
        { id: "gemini-3.1-flash-image", provider: "MODEL_PROVIDER_GOOGLE" },
        { id: "chat_20706", provider: "MODEL_PROVIDER_GOOGLE", internal: true },
      ])
      expect(filtered.map((model) => model.id)).toEqual(["gemini-3.7-flash-high"])
    }),
  )
})

describe("GoogleAntigravityPlugin", () => {
  itDefault.live("exposes Google AI Pro OAuth on /connect when installed by default", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const google = yield* Effect.gen(function* () {
            yield* (yield* PluginSupervisor.Service).flush
            const plugins = yield* (yield* Plugin.Service).list()
            expect(plugins.some((plugin) => plugin.id === GoogleAntigravityPlugin.id && plugin.status === "active")).toBe(
              true,
            )
            return required(yield* (yield* Integration.Service).get(Integration.ID.make("google")))
          }).pipe(
            Effect.scoped,
            Effect.provide(
              LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) })),
            ),
          )
          expect(google.methods).toContainEqual({
            id: Integration.MethodID.make("google-ai-pro"),
            type: "oauth",
            label: "Google AI Pro / Antigravity",
          })
        }),
      ),
    ),
  )

  it.effect("registers the Google AI Pro OAuth method on google", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integration = required(yield* (yield* Integration.Service).get(Integration.ID.make("google")))
      expect(integration.methods).toContainEqual({
        id: Integration.MethodID.make("google-ai-pro"),
        type: "oauth",
        label: "Google AI Pro / Antigravity",
      })
    }),
  )

  it.effect("filters http hooks to Google so OpenAI remains WebSocket-eligible", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      expect(yield* hooks.has("session", "http.request", Provider.ID.google)).toBe(true)
      expect(yield* hooks.has("session", "http.response", Provider.ID.google)).toBe(true)
      expect(yield* hooks.has("session", "http.request", Provider.ID.openai)).toBe(false)
      expect(yield* hooks.has("session", "http.response", Provider.ID.openai)).toBe(false)
    }),
  )

  it.effect("enables only shipped Google models under a subscription connection", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(Provider.ID.google, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/google")
        })
        draft.model.update(Provider.ID.google, Model.ID.make("gemini-2.5-flash"), (model) => {
          model.name = "Gemini 2.5 Flash"
          model.enabled = true
        })
        draft.model.update(Provider.ID.google, Model.ID.make("claude-sonnet-4-6"), (model) => {
          model.name = "Claude Sonnet 4.6"
          model.enabled = true
        })
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("google"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("google-ai-pro"),
          access: "ya29.test",
          refresh: "1//test",
          expires: Date.now() + 3_600_000,
          metadata: { projectId: "canvas-wallaby-dvmxc", email: "user@gmail.com" },
        }),
      })
      yield* addPlugin()

      const flash = required(yield* catalog.model.get(Provider.ID.google, Model.ID.make("gemini-3.7-flash-high")))
      expect(flash).toMatchObject({
        name: "Gemini 3.7 Flash (High)",
        enabled: true,
        cost: [],
        limit: { context: 1_048_576, output: 65_536 },
      })
      expect(required(yield* catalog.model.get(Provider.ID.google, Model.ID.make("gemini-2.5-flash"))).enabled).toBe(
        false,
      )
      expect(required(yield* catalog.model.get(Provider.ID.google, Model.ID.make("claude-sonnet-4-6"))).enabled).toBe(
        false,
      )
      expect(yield* catalog.model.get(Provider.ID.google, Model.ID.make("gpt-oss-120b-medium"))).toBeUndefined()
    }),
  )

  it.effect("leaves the Google catalog alone under an API key connection", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(Provider.ID.google, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/google")
        })
        draft.model.update(Provider.ID.google, Model.ID.make("gemini-2.5-flash"), (model) => {
          model.enabled = true
        })
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("google"),
        value: Credential.Key.make({ type: "key", key: "AIza-test" }),
      })
      yield* addPlugin()
      expect(required(yield* catalog.model.get(Provider.ID.google, Model.ID.make("gemini-2.5-flash"))).enabled).toBe(
        true,
      )
      expect(yield* catalog.model.get(Provider.ID.google, Model.ID.make("gemini-3.7-flash-high"))).toBeUndefined()
    }),
  )

  it.effect("rewrites generate requests onto Cloud Code and unwraps SSE responses", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("google"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("google-ai-pro"),
          access: "ya29.live",
          refresh: "1//live",
          expires: Date.now() + 3_600_000,
          metadata: { projectId: "canvas-wallaby-dvmxc" },
        }),
      })
      yield* addPlugin()

      const hooks = yield* PluginHooks.Service
      const context = {
        sessionID: Session.ID.make("ses_wire"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-3.7-flash-high") }),
      }
      const request = yield* hooks.trigger("session", "http.request", {
        ...context,
        request: new Request("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash-high:streamGenerateContent?alt=sse", {
          method: "POST",
          headers: { "x-goog-api-key": "ya29.live", "content-type": "application/json" },
          body: JSON.stringify(nativeBody),
        }),
      })
      expect(request.request.url).toBe(GoogleAntigravityWire.generateURL)
      expect(request.request.headers.get("authorization")).toBe("Bearer ya29.live")
      expect(request.request.headers.get("user-agent")).toBe(GoogleAntigravityOAuth.userAgent())
      expect(request.request.headers.get("x-goog-api-key")).toBeNull()
      const wrapped = JSON.parse(yield* Effect.promise(() => request.request.text())) as {
        project: string
        model: string
        request: { labels: Record<string, string>; toolConfig: { functionCallingConfig: { mode: string } } }
      }
      expect(wrapped.project).toBe("canvas-wallaby-dvmxc")
      expect(wrapped.model).toBe("gemini-3.7-flash-high")
      expect(wrapped.request.labels.used_claude).toBe("false")
      expect(wrapped.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED")

      const native = { candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }] }
      const response = yield* hooks.trigger("session", "http.response", {
        ...context,
        request: request.request,
        response: new Response(`data: ${JSON.stringify({ response: native, traceId: "t" })}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
      })
      expect(yield* Effect.promise(() => response.response.text())).toBe(`data: ${JSON.stringify(native)}\n\n`)
    }),
  )

  it.effect("refuses to generate without a stored Cloud Code project id", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("google"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("google-ai-pro"),
          access: "ya29.live",
          refresh: "1//live",
          expires: Date.now() + 3_600_000,
        }),
      })
      yield* addPlugin()
      const exit = yield* (yield* PluginHooks.Service)
        .trigger("session", "http.request", {
          sessionID: Session.ID.make("ses_missing"),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-3.7-flash-high") }),
          request: new Request(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash-high:streamGenerateContent?alt=sse",
            { method: "POST", body: "{}" },
          ),
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
