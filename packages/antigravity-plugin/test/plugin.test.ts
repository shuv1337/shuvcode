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
    const methods = new Map<string, IntegrationOAuthMethodRegistration>()
    const nousCred = Credential.OAuth.make({
      type: "oauth",
      methodID: NousPortalOAuth.methodID,
      access: "nous-access-token",
      refresh: "nous-refresh-token",
      expires: Date.now() + 3_600_000,
      metadata: { portalBaseURL: portal },
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
          if (body.code === "browser-code") await exchangeGate
          exchangeFinished = true
          return Response.json({
            access_token: `ya29.${body.code}`,
            refresh_token: `1//refresh-${body.code}`,
            expires_in: 3600,
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      },
    })

    const stubContext = {
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
          active: (id: string) =>
            Effect.succeed(
              id === NousPortalOAuth.integrationID
                ? { type: "credential" as const, id: "cred_nous", label: "Nous", method: "oauth" as const }
                : undefined,
            ),
          resolve: () => Effect.succeed(nousCred),
          status: () => Effect.void,
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
        get: () => Effect.succeed(undefined),
        set: () => Effect.void,
        remove: () => Effect.void,
      },
      event: {
        subscribe: () => Stream.empty,
      },
    } as unknown as Context

    // Run both browser callback and pasted redirect flows under scoped cleanup.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* testPlugin.effect(stubContext)
          const solstice = methods.get(GoogleSolsticeOAuth.methodID)
          expect(solstice).toBeDefined()

          // 1. Browser loopback callback: response stays open until exchange finishes.
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
          const responsePromise = fetch(`${redirectURI}?state=${encodeURIComponent(state)}&code=browser-code`)
          // Release exchange and confirm HTTP response completes with 200 HTML after exchange finished.
          releaseExchange!()
          const [httpResponse, browserCred] = yield* Effect.all([
            Effect.promise(() => responsePromise),
            Fiber.join(callbackFiber),
          ])
          expect(exchangeFinished).toBe(true)
          expect(httpResponse.status).toBe(200)
          expect(yield* Effect.promise(() => httpResponse.text())).toContain("Google (Solstice)")
          expect(browserCred.access).toBe("ya29.browser-code")
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
          expect(pastedCred.access).toBe("ya29.pasted-code")
          expect(pastedCred.refresh).toBe("1//refresh-pasted-code")
        }),
      ),
    )
  })
})
