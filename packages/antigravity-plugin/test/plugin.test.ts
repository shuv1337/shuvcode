import { describe, expect, test } from "bun:test"
import type { IntegrationEditor, IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Credential } from "@opencode/plugin/effect"
import { Effect, Fiber, Stream } from "effect"
import plugin, {
  GoogleAntigravityPlugin,
  GoogleSolsticeOAuth,
  GoogleSolsticePlugin,
  ID,
  NousPortalOAuth,
  createPlugin,
  isSolsticeCredentialEvent,
} from "../src/index"
import { OauthCallbackPage } from "../src/page"

function createStubHost(input: {
  readonly active?: (
    id: string,
  ) => Effect.Effect<Parameters<Context["integration"]["connection"]["resolve"]>[0] | undefined>
  readonly resolve?: (
    connection: Parameters<Context["integration"]["connection"]["resolve"]>[0],
  ) => Effect.Effect<Credential.Value | undefined, unknown>
  readonly onStatus?: (call: { readonly integrationID: string; readonly status: unknown }) => void
}) {
  const methods = new Map<string, IntegrationOAuthMethodRegistration>()
  const storage = new Map<string, unknown>()
  const context = {
    integration: {
      transform: (fn: (editor: IntegrationEditor) => void) =>
        Effect.sync(() => {
          fn({
            list: () => [],
            get: () => undefined,
            update: () => {},
            remove: () => {},
            method: {
              list: () => [],
              update: (reg) => {
                if (reg.method.type === "oauth") methods.set(reg.method.id, reg as IntegrationOAuthMethodRegistration)
              },
              remove: () => {},
            },
          })
          return { dispose: Effect.void }
        }),
      reload: () => Effect.void,
      connection: {
        active: input.active ?? (() => Effect.succeed(undefined)),
        resolve: input.resolve ?? (() => Effect.succeed(undefined)),
        status: (call: { readonly integrationID: string; readonly status: unknown }) =>
          Effect.sync(() => {
            input.onStatus?.(call)
          }),
      },
    },
    provider: {
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
    },
    model: {
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
    },
    session: {
      hook: () => Effect.succeed({ dispose: Effect.void }),
    },
    storage: {
      get: (key: string) => Effect.succeed(storage.get(key)),
      set: (key: string, value: unknown) =>
        Effect.sync(() => {
          storage.set(key, value)
        }),
      remove: (key: string) =>
        Effect.sync(() => {
          storage.delete(key)
        }),
    },
    event: {
      subscribe: () => Stream.empty,
    },
  } as unknown as Context
  return { context, methods, storage }
}

