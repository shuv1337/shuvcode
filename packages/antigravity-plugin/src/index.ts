import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { Credential, Plugin, Provider } from "@opencode-ai/plugin/effect"
import { Deferred, Effect, Option, Schema, Semaphore, Stream } from "effect"
import { GoogleAntigravityOAuth } from "./oauth"
import { OauthCallbackPage } from "./page"
import { GoogleAntigravityWire } from "./wire"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export const ID = "opencode.provider.google-antigravity"

const oauth = {
  integrationID: GoogleAntigravityOAuth.integrationID,
  method: {
    id: GoogleAntigravityOAuth.methodID,
    type: "oauth",
    label: "Google AI Pro / Antigravity",
  },
  authorize: () =>
    Effect.gen(function* () {
      const imported = yield* Effect.promise(() => GoogleAntigravityOAuth.importExisting()).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      if (imported) {
        const account = yield* Effect.tryPromise({
          try: () => GoogleAntigravityOAuth.completeAccount(imported),
          catch: (cause) => cause,
        }).pipe(Effect.orElseSucceed(() => undefined))
        if (account) {
          return {
            mode: "auto" as const,
            url: "https://antigravity.google/auth-success",
            instructions: "Imported an existing Antigravity login.",
            callback: Effect.succeed(credential(account)),
          }
        }
      }

      const pkce = GoogleAntigravityOAuth.pkce()
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
      const code = yield* Deferred.make<string, Error>()
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://localhost:${GoogleAntigravityOAuth.callbackPort}`)
        if (url.pathname !== "/oauth-callback") {
          response.writeHead(404).end("Not found")
          return
        }
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
        const value = url.searchParams.get("code")
        if (error) {
          Effect.runFork(Deferred.fail(code, new Error(error)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(error, { provider: "Google AI Pro" }))
          return
        }
        if (!value || url.searchParams.get("state") !== state) {
          const message = value ? "Invalid OAuth state" : "Missing authorization code"
          Effect.runFork(Deferred.fail(code, new Error(message)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(message, { provider: "Google AI Pro" }))
          return
        }
        Effect.runFork(Deferred.succeed(code, value))
        response
          .writeHead(200, { "Content-Type": "text/html" })
          .end(OauthCallbackPage.success({ provider: "Google AI Pro" }))
      })
      yield* Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(GoogleAntigravityOAuth.callbackPort, "localhost", () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      return {
        mode: "auto" as const,
        url: GoogleAntigravityOAuth.authorizeURL(pkce.challenge, state),
        instructions: "Complete authorization in your browser. This window will close automatically.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) =>
            Effect.tryPromise({
              try: async () =>
                credential(
                  await GoogleAntigravityOAuth.completeAccount(
                    await GoogleAntigravityOAuth.exchange(value, pkce.verifier),
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
      try: async () => {
        const tokens = await GoogleAntigravityOAuth.refresh(value.refresh)
        const projectId = GoogleAntigravityOAuth.projectId(value.metadata)
        return Credential.OAuth.make({
          type: "oauth",
          methodID: GoogleAntigravityOAuth.methodID,
          access: tokens.access,
          refresh: tokens.refresh,
          expires: tokens.expires,
          metadata: {
            ...value.metadata,
            ...(projectId ? { projectId } : {}),
          },
        })
      },
      catch: (cause) =>
        new Error(`Google AI Pro token refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`),
    }),
  label: (value) => (typeof value.metadata?.email === "string" ? value.metadata.email : undefined),
} satisfies IntegrationOAuthMethodRegistration

export const GoogleAntigravityPlugin = Plugin.define({
  id: ID,
  effect: Effect.fn(function* (ctx) {
    const loading = Semaphore.makeUnsafe(1)
    let subscription = false
    let modelEnums = new Map(GoogleAntigravityWire.modelEnumDefaults)

    const load = Effect.fn("GoogleAntigravityPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(GoogleAntigravityOAuth.integrationID)
      const resolved = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      subscription = GoogleAntigravityOAuth.isSubscription(resolved)
      if (!subscription || resolved?.type !== "oauth") return
      const projectId = GoogleAntigravityOAuth.projectId(resolved.metadata)
      if (!projectId) return
      const models = yield* Effect.tryPromise({
        try: () => GoogleAntigravityOAuth.fetchAvailableModels(resolved.access, projectId),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed(() => undefined))
      if (!models) return
      modelEnums = GoogleAntigravityWire.modelEnumsFrom(GoogleAntigravityWire.filterGoogleModels(models))
    })

    yield* ctx.integration.transform((draft) => {
      draft.update(GoogleAntigravityOAuth.integrationID, (integration) => {
        if (!integration.name || integration.name === integration.id) integration.name = "Google"
      })
      draft.method.update(oauth)
    })
    yield* load()
    yield* ctx.catalog.transform((evt) => {
      GoogleAntigravityWire.applyCatalog(evt, subscription)
    })

    yield* ctx.session.hook(
      "http.request",
      (evt) =>
        Effect.gen(function* () {
          if (evt.model.providerID !== Provider.ID.google) return
          const connection = yield* ctx.integration.connection.active(GoogleAntigravityOAuth.integrationID)
          if (!connection) return
          // Resolving refreshes the OAuth token. Swallowing that failure would send an unshaped,
          // unauthenticated request to the wrong endpoint instead of reporting that the
          // subscription needs to be reconnected.
          const resolved = yield* ctx.integration.connection.resolve(connection).pipe(Effect.orDie)
          if (!GoogleAntigravityOAuth.isSubscription(resolved) || resolved?.type !== "oauth") return
          if (!GoogleAntigravityWire.isGenerateURL(evt.request.url)) return
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
        }),
      { providerID: Provider.ID.google },
    )

    yield* ctx.session.hook(
      "http.response",
      (evt) =>
        Effect.sync(() => {
          if (evt.model.providerID !== Provider.ID.google) return
          if (!evt.request.url.includes("v1internal:streamGenerateContent")) return
          if (!evt.response.body) return
          evt.response = new Response(evt.response.body.pipeThrough(GoogleAntigravityWire.unwrapSSE()), {
            status: evt.response.status,
            statusText: evt.response.statusText,
            headers: evt.response.headers,
          })
        }),
      { providerID: Provider.ID.google },
    )

    const reload = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* ctx.event.subscribe().pipe(
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

function isGoogleCredentialEvent(event: { readonly type: string; readonly data?: unknown }) {
  if (event.type === "credential.updated") return true
  if (event.type !== "credential.switched") return false
  const data = event.data
  if (!data || typeof data !== "object") return false
  return "integrationID" in data && data.integrationID === GoogleAntigravityOAuth.integrationID
}
