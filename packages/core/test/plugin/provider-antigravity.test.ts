import { expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpClientResponse } from "effect/http"
import { Message, ToolDefinition } from "@opencode/ai"
import { LLM } from "@opencode/ai/effect"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Gemini } from "@opencode/ai/protocols"
import { Agent } from "@opencode/schema/agent"
import { Document, Info } from "@opencode/schema/config"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { createLLMEventPublisher } from "@opencode/core/session/runner/publish-llm-event"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import {
  GoogleSolsticeOAuth,
  GoogleSolsticePlugin,
  GoogleSolsticeWire,
  NousPortalOAuth,
  createPlugin,
} from "@shuvcode/antigravity-plugin"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const portal = "http://127.0.0.1:9922"
const identity = {
  sessionID: Session.ID.make("ses_solstice"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-4-neon") }),
  kind: "primary" as const,
}
const importedSolstice = Credential.OAuth.make({
  type: "oauth",
  methodID: GoogleSolsticeOAuth.methodID,
  access: "fixture-solstice-token",
  refresh: "",
  expires: Date.now() + 3_600_000,
  metadata: { portalBaseURL: portal, shuvcodeAuthImport: "access-only" },
})
const legacyAntigravity = Credential.OAuth.make({
  type: "oauth",
  methodID: GoogleSolsticeOAuth.legacyMethodID,
  access: "fixture-legacy-token",
  refresh: "1//legacy",
  expires: Date.now() + 3_600_000,
  metadata: { projectId: "legacy-project" },
})

const addPlugin = (pluginDef = GoogleSolsticePlugin) =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin, "test")
    yield* pluginDef.effect(host)
  })

const decodeConfig = Schema.decodeUnknownSync(Info)

const seedGoogleCatalog = Effect.fn(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(Provider.ID.google, (draft) => {
      draft.package = "@opencode/ai/providers/google/interactions"
    })
    // Simulate models.dev shipping unary 32k output + interactions package on gemini-4-carbon.
    // Solstice forces @opencode/ai/providers/google and raises output floor to 64k.
    editor.models.update(Provider.ID.google, Model.ID.make("gemini-4-carbon"), (draft) => {
      draft.name = "Gemini 4 Carbon (Catalog)"
      draft.family = Model.Family.make("gemini")
      draft.package = "@opencode/ai/providers/google/interactions"
      draft.limit = { context: 1_048_576, output: 32_768 }
      draft.variants = [
        {
          id: Model.VariantID.make("high"),
          settings: { thinkingLevel: "high", thinkingSummaries: "auto" },
        },
      ]
    })
    editor.models.update(Provider.ID.google, Model.ID.make("gemini-old"), () => {})
  })
})

it.effect(
  "Solstice exposes 4 zero-cost models, 20m chunkTimeout, small model pick, forces google package, and never exposes Nous provider",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const integration = yield* Integration.Service
      yield* seedGoogleCatalog()
      yield* credentials.create({ integrationID: Integration.ID.make("google"), value: importedSolstice })
      yield* addPlugin()

      expect(yield* providers.get(Provider.ID.make("nous"))).toBeUndefined()
      expect((yield* integration.get(NousPortalOAuth.integrationID))?.methods).toContainEqual(
        expect.objectContaining({ id: "nous-device", type: "oauth" }),
      )

      const google = yield* providers.get(Provider.ID.google)
      expect(google?.package).toBe("@opencode/ai/providers/google")
      expect(google?.settings?.chunkTimeout).toBe(GoogleSolsticeWire.CHUNK_TIMEOUT_MS)

      for (const item of GoogleSolsticeWire.shippedModels) {
        const model = yield* models.get(Provider.ID.google, Model.ID.make(item.id))
        expect(model?.enabled).toBe(true)
        expect(model?.cost).toEqual([])
        expect(model?.package).toBe("@opencode/ai/providers/google")
        expect(model?.modelID).toBe(Model.ID.make(item.id))
        expect(model?.limit).toEqual({ context: 1_048_576, output: 65_536 })
      }
      // Catalog name preserved on cataloged gemini-4-carbon while output floor raised from 32k -> 64k
      // and Interactions-shaped variants are rewritten to native GenerateContent thinkingConfig.
      const carbon = yield* models.get(Provider.ID.google, Model.ID.make("gemini-4-carbon"))
      expect(carbon?.name).toBe("Gemini 4 Carbon (Catalog)")
      expect(carbon?.variants).toEqual([
        {
          id: Model.VariantID.make("low"),
          settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } },
        },
        {
          id: Model.VariantID.make("medium"),
          settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" } },
        },
        {
          id: Model.VariantID.make("high"),
          settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        },
      ])
      // Uncataloged models get fallback multimodal capabilities and native thinking variants (including xhigh on Neon)
      const neon = yield* models.get(Provider.ID.google, Model.ID.make("gemini-4-neon"))
      expect(neon?.variants.map((variant) => String(variant.id))).toEqual(["low", "medium", "high", "xhigh"])
      const flashLite = yield* models.get(Provider.ID.google, Model.ID.make("gemini-3.5-flash-lite"))
      expect(flashLite?.capabilities.input).toContain("pdf")
      expect(flashLite?.variants.map((variant) => String(variant.id))).toEqual(["minimal", "low", "medium", "high"])
      expect((yield* models.small(Provider.ID.google))?.id).toBe(Model.ID.make("gemini-3.5-flash-lite"))
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-old")))?.enabled).toBe(false)
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-old")))?.cost).toEqual([])
    }),
)