describe("GoogleSolsticePlugin package", () => {
  test("exports plugin identity, factory, and credential event filter", () => {
    expect(plugin).toBe(GoogleSolsticePlugin)
    expect(GoogleAntigravityPlugin).toBe(GoogleSolsticePlugin)
    expect(plugin.id).toBe(ID)
    expect(plugin.id).toBe("shuvcode.provider.google-solstice")
    expect(typeof plugin.effect).toBe("function")
    expect(() => createPlugin({ portalURL: "http://localhost:8080" })).toThrow()

    expect(isSolsticeCredentialEvent({ type: "credential.updated" })).toBe(true)
    expect(isSolsticeCredentialEvent({ type: "credential.switched", data: { integrationID: "google" } })).toBe(true)
    expect(isSolsticeCredentialEvent({ type: "credential.switched", data: { integrationID: "nous" } })).toBe(true)
    expect(isSolsticeCredentialEvent({ type: "credential.switched", data: { integrationID: "anthropic" } })).toBe(false)
    expect(isSolsticeCredentialEvent({ type: "session.updated", data: { integrationID: "google" } })).toBe(false)
  })

  test("OAuth callback HTML renders Google (Solstice) copy", () => {
    const ok = OauthCallbackPage.success({ provider: "Google (Solstice)" })
    const fail = OauthCallbackPage.error("access_denied", { provider: "Google (Solstice)" })
    expect(ok).toContain("Authorization successful")
    expect(ok).toContain("Google (Solstice)")
    expect(fail).toContain("Authorization failed")
    expect(fail).toContain("access_denied")
  })

  test("google-solstice authorize holds browser response until exchange finishes and supports redirect paste", async () => {
    const portal = "http://127.0.0.1:9911"
    const nousCred = Credential.OAuth.make({
      type: "oauth",
      methodID: NousPortalOAuth.methodID,
      access: "nous-access-token",
      refresh: "nous-refresh-token",
      expires: Date.now() + 3_600_000,
      metadata: { portalBaseURL: portal },
    })

    let markExchangeStarted: (() => void) | undefined
    const exchangeStarted = new Promise<void>((resolve) => {
      markExchangeStarted = resolve
    })
    let releaseExchange: (() => void) | undefined
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve
    })
    let exchangeFinished = false

    const testPlugin = createPlugin({
      portalURL: portal,
      now: () => 1_700_000_000_000,
      fetch: async (url, init) => {
        if (url === `${portal}/api/oauth/gemini-auth/config`) {
          return Response.json({
            client_id: "solstice-client-id",
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
            scope: "openid https://www.googleapis.com/auth/generative-language.peruserquota",
          })
        }
        if (url === `${portal}/api/oauth/gemini-auth/exchange`) {
          const body = JSON.parse(String(init?.body)) as { code: string }
          if (body.code === "browser-code") {
            markExchangeStarted?.()
            await exchangeGate
          }
          exchangeFinished = true
          return Response.json({
            access_token: `fixture-${body.code}`,
            refresh_token: `1//refresh-${body.code}`,
            expires_in: 3600,
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      },
    })

    const { context, methods } = createStubHost({
      active: (id) =>
        Effect.succeed(
          id === NousPortalOAuth.integrationID
            ? { type: "credential" as const, id: "cred_nous", label: "Nous", method: "oauth" as const }
            : undefined,
        ),
      resolve: () => Effect.succeed(nousCred),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* testPlugin.effect(context)
          const solstice = methods.get(GoogleSolsticeOAuth.methodID)
          expect(solstice).toBeDefined()

          // 1. Browser loopback callback: verify HTTP response stays open while exchange is gated.
          const browserAuth = yield* solstice!.authorize({})
          expect(browserAuth.mode).toBe("auto")
          if (browserAuth.mode !== "auto") return
          const authorizeURL = new URL(browserAuth.url)
          const redirectURI = authorizeURL.searchParams.get("redirect_uri")!
          const state = authorizeURL.searchParams.get("state")!
          expect(redirectURI).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gemini-auth\/callback$/)

          // Stray wrong-state request gets 400 HTML without aborting the pending sign-in.
          const badResponse = yield* Effect.promise(() => fetch(`${redirectURI}?state=wrong&code=bad`))
          expect(badResponse.status).toBe(400)

          const callbackFiber = yield* Effect.forkChild(browserAuth.callback, { startImmediately: true })
          let settled = false
          const responsePromise = fetch(`${redirectURI}?state=${encodeURIComponent(state)}&code=browser-code`).then(
            (res) => {
              settled = true
              return res
            },
          )
          // Wait until exchange has actually started, yield a macrotask, and assert the browser response is still held.
          yield* Effect.promise(() => exchangeStarted)
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))
          expect(settled).toBe(false)
          expect(exchangeFinished).toBe(false)

          releaseExchange!()
          const [httpResponse, browserCred] = yield* Effect.all([
            Effect.promise(() => responsePromise),
            Fiber.join(callbackFiber),
          ])
          expect(settled).toBe(true)
          expect(exchangeFinished).toBe(true)
          expect(httpResponse.status).toBe(200)
          expect(yield* Effect.promise(() => httpResponse.text())).toContain("Google (Solstice)")
          expect(browserCred.access).toBe("fixture-browser-code")
          expect(browserCred.refresh).toBe("1//refresh-browser-code")

          // 2. Pasted redirect fallback (SSH / remote browser) via submit()
          const pasteAuth = yield* solstice!.authorize({})
          if (pasteAuth.mode !== "auto") return
          const pasteState = new URL(pasteAuth.url).searchParams.get("state")!
          const pasteRedirect = new URL(pasteAuth.url).searchParams.get("redirect_uri")!
          const pasteFiber = yield* Effect.forkChild(pasteAuth.callback, { startImmediately: true })
          const badPaste = yield* Effect.exit(
            pasteAuth.submit!("http://127.0.0.1:1/gemini-auth/callback?state=nope&code=x"),
          )
          expect(badPaste._tag).toBe("Failure")
          yield* pasteAuth.submit!(`${pasteRedirect}?state=${encodeURIComponent(pasteState)}&code=pasted-code`)
          const pastedCred = yield* Fiber.join(pasteFiber)
          expect(pastedCred.access).toBe("fixture-pasted-code")
          expect(pastedCred.refresh).toBe("1//refresh-pasted-code")
        }),
      ),
    )
  })

  test("interrupting solstice authorize callback during exchange destroys held response and closes server", async () => {
    const portal = "http://127.0.0.1:9912"
    const nousCred = Credential.OAuth.make({
      type: "oauth",
      methodID: NousPortalOAuth.methodID,
      access: "nous-access-token",
      refresh: "nous-refresh-token",
      expires: Date.now() + 3_600_000,
      metadata: { portalBaseURL: portal },
    })

    let markExchangeStarted: (() => void) | undefined
    const exchangeStarted = new Promise<void>((resolve) => {
      markExchangeStarted = resolve
    })
    let exchangeAborted = false

    const testPlugin = createPlugin({
      portalURL: portal,
      fetch: async (url, init) => {
        if (url === `${portal}/api/oauth/gemini-auth/config`) {
          return Response.json({
            client_id: "solstice-client-id",
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
            scope: "openid",
          })
        }
        if (url === `${portal}/api/oauth/gemini-auth/exchange`) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              exchangeAborted = true
              reject(new Error("aborted"))
            })
            markExchangeStarted?.()
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      },
    })

    const { context, methods } = createStubHost({
      active: (id) =>
        Effect.succeed(
          id === NousPortalOAuth.integrationID
            ? { type: "credential" as const, id: "cred_nous", label: "Nous", method: "oauth" as const }
            : undefined,
        ),
      resolve: () => Effect.succeed(nousCred),
    })

    let capturedRedirectURI = ""
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* testPlugin.effect(context)
          const solstice = methods.get(GoogleSolsticeOAuth.methodID)!
          const auth = yield* solstice.authorize({})
          if (auth.mode !== "auto") return
          const authorizeURL = new URL(auth.url)
          capturedRedirectURI = authorizeURL.searchParams.get("redirect_uri")!
          const state = authorizeURL.searchParams.get("state")!

          const callbackFiber = yield* Effect.forkChild(auth.callback, { startImmediately: true })
          const browserRequest = fetch(`${capturedRedirectURI}?state=${encodeURIComponent(state)}&code=hang`).catch(
            (cause: unknown) => cause,
          )
          yield* Effect.promise(() => exchangeStarted)
          yield* Fiber.interrupt(callbackFiber)
          const outcome = yield* Effect.promise(() => browserRequest)
          expect(outcome).toBeInstanceOf(Error)
          expect(exchangeAborted).toBe(true)
        }),
      ),
    )

    // Scoped finalizer closed the loopback callback server after scope exit.
    await expect(fetch(capturedRedirectURI)).rejects.toThrow()
  })

  test("non-dead timeout during Nous resolution does not mark nous needs_auth", async () => {
    const portal = "http://127.0.0.1:9913"
    const statuses: Array<{ readonly integrationID: string; readonly status: unknown }> = []
    const testPlugin = createPlugin({ portalURL: portal })
    const { context, methods } = createStubHost({
      active: (id) =>
        Effect.succeed(
          id === NousPortalOAuth.integrationID
            ? { type: "credential" as const, id: "cred_nous", label: "Nous", method: "oauth" as const }
            : id === GoogleSolsticeOAuth.integrationID
              ? { type: "credential" as const, id: "cred_google", label: "Google", method: "oauth" as const }
              : undefined,
        ),
      resolve: () => Effect.fail({ _tag: "TimeoutException", message: "timed out" }),
      onStatus: (call) => statuses.push(call),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* testPlugin.effect(context)
          const solstice = methods.get(GoogleSolsticeOAuth.methodID)!
          const googleCred = Credential.OAuth.make({
            type: "oauth",
            methodID: GoogleSolsticeOAuth.methodID,
            access: "fixture-stale",
            refresh: "1//solstice-refresh-timeout",
            expires: 1,
            metadata: { portalBaseURL: portal },
          })
          const failure = yield* Effect.flip(solstice.refresh!(googleCred))
          expect(failure).toBeInstanceOf(GoogleSolsticeOAuth.SolsticeBrokerTransientError)
          expect(statuses.filter((entry) => entry.integrationID === NousPortalOAuth.integrationID)).toEqual([])
          expect(statuses.filter((entry) => entry.integrationID === GoogleSolsticeOAuth.integrationID)).toEqual([])
        }),
      ),
    )
  })
})
