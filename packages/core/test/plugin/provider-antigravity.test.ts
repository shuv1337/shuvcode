import { expect, spyOn } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClientResponse } from "effect/http"
import { LLM, Message, ToolDefinition } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Gemini } from "@opencode/ai/protocols"
import { Agent } from "@opencode/schema/agent"
import { Bus } from "@opencode/core/bus"
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
import { GoogleAntigravityPlugin, GoogleAntigravityOAuth, GoogleAntigravityWire } from "@shuvcode/antigravity-plugin"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const identity = {
  sessionID: Session.ID.make("ses_antigravity"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-3.8-flash-high") }),
  kind: "primary" as const,
}
const imported = Credential.OAuth.make({
  type: "oauth",
  methodID: GoogleAntigravityOAuth.methodID,
  access: "fixture-access",
  refresh: "",
  expires: Date.now() + 3_600_000,
  metadata: { projectId: "fixture-project", shuvcodeAuthImport: "access-only" },
})
const normalOAuth = Credential.OAuth.make({
  type: "oauth",
  methodID: GoogleAntigravityOAuth.methodID,
  access: "fixture-access",
  refresh: "1//fixture-refresh",
  expires: Date.now() + 3_600_000,
  metadata: { projectId: "fixture-project" },
})
const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GoogleAntigravityPlugin.effect(host)
})
const source = Effect.fn(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(Provider.ID.google, (draft) => {
      draft.package = "@opencode/ai/providers/google"
    })
    editor.models.update(Provider.ID.google, Model.ID.make("gemini-3.8-flash-low"), (draft) => {
      draft.limit = { context: 123_456, output: 4567 }
    })
    editor.models.update(Provider.ID.google, Model.ID.make("gemini-old"), () => {})
  })
})

it.effect("Antigravity transforms real source/model editors with shipped limits, aliases, and zero costs", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const models = yield* Model.Service
    yield* source()
    yield* credentials.create({ integrationID: Integration.ID.make("google"), value: imported })
    yield* addPlugin()
    for (const item of GoogleAntigravityWire.shippedModels) {
      const model = yield* models.get(Provider.ID.google, Model.ID.make(item.id))
      expect(model?.enabled).toBe(true)
      expect(model?.cost).toEqual([])
      expect(model?.modelID).toBe(Model.ID.make(item.apiID ?? item.id))
      expect(model?.limit).toEqual(
        item.id === "gemini-3.8-flash-low"
          ? { context: 123_456, output: 4567 }
          : { context: 1_048_576, output: 65_536 },
      )
    }
    expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-old")))?.enabled).toBe(false)
  }),
)

it.effect("Antigravity suppresses all shipped Argon variants when discovery returns gemini-4-argon-disabled", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const models = yield* Model.Service
    yield* source()
    yield* credentials.create({ integrationID: Integration.ID.make("google"), value: normalOAuth })
    const fetchModels = spyOn(GoogleAntigravityOAuth, "fetchAvailableModels").mockResolvedValue(
      GoogleAntigravityOAuth.parseCatalogModels({
        models: [
          {
            id: "gemini-4-argon-disabled",
            displayName: "Gemini 4 Argon",
            model: "MODEL_PLACEHOLDER_M421",
            modelProvider: "MODEL_PROVIDER_GOOGLE",
            disabled: true,
            recommended: true,
          },
          {
            id: "gemini-3.8-flash-high",
            displayName: "Gemini 3.8 Flash (High)",
            model: "MODEL_PLACEHOLDER_M318",
            modelProvider: "MODEL_PROVIDER_GOOGLE",
            recommended: true,
          },
        ],
      }),
    )
    yield* addPlugin().pipe(Effect.ensuring(Effect.sync(() => fetchModels.mockRestore())))

    for (const argonID of ["gemini-4-argon-high", "gemini-4-argon-medium", "gemini-4-argon-low"] as const) {
      expect((yield* models.get(Provider.ID.google, Model.ID.make(argonID)))?.enabled).toBe(false)
    }
    expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-3.8-flash-high")))?.enabled).toBe(true)
    const available = (yield* models.available())
      .filter((model) => model.providerID === Provider.ID.google)
      .map((model) => model.id)
    expect(available).not.toContain(Model.ID.make("gemini-4-argon-high"))
    expect(available).not.toContain(Model.ID.make("gemini-4-argon-medium"))
    expect(available).not.toContain(Model.ID.make("gemini-4-argon-low"))
    expect(available).toContain(Model.ID.make("gemini-3.8-flash-high"))
  }),
)

