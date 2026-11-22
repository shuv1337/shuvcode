import { expect } from "bun:test"
import { isRetryable } from "@opencode/ai"
import { RequestExecutor } from "@opencode/ai/route"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { GoogleSolsticeOAuth, GoogleSolsticeWire, NousPortalOAuth, createPlugin } from "@shuvcode/antigravity-plugin"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const portal = "http://127.0.0.1:9933"
const identity = {
  sessionID: Session.ID.make("ses_solstice_error"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-4-argon") }),
  kind: "primary" as const,
}

for (const scenario of [
  {
    name: "429 QUOTA_EXHAUSTED is non-retryable QuotaExceeded",
    status: 429,
    body: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Per-user quota exhausted.",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }],
      },
    }),
    tag: "QuotaExceeded",
    retryable: false,
  },
  {
    name: "402 usage limit is non-retryable QuotaExceeded",
    status: 402,
    body: JSON.stringify({
      error: {
        code: 402,
        status: "FAILED_PRECONDITION",
        message: "Solstice usage limit reached.",
      },
    }),
    tag: "QuotaExceeded",
    retryable: false,
  },
  {
    name: "transient 429 RATE_LIMIT_EXCEEDED stays retryable RateLimit",
    status: 429,
    body: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Too many requests; please retry shortly.",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" }],
      },
    }),
    tag: "RateLimit",
    retryable: true,
  },
  {
    name: "401 auth rejection classifies as non-retryable Authentication",
    status: 401,
    body: JSON.stringify({
      error: {
        code: 401,
        status: "UNAUTHENTICATED",
        message: "Request had invalid authentication credentials.",
      },
    }),
    tag: "Authentication",
    retryable: false,
  },
  {
    name: "403 permission rejection classifies as non-retryable Authentication",
    status: 403,
    body: JSON.stringify({
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        message: "The caller does not have permission.",
      },
    }),
    tag: "Authentication",
    retryable: false,
  },
] as const) {
  it.effect(`native Google Solstice error: ${scenario.name}`, () =>
    Effect.sync(() => {
      const url = GoogleSolsticeWire.rewriteGenerateURL(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse",
      )!
      const error = RequestExecutor.httpFailure({
        message: scenario.body,
        url,
        status: scenario.status,
        responseHeaders: { "content-type": "application/json" },
        responseBody: scenario.body,
      })
      expect(error.reason._tag).toBe(scenario.tag)
      expect(isRetryable(error)).toBe(scenario.retryable)
      expect(error.reason.http?.status).toBe(scenario.status)
    }),
  )
}

it.effect(
  "Solstice broker dead-grant vs Nous-401 failures surface fail-closed in http.request with isolated needs_auth",
  () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integration = yield* Integration.Service
      const hooks = yield* PluginHooks.Service
      const plugin = yield* Plugin.Service
      let brokerMode: "nous401" | "dead" = "nous401"

      const testPlugin = createPlugin({
        portalURL: portal,
        now: () => Date.now(),
        fetch: async (url) => {
          if (url === `${portal}/api/oauth/gemini-auth/refresh`) {
            if (brokerMode === "nous401") {
              return Response.json({ error: "invalid_token" }, { status: 401 })
            }
            return Response.json({ error: "unauthorized_client" }, { status: 400 })
          }
          throw new Error(`Unexpected URL: ${url}`)
        },
      })

      yield* credentials.create({
        integrationID: NousPortalOAuth.integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: NousPortalOAuth.methodID,
          access: "nous-access",
          refresh: "nous-refresh",
          expires: Date.now() + 3_600_000,
          metadata: { portalBaseURL: portal },
        }),
      })
      yield* credentials.create({
        integrationID: GoogleSolsticeOAuth.integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: GoogleSolsticeOAuth.methodID,
          access: "fixture-stale",
          refresh: "1//solstice-refresh-err",
          expires: 1,
          metadata: { portalBaseURL: portal },
        }),
      })
      const host = yield* PluginHost.make(plugin, "test")
      yield* testPlugin.effect(host)

      const statusOf = (id: Integration.ID) =>
        integration.get(id).pipe(Effect.map((info) => info?.connections[0]?.status))

      const request = () =>
        new Request(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse",
          { method: "POST", body: '{"contents":[]}' },
        )

      const nousFail = yield* Effect.exit(hooks.trigger("session", "http.request", { ...identity, request: request() }))
      expect(nousFail._tag).toBe("Failure")
      expect((yield* statusOf(NousPortalOAuth.integrationID))?.status).toBe("needs_auth")
      expect(yield* statusOf(GoogleSolsticeOAuth.integrationID)).toBeUndefined()

      brokerMode = "dead"
      const deadFail = yield* Effect.exit(hooks.trigger("session", "http.request", { ...identity, request: request() }))
      expect(deadFail._tag).toBe("Failure")
      expect((yield* statusOf(GoogleSolsticeOAuth.integrationID))?.status).toBe("needs_auth")
    }),
)
