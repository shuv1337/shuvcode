import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { Credential, Plugin, Provider } from "@opencode/plugin/effect"
import { Deferred, Effect, Option, Schema, Semaphore, Stream } from "effect"
import { GoogleAntigravityOAuth } from "./oauth"
import { OauthCallbackPage } from "./page"
import { GoogleAntigravityWire } from "./wire"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
export const ID = "opencode.provider.google-antigravity"

export const oauth = {
  integrationID: GoogleAntigravityOAuth.integrationID,
  method: { id: GoogleAntigravityOAuth.methodID, type: "oauth", label: "Google AI Pro / Antigravity" },
  authorize: () =>
    Effect.gen(function* () {
      const pkce = GoogleAntigravityOAuth.pkce()
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
      const code = yield* Deferred.make<string, Error>()
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", GoogleAntigravityOAuth.redirectURI)
        if (url.pathname !== "/oauth-callback") {
          response.writeHead(404).end("Not found")
          return
        }
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
        const value = url.searchParams.get("code")
        const failure =
          url.searchParams.get("state") !== state
            ? "Invalid OAuth state"
            : (error ?? (!value ? "Missing authorization code" : undefined))
        if (failure) {
          Effect.runFork(Deferred.fail(code, new Error(failure)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(failure, { provider: "Google AI Pro" }))
          return
        }
        Effect.runFork(Deferred.succeed(code, value!))
        response
          .writeHead(200, { "Content-Type": "text/html" })
          .end(OauthCallbackPage.success({ provider: "Google AI Pro" }))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      yield* Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(GoogleAntigravityOAuth.callbackPort, "localhost", () => resume(Effect.void))
      })
      return {
        mode: "auto" as const,
        url: GoogleAntigravityOAuth.authorizeURL(pkce.challenge, state),
        instructions: "Complete authorization in your browser.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) =>
            Effect.tryPromise({
              try: async (signal) =>
                credential(
                  await GoogleAntigravityOAuth.completeAccount(
                    await GoogleAntigravityOAuth.exchange(value, pkce.verifier, undefined, signal),
                    undefined,
                    signal,
                  ),
                ),
              catch: (cause) => cause,
            }),
          ),
        ),
      }
    }),
  refresh: (value) =>
    Effect.tryPromise({
      try: (signal) => GoogleAntigravityOAuth.refreshCredential(value, undefined, signal),
      catch: (cause) =>
        new Error(`Google AI Pro token refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`),
    }),
  label: (value) => (typeof value.metadata?.email === "string" ? value.metadata.email : undefined),
} satisfies IntegrationOAuthMethodRegistration