it.effect(
  "Antigravity keeps disabled shipped model IDs unavailable in the host model registry while preserving fallback on discovery failure",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      yield* source()
      yield* credentials.create({ integrationID: Integration.ID.make("google"), value: normalOAuth })
      let failDiscovery = false
      const fetchModels = spyOn(GoogleAntigravityOAuth, "fetchAvailableModels").mockImplementation(async () => {
        if (failDiscovery) throw new Error("discovery unavailable")
        return GoogleAntigravityOAuth.parseCatalogModels({
          models: [
            {
              id: "gemini-4-argon-high",
              model: "MODEL_PLACEHOLDER_M417",
              modelProvider: "MODEL_PROVIDER_GOOGLE",
              disabled: true,
            },
            {
              id: "gemini-3.8-flash-low",
              model: "MODEL_PLACEHOLDER_M320",
              modelProvider: "MODEL_PROVIDER_GOOGLE",
              disabled: true,
            },
            {
              id: "gemini-pro-agent",
              model: "MODEL_PLACEHOLDER_M317",
              modelProvider: "MODEL_PROVIDER_GOOGLE",
              disabled: true,
            },
            {
              id: "gemini-4-argon-medium",
              model: "MODEL_PLACEHOLDER_M418",
              modelProvider: "MODEL_PROVIDER_GOOGLE",
              recommended: true,
            },
          ],
        })
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => fetchModels.mockRestore()))
      yield* addPlugin()

      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-4-argon-high")))?.enabled).toBe(false)
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-3.8-flash-low")))?.enabled).toBe(false)
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-pro-agent")))?.enabled).toBe(false)
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-3.1-pro-high")))?.enabled).toBe(false)
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-4-argon-medium")))?.enabled).toBe(true)
      expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-4-argon-low")))?.enabled).toBe(true)

      const available = (yield* models.available())
        .filter((model) => model.providerID === Provider.ID.google)
        .map((model) => model.id)
      expect(available).not.toContain(Model.ID.make("gemini-4-argon-high"))
      expect(available).not.toContain(Model.ID.make("gemini-3.8-flash-low"))
      expect(available).not.toContain(Model.ID.make("gemini-pro-agent"))
      expect(available).not.toContain(Model.ID.make("gemini-3.1-pro-high"))
      expect(available).toContain(Model.ID.make("gemini-4-argon-medium"))

      failDiscovery = true
      yield* credentials.create({ integrationID: Integration.ID.make("google"), value: normalOAuth })
      yield* providers.reload()
      yield* models.reload()
      for (const item of GoogleAntigravityWire.shippedModels) {
        expect((yield* models.get(Provider.ID.google, Model.ID.make(item.id)))?.enabled).toBe(true)
      }
    }),
)

it.effect("Antigravity keeps API key catalog and HTTP requests unchanged", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const models = yield* Model.Service
    const hooks = yield* PluginHooks.Service
    yield* source()
    yield* credentials.create({
      integrationID: Integration.ID.make("google"),
      value: Credential.Key.make({ type: "key", key: "fixture-key" }),
    })
    yield* addPlugin()
    expect((yield* models.get(Provider.ID.google, Model.ID.make("gemini-old")))?.enabled).toBe(true)
    const request = new Request(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-old:streamGenerateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": "fixture-key" },
        body: "{}",
      },
    )
    expect((yield* hooks.trigger("session", "http.request", { ...identity, request })).request).toBe(request)
  }),
)