it.effect(
  "user-configured future Gemini slug via real ConfigProviderPlugin stays enabled without disabled:false and routes to PerUserQuota",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const models = yield* Model.Service
      const hooks = yield* PluginHooks.Service
      const plugin = yield* Plugin.Service
      yield* seedGoogleCatalog()
      yield* credentials.create({ integrationID: Integration.ID.make("google"), value: importedSolstice })
      yield* addPlugin()

      // Activate real ConfigProviderPlugin after GoogleSolsticePlugin with a brand-new future slug
      // and NO explicit `disabled: false`.
      const configHost = yield* PluginHost.make(plugin, "config-provider-test")
      yield* ConfigProviderPlugin.Plugin.effect(configHost).pipe(
        Effect.provide(
          Config.testLayer([
            new Document({
              type: "document",
              info: decodeConfig({
                providers: {
                  google: {
                    models: {
                      "gemini-4-xenon": { name: "Gemini 4 Xenon" },
                    },
                  },
                },
              }),
            }),
          ]),
        ),
      )

      const xenon = yield* models.get(Provider.ID.google, Model.ID.make("gemini-4-xenon"))
      expect(xenon?.enabled).toBe(true)
      expect(xenon?.cost).toEqual([])
      expect(
        (yield* models.available()).some((m) => m.providerID === Provider.ID.google && m.id === "gemini-4-xenon"),
      ).toBe(true)
      // Pre-config non-shipped catalog models remain hidden.
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-old")))?.enabled).toBe(false)

      const event = yield* hooks.trigger("session", "http.request", {
        ...identity,
        model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-4-xenon") }),
        request: new Request(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-xenon:streamGenerateContent?key=drop",
          {
            method: "POST",
            headers: { "x-goog-api-key": "drop", "content-type": "application/json" },
            body: '{"contents":[]}',
          },
        ),
      })
      expect(event.request.url).toBe(
        "https://generativelanguage.googleapis.com/v1alpha/models/gemini-4-xenon:streamGenerateContentPerUserQuota?alt=sse",
      )
      expect(event.request.headers.get("authorization")).toBe("Bearer fixture-solstice-token")
      expect(event.request.headers.has("x-goog-api-key")).toBe(false)
    }),
)

it.effect("Solstice keeps API-key Google catalog and HTTP requests completely untouched", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const models = yield* Model.Service
    const hooks = yield* PluginHooks.Service
    yield* seedGoogleCatalog()
    yield* credentials.create({
      integrationID: Integration.ID.make("google"),
      value: Credential.Key.make({ type: "key", key: "fixture-api-key" }),
    })
    yield* addPlugin()
    expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-old")))?.enabled).toBe(true)
    const request = new Request(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-old:streamGenerateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": "fixture-api-key" },
        body: "{}",
      },
    )
    expect((yield* hooks.trigger("session", "http.request", { ...identity, request })).request).toBe(request)
  }),
)

