import type { Server } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import type { ConnectionInfo } from "@opencode/client"
import { Credential, Plugin, Provider } from "@opencode/plugin/effect"
import { Deferred, Effect, Option, Schema, type Scope, Semaphore, Stream } from "effect"
import { NousPortalOAuth } from "./nous"
import { GoogleSolsticeOAuth } from "./oauth"
import { OauthCallbackPage } from "./page"
import { type ReceivedCallback, submitRedirect } from "./redirect"
import {
  type Fetch,
  resolvePortalBaseURL,
  sanitizeErrorCode,
  timingSafeEqualString,
  validateHttpsOrLoopback,
} from "./url"
import { GoogleSolsticeWire } from "./wire"

export const ID = "shuvcode.provider.google-solstice"

const DEAD_GRANTS_KEY = "solstice-dead-grants"
const LEGACY_MIGRATION_MESSAGE =
  "Google AI Pro (Antigravity) was replaced by Google (Solstice). Sign in to Nous Portal, then reconnect Google in /connect."

export type PluginOptions = {
  readonly fetch?: Fetch
  readonly now?: () => number
  readonly portalURL?: string
}

const DeadGrantEntry = Schema.Struct({
  fingerprint: Schema.String,
  error: Schema.Literals(["invalid_grant", "unauthorized_client"]),
})
const DeadGrantMap = Schema.Record(Schema.String, DeadGrantEntry)
const decodeDeadGrants = Schema.decodeUnknownOption(DeadGrantMap)

function listen(server: Server) {
  return Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      const address = server.address()
      if (!address || typeof address === "string") return resume(Effect.fail(new Error("Missing OAuth callback port")))
      resume(Effect.succeed(address.port))
    })
  })
}

function unwrapCause(value: unknown, predicate: (item: unknown) => boolean): unknown {
  let current: unknown = value
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth++) {
    if (predicate(current)) return current
    if (typeof current === "object" && "cause" in current) {
      current = current.cause
      continue
    }
    break
  }
  return undefined
}

const isNousTransient = (value: unknown): value is NousPortalOAuth.NousTransientError =>
  value instanceof NousPortalOAuth.NousTransientError

const isNousDead = (value: unknown): value is NousPortalOAuth.NousGrantDeadError =>
  value instanceof NousPortalOAuth.NousGrantDeadError