it.effect(
  "Antigravity resolves fresh auth per request, preserves abort, and unwraps only mapped successful responses",
  () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const hooks = yield* PluginHooks.Service
      let resolutions = 0
      yield* GoogleAntigravityPlugin.effect({
        ...host,
        integration: {
          ...host.integration,
          connection: {
            active: () => Effect.succeed({ type: "credential", id: "fixture", label: "fixture", method: "oauth" }),
            resolve: () => Effect.sync(() => ({ ...imported, access: `fixture-${++resolutions}` })),
            status: () => Effect.void,
          },
        },
      })
      expect(resolutions).toBe(1)
      const abort = new AbortController()
      const original = new Request(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-high:streamGenerateContent",
        {
          method: "POST",
          headers: { "x-goog-api-key": "remove" },
          body: '{"contents":[]}',
          signal: abort.signal,
        },
      )
      const event = yield* hooks.trigger("session", "http.request", { ...identity, request: original })
      expect(event.request.headers.get("authorization")).toBe("Bearer fixture-2")
      expect(event.request.headers.has("x-goog-api-key")).toBe(false)
      expect(event.request.headers.get("user-agent")).toBe(GoogleAntigravityOAuth.userAgent())
      expect(event.request.url).toBe(GoogleAntigravityWire.generateURL)
      expect(yield* Effect.promise(() => event.request.clone().json())).toMatchObject({
        project: "fixture-project",
        model: "gemini-3.8-flash-high",
      })
      abort.abort()
      expect(event.request.signal.aborted).toBe(true)
      const text = 'data: {"response":{"candidates":[]}}\n\n'
      const unrelated = new Response(text)
      expect(
        (yield* hooks.trigger("session", "http.response", {
          ...identity,
          request: new Request(event.request.url),
          response: unrelated,
        })).response,
      ).toBe(unrelated)
      const error = new Response(text, { status: 429 })
      expect(
        (yield* hooks.trigger("session", "http.response", { ...identity, request: event.request, response: error }))
          .response,
      ).toBe(error)
      const response = yield* hooks.trigger("session", "http.response", {
        ...identity,
        request: event.request,
        response: new Response(text, { headers: { "content-length": "100" } }),
      })
      expect(response.response.headers.has("content-length")).toBe(false)
      expect(yield* Effect.promise(() => response.response.text())).toBe('data: {"candidates":[]}\n\n')
    }),
)

it.effect("expired imported auth retains the login method while inference remains fail-closed", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const integration = yield* Integration.Service
    const hooks = yield* PluginHooks.Service
    yield* source()
    yield* credentials.create({
      integrationID: Integration.ID.make("google"),
      value: Credential.OAuth.make({ ...imported, expires: 0 }),
    })
    yield* addPlugin()
    expect((yield* integration.get(Integration.ID.make("google")))?.methods).toContainEqual(
      expect.objectContaining({ id: "google-ai-pro", type: "oauth" }),
    )
    const result = yield* Effect.exit(
      hooks.trigger("session", "http.request", {
        ...identity,
        request: new Request("https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent", {
          method: "POST",
          body: "{}",
        }),
      }),
    )
    expect(result._tag).toBe("Failure")
  }),
)

it.effect("Antigravity fails resolution and invalid request metadata without API key fallback", () =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const hooks = yield* PluginHooks.Service
    let mode = "valid"
    yield* GoogleAntigravityPlugin.effect({
      ...host,
      integration: {
        ...host.integration,
        connection: {
          active: () => Effect.succeed({ type: "credential", id: "fixture", label: "fixture", method: "oauth" }),
          resolve: () =>
            mode === "error"
              ? Effect.fail(new Error("refresh refused"))
              : Effect.succeed(mode === "missing" ? { ...imported, metadata: {} } : imported),
          status: () => Effect.void,
        },
      },
    })
    const request = (body = "{}") =>
      new Request("https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent", {
        method: "POST",
        body,
      })
    mode = "error"
    expect(
      (yield* Effect.exit(hooks.trigger("session", "http.request", { ...identity, request: request() })))._tag,
    ).toBe("Failure")
    mode = "missing"
    expect(
      (yield* Effect.exit(hooks.trigger("session", "http.request", { ...identity, request: request() })))._tag,
    ).toBe("Failure")
    mode = "valid"
    expect(
      (yield* Effect.exit(hooks.trigger("session", "http.request", { ...identity, request: request("invalid") })))._tag,
    ).toBe("Failure")
  }),
)