it.effect("Solstice fails closed on non-GenerateContent URLs so OAuth tokens never leak as API keys", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const hooks = yield* PluginHooks.Service
    yield* seedGoogleCatalog()
    yield* credentials.create({ integrationID: Integration.ID.make("google"), value: importedSolstice })
    yield* addPlugin()
    const exit = yield* Effect.exit(
      hooks.trigger("session", "http.request", {
        ...identity,
        request: new Request("https://generativelanguage.googleapis.com/v1beta/models", { method: "GET" }),
      }),
    )
    expect(exit._tag).toBe("Failure")
  }),
)

it.effect(
  "legacy google-ai-pro credential disables google provider/models, marks needs_auth, fails closed, and restores on reconnect",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integration = yield* Integration.Service
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const hooks = yield* PluginHooks.Service
      yield* seedGoogleCatalog()
      yield* credentials.create({ integrationID: Integration.ID.make("google"), value: legacyAntigravity })
      yield* addPlugin()

      // Provider and models are excluded from available lists so neither Model.default() nor Generate.Service use legacy auth.
      expect((yield* providers.available()).some((provider) => provider.id === Provider.ID.google)).toBe(false)
      expect((yield* models.available()).some((model) => model.providerID === Provider.ID.google)).toBe(false)

      const googleIntegration = yield* integration.get(GoogleSolsticeOAuth.integrationID)
      expect(googleIntegration?.connections[0]?.status?.status).toBe("needs_auth")
      expect(googleIntegration?.connections[0]?.status?.message).toContain("Google (Solstice)")

      const exit = yield* Effect.exit(
        hooks.trigger("session", "http.request", {
          ...identity,
          request: new Request(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent",
            { method: "POST", body: "{}" },
          ),
        }),
      )
      expect(exit._tag).toBe("Failure")

      // Switching to a Solstice credential clears legacy mode and restores google availability.
      const solsticeCred = yield* credentials.create({
        integrationID: Integration.ID.make("google"),
        value: importedSolstice,
      })
      yield* credentials.activate(solsticeCred.id)
      // Wait for credential event reload to propagate.
      yield* Effect.yieldNow
      yield* providers.reload()
      yield* models.reload()
      expect((yield* providers.available()).some((provider) => provider.id === Provider.ID.google)).toBe(true)
      expect((yield* models.available()).some((model) => model.providerID === Provider.ID.google)).toBe(true)
      expect((yield* integration.get(GoogleSolsticeOAuth.integrationID))?.connections[0]?.status).toBeUndefined()

      // Switching to an API key also restores normal google provider/catalog availability.
      const apiKeyCred = yield* credentials.create({
        integrationID: Integration.ID.make("google"),
        value: Credential.Key.make({ type: "key", key: "fixture-api-key" }),
      })
      yield* credentials.activate(apiKeyCred.id)
      yield* Effect.yieldNow
      yield* providers.reload()
      yield* models.reload()
      expect((yield* providers.available()).some((provider) => provider.id === Provider.ID.google)).toBe(true)
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-old")))?.enabled).toBe(true)
    }),
)

