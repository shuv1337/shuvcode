import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { Credential } from "@opencode/plugin/effect"
import { Deferred, Effect } from "effect"
import { GoogleSolsticeOAuth } from "../src/oauth"
import { type ReceivedCallback, parseRedirect, submitRedirect } from "../src/redirect"

const portal = "http://127.0.0.1:9002"

describe("GoogleSolsticeOAuth", () => {
  test("pkce uses S256 and refreshFingerprint hashes without exposing the raw token", () => {
    const pair = GoogleSolsticeOAuth.pkce()
    const expected = createHash("sha256").update(pair.verifier).digest("base64url").replace(/=+$/, "")
    expect(pair.challenge).toBe(expected)
    expect(GoogleSolsticeOAuth.randomState().length).toBeGreaterThanOrEqual(40)
    const fp = GoogleSolsticeOAuth.refreshFingerprint("1//secret-refresh-token")
    expect(fp).toMatch(/^[0-9a-f]{12}$/)
    expect(fp).not.toContain("secret")
    expect(GoogleSolsticeOAuth.refreshFingerprint("1//secret-refresh-token")).toBe(fp)
  })

  test("discoverClient validates authorize_url and classifies 404 vs 401", async () => {
    const config = await GoogleSolsticeOAuth.discoverClient(portal, "nous-access-1", {
      fetch: async (url, init) => {
        expect(url).toBe(`${portal}/api/oauth/gemini-auth/config`)
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer nous-access-1")
        return Response.json({
          client_id: "solstice-client.apps.googleusercontent.com",
          authorize_url: "https://accounts.google.com/o/oauth2/v2/auth?include_granted_scopes=true",
          scope: "  openid   https://www.googleapis.com/auth/generative-language.peruserquota  ",
        })
      },
    })
    expect(config).toEqual({
      clientID: "solstice-client.apps.googleusercontent.com",
      authorizeURL: "https://accounts.google.com/o/oauth2/v2/auth?include_granted_scopes=true",
      scope: "openid https://www.googleapis.com/auth/generative-language.peruserquota",
    })

    const built = new URL(
      GoogleSolsticeOAuth.buildAuthorizeURL(config, {
        redirectURI: "http://127.0.0.1:43210/gemini-auth/callback",
        challenge: "chal-1",
        state: "state-1",
      }),
    )
    expect(built.origin + built.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(built.searchParams.get("include_granted_scopes")).toBe("true")
    expect(built.searchParams.get("client_id")).toBe("solstice-client.apps.googleusercontent.com")
    expect(built.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43210/gemini-auth/callback")
    expect(built.searchParams.get("code_challenge")).toBe("chal-1")
    expect(built.searchParams.get("code_challenge_method")).toBe("S256")
    expect(built.searchParams.get("access_type")).toBe("offline")
    expect(built.searchParams.get("prompt")).toBe("consent")
    expect(built.searchParams.get("state")).toBe("state-1")

    await expect(
      GoogleSolsticeOAuth.discoverClient(portal, "nous-access-1", {
        fetch: async () => new Response("Not Found", { status: 404 }),
      }),
    ).rejects.toThrow("Solstice is not available on this Nous Portal account yet.")

    await expect(
      GoogleSolsticeOAuth.discoverClient(portal, "nous-access-1", {
        fetch: async () => new Response("Unauthorized", { status: 401 }),
      }),
    ).rejects.toBeInstanceOf(GoogleSolsticeOAuth.NousAuthRequiredError)

    await expect(
      GoogleSolsticeOAuth.discoverClient(portal, "nous-access-1", {
        fetch: async () =>
          Response.json({
            client_id: "cid",
            authorize_url: "https://evil.example/auth",
            scope: "openid",
          }),
      }),
    ).rejects.toThrow("accounts.google.com")
  })

  test("exchange posts PKCE verifier and requires non-empty access and refresh tokens", async () => {
    const now = 1_700_000_000_000
    const tokens = await GoogleSolsticeOAuth.exchange(
      portal,
      "nous-access-1",
      { code: "code-1", verifier: "ver-1", redirectURI: "http://127.0.0.1:5000/gemini-auth/callback" },
      {
        now: () => now,
        fetch: async (url, init) => {
          expect(url).toBe(`${portal}/api/oauth/gemini-auth/exchange`)
          expect(JSON.parse(String(init?.body))).toEqual({
            code: "code-1",
            code_verifier: "ver-1",
            redirect_uri: "http://127.0.0.1:5000/gemini-auth/callback",
          })
          return Response.json({
            access_token: "ya29.access",
            refresh_token: "1//refresh",
            expires_in: 3600,
          })
        },
      },
    )
    expect(tokens).toEqual({
      access: "ya29.access",
      refresh: "1//refresh",
      expires: now + 3_600_000,
    })

    await expect(
      GoogleSolsticeOAuth.exchange(
        portal,
        "nous-access-1",
        { code: "code-1", verifier: "ver-1", redirectURI: "http://127.0.0.1:5000/gemini-auth/callback" },
        { fetch: async () => Response.json({ access_token: "ya29.only" }) },
      ),
    ).rejects.toThrow("invalid credential response")
  })

  test("refreshCredential enforces PR #2 dead-grant vs Nous-401 vs transient classification and access-only guard", async () => {
    const now = 1_700_000_000_000
    const cred = Credential.OAuth.make({
      type: "oauth",
      methodID: GoogleSolsticeOAuth.methodID,
      access: "old-google-access",
      refresh: "1//solstice-refresh",
      expires: now - 1000,
      metadata: { portalBaseURL: portal, email: "user@example.test" },
    })

    // access-only fails before any network call
    let called = false
    await expect(
      GoogleSolsticeOAuth.refreshCredential(
        Credential.OAuth.make({ ...cred, metadata: { shuvcodeAuthImport: "access-only" } }),
        "nous-access",
        portal,
        {
          fetch: async () => {
            called = true
            return Response.json({})
          },
        },
      ),
    ).rejects.toThrow("Access-only")
    expect(called).toBe(false)

    // empty refresh fails before any network call
    await expect(
      GoogleSolsticeOAuth.refreshCredential(Credential.OAuth.make({ ...cred, refresh: "   " }), "nous-access", portal, {
        fetch: async () => {
          called = true
          return Response.json({})
        },
      }),
    ).rejects.toThrow("missing a refresh token")
    expect(called).toBe(false)

    // Dead grant codes: invalid_grant and unauthorized_client
    for (const code of ["invalid_grant", "unauthorized_client"] as const) {
      const err = await GoogleSolsticeOAuth.refreshCredential(cred, "nous-access", portal, {
        fetch: async () =>
          Response.json({ error: code, error_description: "1//solstice-refresh leaked" }, { status: 400 }),
      }).catch((cause: unknown) => cause)
      expect(err).toBeInstanceOf(GoogleSolsticeOAuth.SolsticeGrantDeadError)
      expect((err as GoogleSolsticeOAuth.SolsticeGrantDeadError).code).toBe(code)
      expect(String(err)).not.toContain("1//solstice-refresh")
    }

    // 401 without dead code -> NousAuthRequiredError (NOT SolsticeGrantDeadError)
    await expect(
      GoogleSolsticeOAuth.refreshCredential(cred, "nous-access", portal, {
        fetch: async () => Response.json({ error: "invalid_token" }, { status: 401 }),
      }),
    ).rejects.toBeInstanceOf(GoogleSolsticeOAuth.NousAuthRequiredError)

    // Transient matrix: 502 gemini_auth_refresh_failed, 429, 403/429 x-vercel-mitigated, 404, non-JSON 500, network error
    const transientResponses: Array<() => Promise<Response>> = [
      async () => Response.json({ error: "gemini_auth_refresh_failed" }, { status: 502 }),
      async () => Response.json({ error: "rate_limited" }, { status: 429 }),
      async () => new Response("challenge", { status: 403, headers: { "x-vercel-mitigated": "challenge" } }),
      async () => new Response("challenge", { status: 401, headers: { "x-vercel-mitigated": "challenge" } }),
      async () => new Response("Not Found", { status: 404 }),
      async () => new Response("<html>Bad Gateway</html>", { status: 502 }),
      async () => {
        throw new Error("ECONNRESET")
      },
    ]
    for (const responder of transientResponses) {
      await expect(
        GoogleSolsticeOAuth.refreshCredential(cred, "nous-access", portal, { fetch: responder }),
      ).rejects.toBeInstanceOf(GoogleSolsticeOAuth.SolsticeBrokerTransientError)
    }

    // Happy path preserves prior refresh token and metadata
    const refreshed = await GoogleSolsticeOAuth.refreshCredential(cred, "nous-access", portal, {
      now: () => now,
      fetch: async () => Response.json({ access_token: "ya29.fresh", expires_in: 1800 }),
    })
    expect(refreshed.access).toBe("ya29.fresh")
    expect(refreshed.refresh).toBe("1//solstice-refresh")
    expect(refreshed.expires).toBe(now + 1_800_000)
    expect(refreshed.metadata).toEqual({ portalBaseURL: portal, email: "user@example.test" })
  })
})

describe("redirect paste helper", () => {
  test("rejects malformed URL, mismatched state, and missing code without failing the pending Deferred", async () => {
    expect(parseRedirect("not a url", "state-1")).toMatchObject({ ok: false })
    expect(parseRedirect("http://127.0.0.1:9999/gemini-auth/callback?state=wrong&code=abc", "state-1")).toMatchObject({
      ok: false,
    })
    expect(parseRedirect("http://127.0.0.1:9999/gemini-auth/callback?state=state-1", "state-1")).toMatchObject({
      ok: false,
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const received = yield* Deferred.make<ReceivedCallback, Error>()
        const submit = submitRedirect({ state: "state-1", received })
        const badPaste = yield* Effect.exit(submit("http://127.0.0.1:9999/gemini-auth/callback?state=wrong&code=abc"))
        expect(badPaste._tag).toBe("Failure")
        expect(yield* Deferred.isDone(received)).toBe(false)
        yield* submit("http://127.0.0.1:9999/gemini-auth/callback?state=state-1&code=good-code")
        return yield* Deferred.await(received)
      }),
    )
    expect(result.code).toBe("good-code")
  })

  test("valid-state redirect with error fails the pending Deferred with sanitized code only", async () => {
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const received = yield* Deferred.make<ReceivedCallback, Error>()
        const submit = submitRedirect({ state: "state-1", received })
        yield* submit(
          "http://127.0.0.1:9999/gemini-auth/callback?state=state-1&error=access_denied&error_description=secret+text",
        )
        return yield* Effect.flip(Deferred.await(received))
      }),
    )
    expect(failure.message).toBe("Google authorization failed (access_denied)")
    expect(failure.message).not.toContain("secret")
  })
})