it.effect(
  "Antigravity rewrites gemini-4-argon-high tool-call and continuation requests with model_enum and thoughtSignature",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const hooks = yield* PluginHooks.Service
      yield* source()
      yield* credentials.create({ integrationID: Integration.ID.make("google"), value: imported })
      yield* addPlugin()

      const argonIdentity = {
        ...identity,
        model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-4-argon-high") }),
      }
      const routeModel = Gemini.route.model({ id: "gemini-4-argon-high" })
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
          id: "req_argon_1",
          model: routeModel,
          system: "Be concise.",
          prompt: "Call echo.",
          tools: [tool],
          providerOptions: { thinkingConfig: { thinkingLevel: "high" } },
        }),
      )
      const step1Event = yield* hooks.trigger("session", "http.request", {
        ...argonIdentity,
        request: new Request(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon-high:streamGenerateContent?alt=sse",
          {
            method: "POST",
            body: JSON.stringify(step1Body),
          },
        ),
      })
      expect(step1Event.request.url).toBe(GoogleAntigravityWire.generateURL)
      const step1Envelope = yield* Effect.promise(() => step1Event.request.clone().json())
      expect(step1Envelope).toMatchObject({
        project: "fixture-project",
        model: "gemini-4-argon-high",
        request: {
          systemInstruction: { role: "user", parts: [{ text: "Be concise." }] },
          toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
          generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
          labels: {
            model_enum: "MODEL_PLACEHOLDER_M417",
            used_claude: "false",
            used_non_gemini_model: "false",
          },
        },
      })

      const step1SSE = [
        `data: ${JSON.stringify({
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "Thinking about calling echo.", thought: true, thoughtSignature: "sig_thought_argon" },
                    {
                      functionCall: { id: "call_argon_1", name: "echo", args: { text: "hello" } },
                      thoughtSignature: "sig_call_argon",
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            modelVersion: "gemini-4-argon-high",
          },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n\n")
      const step1Response = yield* hooks.trigger("session", "http.response", {
        ...argonIdentity,
        request: step1Event.request,
        response: new Response(step1SSE, { status: 200, headers: { "content-type": "text/event-stream" } }),
      })
      const unwrappedStep1 = yield* Effect.promise(() => step1Response.response.clone().text())
      expect(unwrappedStep1).toContain('"functionCall":{"id":"call_argon_1","name":"echo","args":{"text":"hello"}}')
      expect(unwrappedStep1).toContain('"thoughtSignature":"sig_call_argon"')

      const bus = yield* Bus.Service
      const location = yield* Location.Service
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ location, title: "Argon continuation" })
      const assistantMessageID = SessionMessage.ID.create()
      const publisher = createLLMEventPublisher(bus, {
        sessionID: created.id,
        assistantMessageID,
        agent: argonIdentity.agent,
        model: argonIdentity.model,
        providerMetadataKey: "google",
        started: 0,
      })
      const step1Request = LLM.request({
        id: "req_argon_1",
        model: routeModel,
        system: "Be concise.",
        prompt: "Call echo.",
        tools: [tool],
        providerOptions: { thinkingConfig: { thinkingLevel: "high" } },
      })
      yield* LLMClient.stream(step1Request, {
        http: (req) => Effect.succeed(HttpClientResponse.fromWeb(req, step1Response.response)),
      }).pipe(
        Stream.runForEach((event) => publisher.publish(event)),
        Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer))),
      )
      yield* publisher.toolExecution("call_argon_1", "echo", {
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
              text: "Thinking about calling echo.",
              native: { thoughtSignature: "sig_thought_argon" },
            },
            {
              type: "tool",
              id: "call_argon_1",
              name: "echo",
              native: { thoughtSignature: "sig_call_argon" },
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
          id: "req_argon_2",
          model: routeModel,
          system: "Be concise.",
          messages: [Message.user("Call echo."), ...toLLMMessages(projectedHistory, argonIdentity.model, "google")],
          tools: [tool],
          providerOptions: { thinkingConfig: { thinkingLevel: "high" } },
        }),
      )
      const step2Event = yield* hooks.trigger("session", "http.request", {
        ...argonIdentity,
        request: new Request(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon-high:streamGenerateContent?alt=sse",
          {
            method: "POST",
            body: JSON.stringify(step2Body),
          },
        ),
      })
      const step2Envelope = yield* Effect.promise(() => step2Event.request.clone().json())
      expect(step2Envelope).toMatchObject({
        project: "fixture-project",
        model: "gemini-4-argon-high",
        request: {
          labels: { model_enum: "MODEL_PLACEHOLDER_M417" },
          contents: [
            { role: "user", parts: [{ text: "Call echo." }] },
            {
              role: "model",
              parts: [
                { text: "Thinking about calling echo.", thought: true, thoughtSignature: "sig_thought_argon" },
                {
                  functionCall: { id: "call_argon_1", name: "echo", args: { text: "hello" } },
                  thoughtSignature: "sig_call_argon",
                },
              ],
            },
            {
              role: "user",
              parts: [
                {
                  functionResponse: {
                    id: "call_argon_1",
                    name: "echo",
                    response: { name: "echo", content: "ECHOED: hello" },
                  },
                },
              ],
            },
          ],
        },
      })
    }),
)