export const GoogleAntigravityPlugin = Plugin.define({
  id: ID,
  effect: Effect.fn(function* (ctx) {
    const loading = Semaphore.makeUnsafe(1)
    const mapped = new WeakSet<Request>()
    let subscription = false
    let modelEnums = new Map(GoogleAntigravityWire.modelEnumDefaults)
    const load = Effect.fn("GoogleAntigravityPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(GoogleAntigravityOAuth.integrationID)
      // Keep login and reload subscriptions alive when stored auth expires. Inference
      // still resolves fail-closed in the request hook and the host model resolver.
      const resolved = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      subscription = GoogleAntigravityOAuth.isSubscription(resolved)
      modelEnums = new Map(GoogleAntigravityWire.modelEnumDefaults)
      // Imported access-only credentials must activate without discovery network I/O.
      if (!subscription || resolved?.type !== "oauth" || resolved.metadata?.shuvcodeAuthImport === "access-only") return
      const projectId = GoogleAntigravityOAuth.projectId(resolved.metadata)
      if (!projectId) return
      const models = yield* Effect.tryPromise({
        try: (signal) => GoogleAntigravityOAuth.fetchAvailableModels(resolved.access, projectId, undefined, signal),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed(() => undefined))
      if (models) modelEnums = GoogleAntigravityWire.modelEnumsFrom(GoogleAntigravityWire.filterGoogleModels(models))
    })
    yield* ctx.integration.transform((draft) => {
      draft.update(GoogleAntigravityOAuth.integrationID, (integration) => {
        if (!integration.name || integration.name === integration.id) integration.name = "Google"
      })
      draft.method.update(oauth)
    })
    yield* load()
    yield* ctx.provider.transform((evt) => GoogleAntigravityWire.applyProvider(evt, subscription))
    yield* ctx.model.transform((evt) => GoogleAntigravityWire.applyModels(evt, subscription))
    yield* ctx.session.hook(
      "http.request",
      (evt) =>
        Effect.gen(function* () {
          if (evt.model.providerID !== Provider.ID.google || !GoogleAntigravityWire.isGenerateURL(evt.request.url))
            return
          const connection = yield* ctx.integration.connection.active(GoogleAntigravityOAuth.integrationID)
          if (!connection) return
          // Never fall through to API-key transport when subscription resolution fails.
          const resolved = yield* ctx.integration.connection.resolve(connection).pipe(Effect.orDie)
          if (!GoogleAntigravityOAuth.isSubscription(resolved) || resolved?.type !== "oauth") return
          const projectId = GoogleAntigravityOAuth.projectId(resolved.metadata)
          if (!projectId) throw new Error("Google AI Pro is missing a Cloud Code project id")
          const text = yield* Effect.promise(() => evt.request.clone().text())
          const body = Option.getOrUndefined(decodeJson(text))
          if (body === undefined) throw new Error("Google AI Pro request body is not JSON")
          const model =
            evt.model.id || GoogleAntigravityWire.modelFromURL(evt.request.url) || GoogleAntigravityWire.defaultModelID
          const headers = new Headers(evt.request.headers)
          GoogleAntigravityWire.applyRequestHeaders(headers, resolved.access)
          evt.request = new Request(GoogleAntigravityWire.generateURL, {
            method: "POST",
            signal: evt.request.signal,
            headers,
            body: JSON.stringify(
              GoogleAntigravityWire.wrapGenerateRequest({
                body,
                projectId,
                model,
                sessionID: evt.sessionID,
                modelEnum: modelEnums.get(model) ?? modelEnums.get(GoogleAntigravityWire.catalogID(model)),
              }),
            ),
          })
          mapped.add(evt.request)
        }),
      { providerID: Provider.ID.google },
    )
    yield* ctx.session.hook(
      "http.response",
      (evt) =>
        Effect.sync(() => {
          if (evt.model.providerID !== Provider.ID.google || !mapped.has(evt.request)) return
          if (!evt.response.ok || !evt.response.body) return
          const headers = new Headers(evt.response.headers)
          headers.delete("content-length")
          headers.delete("content-encoding")
          evt.response = new Response(evt.response.body.pipeThrough(GoogleAntigravityWire.unwrapSSE()), {
            status: evt.response.status,
            statusText: evt.response.statusText,
            headers,
          })
        }),
      { providerID: Provider.ID.google },
    )
    const reload = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* ctx.event
      .subscribe()
      .pipe(
        Stream.filter(isGoogleCredentialEvent),
        Stream.runForEach(reload),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})

export default GoogleAntigravityPlugin
export { GoogleAntigravityOAuth } from "./oauth"
export { GoogleAntigravityWire } from "./wire"

function credential(account: GoogleAntigravityOAuth.CompletedAccount) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID: GoogleAntigravityOAuth.methodID,
    access: account.access,
    refresh: account.refresh,
    expires: account.expires,
    metadata: {
      projectId: account.projectId,
      ...(account.email ? { email: account.email } : {}),
      ...(account.paidTier ? { paidTier: account.paidTier } : {}),
    },
  })
}

export function isGoogleCredentialEvent(event: { readonly type: string; readonly data?: unknown }) {
  // Updated has no integration payload; every update can affect Google's active connection.
  if (event.type === "credential.updated") return true
  if (event.type !== "credential.switched") return false
  const data = event.data
  return (
    !!data &&
    typeof data === "object" &&
    "integrationID" in data &&
    data.integrationID === GoogleAntigravityOAuth.integrationID
  )
}