export function createPlugin(options?: PluginOptions): Plugin.Plugin<Scope.Scope> {
  if (options?.portalURL !== undefined && options.portalURL.trim().length > 0) {
    validateHttpsOrLoopback(options.portalURL, "portalURL option")
  }
  const runtimeOptions = {
    ...(options?.fetch ? { fetch: options.fetch } : {}),
    ...(options?.now ? { now: options.now } : {}),
  }
  const resolvePortal = () => resolvePortalBaseURL(options?.portalURL)

  return Plugin.define({
    id: ID,
    effect: Effect.fn(function* (ctx) {
      const loading = Semaphore.makeUnsafe(1)
      const knownLegacy = new Set<string>()
      let subscription = false
      let nousFailedConnectionID: string | undefined

      const readDeadGrants = Effect.fn("GoogleSolsticePlugin.readDeadGrants")(function* () {
        const stored = yield* ctx.storage.get(DEAD_GRANTS_KEY)
        return Option.getOrElse(decodeDeadGrants(stored), () => ({}) as Record<string, typeof DeadGrantEntry.Type>)
      })

      const recordDeadGrant = Effect.fn("GoogleSolsticePlugin.recordDeadGrant")(function* (
        credentialID: string,
        fingerprint: string,
        error: GoogleSolsticeOAuth.DeadGrantCode,
      ) {
        const current = yield* readDeadGrants()
        yield* ctx.storage.set(DEAD_GRANTS_KEY, {
          ...current,
          [credentialID]: { fingerprint, error },
        })
      })

      const clearDeadGrant = Effect.fn("GoogleSolsticePlugin.clearDeadGrant")(function* (credentialID: string) {
        const current = yield* readDeadGrants()
        if (!(credentialID in current)) return
        const next = Object.fromEntries(Object.entries(current).filter(([id]) => id !== credentialID))
        yield* ctx.storage.set(DEAD_GRANTS_KEY, next)
      })

      const clearDeadGrantIfRotated = Effect.fn("GoogleSolsticePlugin.clearDeadGrantIfRotated")(function* (
        credentialID: string,
        credential: Credential.OAuth,
      ) {
        const current = yield* readDeadGrants()
        const entry = current[credentialID]
        if (!entry) return
        if (!credential.refresh.trim()) return
        if (GoogleSolsticeOAuth.refreshFingerprint(credential.refresh) !== entry.fingerprint) {
          yield* clearDeadGrant(credentialID)
        }
      })

      const markNousNeedsAuth = Effect.fn("GoogleSolsticePlugin.markNousNeedsAuth")(function* (
        connection: ConnectionInfo,
        message: string,
      ) {
        nousFailedConnectionID = connection.type === "credential" ? connection.id : undefined
        yield* ctx.integration.connection.status({
          integrationID: NousPortalOAuth.integrationID,
          connection,
          status: { status: "needs_auth", message },
        })
      })

      const clearNousNeedsAuth = Effect.fn("GoogleSolsticePlugin.clearNousNeedsAuth")(function* (
        connection: ConnectionInfo,
      ) {
        nousFailedConnectionID = undefined
        yield* ctx.integration.connection.status({
          integrationID: NousPortalOAuth.integrationID,
          connection,
          status: undefined,
        })
      })

      const resolveNousAccessToken = Effect.fn("GoogleSolsticePlugin.resolveNousAccessToken")(function* () {
        const nousConnection = yield* ctx.integration.connection.active(NousPortalOAuth.integrationID)
        if (!nousConnection || nousConnection.type !== "credential" || nousConnection.method !== "oauth") {
          return yield* Effect.fail(
            new GoogleSolsticeOAuth.NousAuthRequiredError(
              "Sign in to Nous Portal first in /connect before connecting or refreshing Google (Solstice).",
            ),
          )
        }
        const resolved = yield* ctx.integration.connection.resolve(nousConnection).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((cause) => Effect.succeed({ ok: false as const, cause })),
        )
        if (!resolved.ok) {
          const transient = unwrapCause(resolved.cause, isNousTransient)
          if (transient) return yield* Effect.fail(transient)
          const dead = unwrapCause(resolved.cause, isNousDead)
          const message =
            dead instanceof Error ? dead.message : "Nous Portal sign-in expired. Sign in to Nous Portal again."
          yield* markNousNeedsAuth(nousConnection, message)
          return yield* Effect.fail(new GoogleSolsticeOAuth.NousAuthRequiredError(message))
        }
        if (!resolved.value || resolved.value.type !== "oauth" || !resolved.value.access.trim()) {
          const message = "Nous Portal sign-in is required. Sign in to Nous Portal in /connect."
          yield* markNousNeedsAuth(nousConnection, message)
          return yield* Effect.fail(new GoogleSolsticeOAuth.NousAuthRequiredError(message))
        }
        const metadataPortal =
          typeof resolved.value.metadata?.portalBaseURL === "string" &&
          resolved.value.metadata.portalBaseURL.trim().length > 0
            ? resolved.value.metadata.portalBaseURL
            : undefined
        const portalBaseURL = yield* Effect.try({
          try: () => (metadataPortal ? validateHttpsOrLoopback(metadataPortal, "Nous Portal URL") : resolvePortal()),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })
        return {
          access: resolved.value.access,
          connection: nousConnection,
          portalBaseURL,
        }
      })

      const nousOAuth: IntegrationOAuthMethodRegistration = {
        integrationID: NousPortalOAuth.integrationID,
        method: {
          id: NousPortalOAuth.methodID,
          type: "oauth",
          label: "Sign in with Nous Portal",
        },
        authorize: () =>
          Effect.gen(function* () {
            const portalBaseURL = yield* Effect.try({
              try: resolvePortal,
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            })
            const device = yield* Effect.tryPromise({
              try: (signal) => NousPortalOAuth.requestDeviceCode(portalBaseURL, runtimeOptions, signal),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            })
            return {
              mode: "auto" as const,
              url: device.verificationURIComplete ?? device.verificationURI,
              instructions: `Open the URL and confirm code: ${device.userCode}`,
              expiresAt: device.expiresAt,
              callback: NousPortalOAuth.pollDeviceToken(portalBaseURL, device, runtimeOptions),
            }
          }),
        refresh: (value) =>
          Effect.gen(function* () {
            const portalURL = yield* Effect.try({
              try: resolvePortal,
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            })
            const refreshed = yield* Effect.tryPromise({
              try: (signal) => NousPortalOAuth.refreshCredential(value, { ...runtimeOptions, portalURL }, signal),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            }).pipe(
              Effect.tapError((cause) =>
                Effect.gen(function* () {
                  if (!(cause instanceof NousPortalOAuth.NousGrantDeadError)) return
                  const connection = yield* ctx.integration.connection.active(NousPortalOAuth.integrationID)
                  if (!connection) return
                  yield* markNousNeedsAuth(connection, cause.message)
                }),
              ),
            )
            const connection = yield* ctx.integration.connection.active(NousPortalOAuth.integrationID)
            if (connection) yield* clearNousNeedsAuth(connection)
            return refreshed
          }),
      }

      const solsticeOAuth: IntegrationOAuthMethodRegistration = {
        integrationID: GoogleSolsticeOAuth.integrationID,
        method: {
          id: GoogleSolsticeOAuth.methodID,
          type: "oauth",
          label: "Google (Solstice)",
        },
        authorize: () =>
          Effect.gen(function* () {
            const nous = yield* resolveNousAccessToken()
            const config = yield* Effect.tryPromise({
              try: (signal) =>
                GoogleSolsticeOAuth.discoverClient(nous.portalBaseURL, nous.access, runtimeOptions, signal),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            }).pipe(
              Effect.tapError((cause) =>
                cause instanceof GoogleSolsticeOAuth.NousAuthRequiredError
                  ? markNousNeedsAuth(nous.connection, cause.message)
                  : Effect.void,
              ),
            )
            const pkce = GoogleSolsticeOAuth.pkce()
            const state = GoogleSolsticeOAuth.randomState()
            const received = yield* Deferred.make<ReceivedCallback, Error>()
            // Lazy import so non-Node runtimes never evaluate node:http on module load.
            const { createServer } = yield* Effect.promise(() => import("node:http"))
            const server = createServer((request, response) => {
              const url = new URL(request.url ?? "/", "http://127.0.0.1")
              if (url.pathname !== GoogleSolsticeOAuth.callbackPath) {
                response.writeHead(404).end("Not found")
                return
              }
              if (!timingSafeEqualString(state, url.searchParams.get("state"))) {
                response
                  .writeHead(400, { "Content-Type": "text/html" })
                  .end(OauthCallbackPage.error("Invalid OAuth state", { provider: "Google (Solstice)" }))
                return
              }
              const rawError = url.searchParams.get("error")
              if (rawError !== null && rawError.trim().length > 0) {
                const code = sanitizeErrorCode(rawError)
                const message = code ? `Google authorization failed (${code})` : "Google authorization failed"
                Effect.runFork(Deferred.fail(received, new Error(message)))
                response
                  .writeHead(400, { "Content-Type": "text/html" })
                  .end(OauthCallbackPage.error(message, { provider: "Google (Solstice)" }))
                return
              }
              const code = url.searchParams.get("code")?.trim()
              if (!code) {
                response
                  .writeHead(400, { "Content-Type": "text/html" })
                  .end(OauthCallbackPage.error("Missing authorization code", { provider: "Google (Solstice)" }))
                return
              }
              if (!Effect.runSync(Deferred.succeed(received, { code, response }))) {
                response.writeHead(409).end("OAuth callback already received")
              }
            })
            const port = yield* listen(server)
            yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
            const redirectURI = `http://127.0.0.1:${port}${GoogleSolsticeOAuth.callbackPath}`
            return {
              mode: "auto" as const,
              url: GoogleSolsticeOAuth.buildAuthorizeURL(config, {
                redirectURI,
                challenge: pkce.challenge,
                state,
              }),
              instructions:
                "Complete Google sign-in in your browser. If the browser cannot reach this machine, paste the final redirect URL.",
              callback: Effect.gen(function* () {
                const result = yield* Deferred.await(received)
                const respond = (error?: string) =>
                  Effect.sync(() => {
                    if (!result.response || result.response.writableEnded) return
                    result.response
                      .writeHead(error ? 400 : 200, { "Content-Type": "text/html" })
                      .end(
                        error
                          ? OauthCallbackPage.error(error, { provider: "Google (Solstice)" })
                          : OauthCallbackPage.success({ provider: "Google (Solstice)" }),
                      )
                  })
                return yield* Effect.tryPromise({
                  try: (signal) =>
                    GoogleSolsticeOAuth.exchange(
                      nous.portalBaseURL,
                      nous.access,
                      { code: result.code, verifier: pkce.verifier, redirectURI },
                      runtimeOptions,
                      signal,
                    ),
                  catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
                }).pipe(
                  Effect.tapError((cause) =>
                    cause instanceof GoogleSolsticeOAuth.NousAuthRequiredError
                      ? markNousNeedsAuth(nous.connection, cause.message)
                      : Effect.void,
                  ),
                  Effect.map((tokens) =>
                    Credential.OAuth.make({
                      type: "oauth",
                      methodID: GoogleSolsticeOAuth.methodID,
                      access: tokens.access,
                      refresh: tokens.refresh,
                      expires: tokens.expires,
                      metadata: {
                        portalBaseURL: nous.portalBaseURL,
                        ...(tokens.scope ? { scope: tokens.scope } : {}),
                      },
                    }),
                  ),
                  Effect.tap(() => respond()),
                  Effect.tapError((cause) =>
                    respond(cause instanceof Error ? cause.message : "Google (Solstice) sign-in failed"),
                  ),
                  Effect.onInterrupt(() => Effect.sync(() => result.response?.destroy())),
                )
              }),
              submit: submitRedirect({ state, received }),
            }
          }),
        refresh: (value) =>
          Effect.gen(function* () {
            if (value.metadata?.shuvcodeAuthImport === "access-only") {
              return yield* Effect.fail(
                new Error("Access-only imported credentials cannot be refreshed; import fresh credentials explicitly"),
              )
            }
            if (!value.refresh.trim()) {
              return yield* Effect.fail(new Error("Google (Solstice) is missing a refresh token"))
            }
            const googleConnection = yield* ctx.integration.connection.active(GoogleSolsticeOAuth.integrationID)
            const credentialID = googleConnection?.type === "credential" ? googleConnection.id : undefined
            const fingerprint = GoogleSolsticeOAuth.refreshFingerprint(value.refresh)
            if (credentialID) {
              const deadGrants = yield* readDeadGrants()
              const entry = deadGrants[credentialID]
              if (entry && entry.fingerprint === fingerprint) {
                const deadError = new GoogleSolsticeOAuth.SolsticeGrantDeadError(entry.error)
                yield* ctx.integration.connection.status({
                  integrationID: GoogleSolsticeOAuth.integrationID,
                  connection: googleConnection!,
                  status: { status: "needs_auth", message: deadError.message },
                })
                return yield* Effect.fail(deadError)
              }
              if (entry && entry.fingerprint !== fingerprint) {
                yield* clearDeadGrant(credentialID)
              }
            }
            const nous = yield* resolveNousAccessToken()
            const metadataPortal =
              typeof value.metadata?.portalBaseURL === "string" && value.metadata.portalBaseURL.trim().length > 0
                ? value.metadata.portalBaseURL
                : undefined
            const portalBaseURL = yield* Effect.try({
              try: () =>
                metadataPortal ? validateHttpsOrLoopback(metadataPortal, "Nous Portal URL") : nous.portalBaseURL,
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            })
            const refreshed = yield* Effect.tryPromise({
              try: (signal) =>
                GoogleSolsticeOAuth.refreshCredential(value, nous.access, portalBaseURL, runtimeOptions, signal),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            }).pipe(
              Effect.tapError((cause) =>
                Effect.gen(function* () {
                  if (cause instanceof GoogleSolsticeOAuth.SolsticeGrantDeadError) {
                    if (credentialID) yield* recordDeadGrant(credentialID, fingerprint, cause.code)
                    if (googleConnection) {
                      yield* ctx.integration.connection.status({
                        integrationID: GoogleSolsticeOAuth.integrationID,
                        connection: googleConnection,
                        status: { status: "needs_auth", message: cause.message },
                      })
                    }
                    return
                  }
                  if (cause instanceof GoogleSolsticeOAuth.NousAuthRequiredError) {
                    // Never mark the Google grant dead when the Nous Portal bearer needs re-login.
                    yield* markNousNeedsAuth(nous.connection, cause.message)
                  }
                }),
              ),
            )
            if (credentialID) yield* clearDeadGrant(credentialID)
            if (googleConnection) {
              yield* ctx.integration.connection.status({
                integrationID: GoogleSolsticeOAuth.integrationID,
                connection: googleConnection,
                status: undefined,
              })
            }
            yield* clearNousNeedsAuth(nous.connection)
            return refreshed
          }),
        label: (value) => (typeof value.metadata?.email === "string" ? value.metadata.email : undefined),
      }

      const load = Effect.fn("GoogleSolsticePlugin.load")(function* () {
        const connection = yield* ctx.integration.connection.active(GoogleSolsticeOAuth.integrationID)
        if (!connection || connection.type !== "credential" || connection.method !== "oauth") {
          subscription = false
          return
        }
        const resolved = yield* ctx.integration.connection.resolve(connection).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((cause) => Effect.succeed({ ok: false as const, cause })),
        )
        if (resolved.ok) {
          if (GoogleSolsticeOAuth.isSubscription(resolved.value) && resolved.value?.type === "oauth") {
            subscription = true
            knownLegacy.delete(connection.id)
            yield* clearDeadGrantIfRotated(connection.id, resolved.value)
            yield* ctx.integration.connection.status({
              integrationID: GoogleSolsticeOAuth.integrationID,
              connection,
              status: undefined,
            })
            return
          }
          if (GoogleSolsticeOAuth.isLegacyAntigravity(resolved.value)) {
            subscription = false
            knownLegacy.add(connection.id)
            yield* ctx.integration.connection.status({
              integrationID: GoogleSolsticeOAuth.integrationID,
              connection,
              status: { status: "needs_auth", message: LEGACY_MIGRATION_MESSAGE },
            })
            return
          }
          subscription = false
          return
        }
        // Keep Solstice models active during transient outages so catalog/cost do not flicker to API-key defaults.
        subscription = !knownLegacy.has(connection.id)
      })

      yield* ctx.integration.transform((draft) => {
        draft.update(NousPortalOAuth.integrationID, (integration) => {
          integration.name = "Nous Portal"
        })
        draft.method.update(nousOAuth)
        draft.update(GoogleSolsticeOAuth.integrationID, (integration) => {
          if (!integration.name || integration.name === integration.id) integration.name = "Google"
        })
        draft.method.update(solsticeOAuth)
      })

      yield* load()
      yield* ctx.provider.transform((evt) => GoogleSolsticeWire.applyProvider(evt, subscription))
      yield* ctx.model.transform((evt) => GoogleSolsticeWire.applyModels(evt, subscription))

      yield* ctx.session.hook(
        "http.request",
        (evt) =>
          Effect.gen(function* () {
            if (evt.model.providerID !== Provider.ID.google) return
            const connection = yield* ctx.integration.connection.active(GoogleSolsticeOAuth.integrationID)
            if (!connection || connection.type !== "credential" || connection.method !== "oauth") return
            // Fail closed: never fall through to API-key transport when OAuth resolution fails.
            const resolved = yield* ctx.integration.connection.resolve(connection).pipe(Effect.orDie)
            if (GoogleSolsticeOAuth.isLegacyAntigravity(resolved)) {
              knownLegacy.add(connection.id)
              yield* ctx.integration.connection.status({
                integrationID: GoogleSolsticeOAuth.integrationID,
                connection,
                status: { status: "needs_auth", message: LEGACY_MIGRATION_MESSAGE },
              })
              return yield* Effect.die(new Error(LEGACY_MIGRATION_MESSAGE))
            }
            if (!GoogleSolsticeOAuth.isSubscription(resolved) || resolved?.type !== "oauth") return
            const targetURL = GoogleSolsticeWire.rewriteGenerateURL(evt.request.url)
            if (!targetURL) {
              return yield* Effect.die(new Error("Google (Solstice) supports GenerateContent endpoints only"))
            }
            const headers = new Headers(evt.request.headers)
            GoogleSolsticeWire.applyRequestHeaders(headers, resolved.access)
            const body = evt.request.body ? yield* Effect.promise(() => evt.request.clone().arrayBuffer()) : undefined
            evt.request = new Request(targetURL, {
              method: evt.request.method,
              headers,
              signal: evt.request.signal,
              ...(body !== undefined ? { body } : {}),
            })
          }),
        { providerID: Provider.ID.google },
      )

      const onCredentialEvent = (event: { readonly type: string; readonly data?: unknown }) =>
        loading.withPermit(
          Effect.gen(function* () {
            const nousConnection = yield* ctx.integration.connection.active(NousPortalOAuth.integrationID)
            const switchedNous =
              event.type === "credential.switched" && eventIntegrationID(event.data) === NousPortalOAuth.integrationID
            const rotatedNous =
              nousConnection?.type === "credential" &&
              nousFailedConnectionID !== undefined &&
              nousConnection.id !== nousFailedConnectionID
            if (nousConnection && (switchedNous || rotatedNous)) {
              yield* clearNousNeedsAuth(nousConnection)
            }
            yield* load()
            yield* ctx.provider.reload()
          }),
        )

      yield* ctx.event
        .subscribe()
        .pipe(
          Stream.filter(isSolsticeCredentialEvent),
          Stream.runForEach(onCredentialEvent),
          Effect.forkScoped({ startImmediately: true }),
        )
    }),
  })
}

export const GoogleSolsticePlugin = createPlugin()
export const GoogleAntigravityPlugin = GoogleSolsticePlugin
export default GoogleSolsticePlugin
export { NousPortalOAuth } from "./nous"
export { GoogleSolsticeOAuth } from "./oauth"
export { GoogleSolsticeWire } from "./wire"

function eventIntegrationID(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("integrationID" in data)) return undefined
  return typeof data.integrationID === "string" ? data.integrationID : undefined
}

export function isSolsticeCredentialEvent(event: { readonly type: string; readonly data?: unknown }) {
  // credential.updated has no integration payload; reload whenever any credential changes.
  if (event.type === "credential.updated") return true
  if (event.type !== "credential.switched") return false
  const id = eventIntegrationID(event.data)
  return id === GoogleSolsticeOAuth.integrationID || id === NousPortalOAuth.integrationID
}
