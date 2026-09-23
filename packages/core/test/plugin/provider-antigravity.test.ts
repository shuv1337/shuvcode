import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
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

it.effect("Antigravity transforms real source/model editors with shipped limits, aliases, zero costs and default", () =>
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
    expect((yield* models.default())?.id).toBe(GoogleAntigravityWire.defaultModelID)
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