it.effect(
  "Solstice isolates needs_auth between google dead grant (cached by fingerprint), nous 401, and transient 502",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integration = yield* Integration.Service
      let mode: "transient" | "nous401" | "dead" | "ok" = "transient"
      let refreshCalls = 0

      const testPlugin = createPlugin({
        portalURL: portal,
        now: () => Date.now(),
        fetch: async (url) => {
          if (url === `${portal}/api/oauth/gemini-auth/refresh`) {
            refreshCalls += 1
            if (mode === "transient") {
              return Response.json({ error: "gemini_auth_refresh_failed" }, { status: 502 })
            }
            if (mode === "nous401") {
              return Response.json({ error: "invalid_token" }, { status: 401 })
            }
            if (mode === "dead") {
              return Response.json({ error: "invalid_grant" }, { status: 400 })
            }
            return Response.json({ access_token: "fixture-rotated", expires_in: 3600 })
          }
          throw new Error(`Unexpected URL: ${url}`)
        },
      })

      yield* credentials.create({
        integrationID: NousPortalOAuth.integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: NousPortalOAuth.methodID,
          access: "nous-access-live",
          refresh: "nous-refresh-live",
          expires: Date.now() + 3_600_000,
          metadata: { portalBaseURL: portal },
        }),
      })
      yield* credentials.create({
        integrationID: GoogleSolsticeOAuth.integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: GoogleSolsticeOAuth.methodID,
          access: "fixture-expired",
          refresh: "1//solstice-refresh-a",
          expires: 1,
          metadata: { portalBaseURL: portal },
        }),
      })
      yield* addPlugin(testPlugin)

      const statusOf = (id: Integration.ID) =>
        integration.get(id).pipe(Effect.map((info) => info?.connections[0]?.status))

      // 1. Initial load hit transient 502: neither google nor nous is marked needs_auth.
      expect(refreshCalls).toBe(1)
      expect(yield* statusOf(GoogleSolsticeOAuth.integrationID)).toBeUndefined()
      expect(yield* statusOf(NousPortalOAuth.integrationID)).toBeUndefined()

      // 2. Nous 401 marks nous needs_auth and NEVER marks google dead.
      mode = "nous401"
      const googleConn = (yield* integration.connection.active(GoogleSolsticeOAuth.integrationID))!
      expect((yield* Effect.exit(integration.connection.resolve(googleConn)))._tag).toBe("Failure")
      expect((yield* statusOf(NousPortalOAuth.integrationID))?.status).toBe("needs_auth")
      expect(yield* statusOf(GoogleSolsticeOAuth.integrationID)).toBeUndefined()

      // 3. Explicit Solstice invalid_grant marks google needs_auth and caches fingerprint so next call skips NAS.
      mode = "dead"
      expect((yield* Effect.exit(integration.connection.resolve(googleConn)))._tag).toBe("Failure")
      expect((yield* statusOf(GoogleSolsticeOAuth.integrationID))?.status).toBe("needs_auth")
      const callsAfterDead = refreshCalls
      expect((yield* Effect.exit(integration.connection.resolve(googleConn)))._tag).toBe("Failure")
      expect(refreshCalls).toBe(callsAfterDead)

      // 4. Reloading plugin with a non-expiring copy of the same dead refresh token preserves needs_auth.
      yield* credentials.create({
        integrationID: GoogleSolsticeOAuth.integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: GoogleSolsticeOAuth.methodID,
          access: "fixture-still-valid-access",
          refresh: "1//solstice-refresh-a",
          expires: Date.now() + 3_600_000,
          metadata: { portalBaseURL: portal },
        }),
      })
      yield* addPlugin(testPlugin)
      expect((yield* statusOf(GoogleSolsticeOAuth.integrationID))?.status).toBe("needs_auth")

      // 5. Reconnecting Google with a new refresh token clears the dead cache and refreshes cleanly.
      mode = "ok"
      yield* credentials.create({
        integrationID: GoogleSolsticeOAuth.integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: GoogleSolsticeOAuth.methodID,
          access: "fixture-expired-new",
          refresh: "1//solstice-refresh-b",
          expires: 1,
          metadata: { portalBaseURL: portal },
        }),
      })
      const rotatedConn = (yield* integration.connection.active(GoogleSolsticeOAuth.integrationID))!
      const resolved = yield* integration.connection.resolve(rotatedConn)
      expect(resolved?.type === "oauth" && resolved.access).toBe("fixture-rotated")
      expect(yield* statusOf(GoogleSolsticeOAuth.integrationID)).toBeUndefined()
    }),
)

it.effect(
  "Solstice streams native Gemini 2-step tool call with thoughtSignature and CONTINUATION through real Gemini protocol",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const hooks = yield* PluginHooks.Service
      yield* seedGoogleCatalog()
      yield* credentials.create({ integrationID: Integration.ID.make("google"), value: importedSolstice })
      yield* addPlugin()

      const routeModel = Gemini.route.model({ id: "gemini-4-argon" })
      const tool = ToolDefinition.make({
        name: "echo",
        description: "Echo text back",
        inputSchema: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string" } },
        },
      })

      const step1Body = yield* Gemini.protocol.body.from(
        LLM.request({
          id: "req_solstice_1",
          model: routeModel,
          system: "Be concise.",
          prompt: "Call echo.",
          tools: [tool],
          providerOptions: { thinkingConfig: { thinkingLevel: "high" } },
        }),
      )
      const step1Payload = JSON.stringify(step1Body)
      const step1Event = yield* hooks.trigger("session", "http.request", {
        ...identity,
        request: new Request(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse",
          {
            method: "POST",
            headers: { "x-goog-api-key": "drop-me", "content-type": "application/json" },
            body: step1Payload,
          },
        ),
      })
      expect(step1Event.request.url).toBe(
        "https://generativelanguage.googleapis.com/v1alpha/models/gemini-4-argon:streamGenerateContentPerUserQuota?alt=sse",
      )
      expect(step1Event.request.headers.get("authorization")).toBe("Bearer fixture-solstice-token")
      expect(step1Event.request.headers.has("x-goog-api-key")).toBe(false)
      // Body bytes pass through untouched (no envelope wrapping).
      expect(yield* Effect.promise(() => step1Event.request.clone().text())).toBe(step1Payload)

      // Native Gemini SSE directly into Gemini.transport (no http.response hook unwrapping needed),
      // including a CONTINUATION chunk followed by a second chunk delivering the functionCall.
      const hop1SSE = [
        `data: ${JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "Thinking about echo.", thought: true, thoughtSignature: "sig_thought_solstice" }],
              },
              finishReason: "CONTINUATION",
              continuationToken: "cont_token_1",
            },
          ],
          modelVersion: "gemini-4-argon",
        })}`,
        "",
      ].join("\n\n")
      const hop2SSE = [
        `data: ${JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: { id: "call_solstice_1", name: "echo", args: { text: "hello" } },
                    thoughtSignature: "sig_call_solstice",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
          modelVersion: "gemini-4-argon",
        })}`,
        "",
      ].join("\n\n")

      const bus = yield* Bus.Service
      const location = yield* Location.Service
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ location, title: "Solstice continuation" })
      const assistantMessageID = SessionMessage.ID.create()
      const publisher = createLLMEventPublisher(bus, {
        sessionID: created.id,
        assistantMessageID,
        agent: identity.agent,
        model: identity.model,
        providerMetadataKey: "google",
        started: 0,
      })

      let hops = 0
      const step1Request = LLM.request({
        id: "req_solstice_1",
        model: routeModel,
        system: "Be concise.",
        prompt: "Call echo.",
        tools: [tool],
        providerOptions: { thinkingConfig: { thinkingLevel: "high" } },
      })
      yield* LLMClient.stream(step1Request, {
        http: (req) => {
          hops += 1
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              req,
              new Response(hops === 1 ? hop1SSE : hop2SSE, {
                status: 200,
                headers: { "content-type": "text/event-stream" },
              }),
            ),
          )
        },
      }).pipe(
        Stream.runForEach((event) => publisher.publish(event)),
        Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer))),
      )
      expect(hops).toBe(2)

      yield* publisher.toolExecution("call_solstice_1", "echo", {
        output: { type: "text", value: "ECHOED: hello" },
        content: [{ type: "text", text: "ECHOED: hello" }],
      })

      const projectedHistory = yield* sessions.messages({ sessionID: created.id })
      expect(projectedHistory).toMatchObject([
        {
          id: assistantMessageID,
          type: "assistant",
          content: [
            {
              type: "reasoning",
              text: "Thinking about echo.",
              native: { thoughtSignature: "sig_thought_solstice" },
            },
            {
              type: "tool",
              id: "call_solstice_1",
              name: "echo",
              native: { thoughtSignature: "sig_call_solstice" },
              state: {
                status: "completed",
                input: { text: "hello" },
                content: [{ type: "text", text: "ECHOED: hello" }],
              },
            },
          ],
        },
      ])

      const step2Body = yield* Gemini.protocol.body.from(
        LLM.request({
          id: "req_solstice_2",
          model: routeModel,
          system: "Be concise.",
          messages: [Message.user("Call echo."), ...toLLMMessages(projectedHistory, identity.model, "google")],
          tools: [tool],
          providerOptions: { thinkingConfig: { thinkingLevel: "high" } },
        }),
      )
      const step2Event = yield* hooks.trigger("session", "http.request", {
        ...identity,
        request: new Request(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse",
          {
            method: "POST",
            body: JSON.stringify(step2Body),
          },
        ),
      })
      const step2Json = yield* Effect.promise(() => step2Event.request.clone().json())
      expect(step2Json).toMatchObject({
        contents: [
          { role: "user", parts: [{ text: "Call echo." }] },
          {
            role: "model",
            parts: [
              { text: "Thinking about echo.", thought: true, thoughtSignature: "sig_thought_solstice" },
              {
                functionCall: { id: "call_solstice_1", name: "echo", args: { text: "hello" } },
                thoughtSignature: "sig_call_solstice",
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_solstice_1",
                  name: "echo",
                  response: { name: "echo", content: "ECHOED: hello" },
                },
              },
            ],
          },
        ],
      })
    }),
)
