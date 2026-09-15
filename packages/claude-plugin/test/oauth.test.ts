import { describe, expect, test } from "bun:test"
import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Effect } from "effect"
import { authorizeURL, exchange, isSubscription, methodID, parseCode, pkce, refresh } from "../src/oauth.js"

const credential = Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "native", expires: 1 })

describe("OAuth boundary", () => {
  test("recognizes only the subscription method and setup-token keys", () => {
    expect(isSubscription(credential)).toBe(true)
    expect(isSubscription({ ...credential, methodID: IntegrationMethodID.make("other") })).toBe(false)
    expect(isSubscription({ type: "key", key: "sk-ant-oat01-fixture" })).toBe(true)
    expect(isSubscription({ type: "key", key: "sk-ant-api03-fixture" })).toBe(false)
    expect(isSubscription(undefined)).toBe(false)
  })

  test("PKCE and callback state", async () => {
    const proof = await pkce()
    expect(proof.verifier.length).toBe(43)
    expect(proof.challenge).toBe(
      Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof.verifier))).toString(
        "base64url",
      ),
    )
    const url = new URL(authorizeURL(proof.challenge, proof.verifier))
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe(proof.verifier)
    expect(parseCode(" code#state ", "state")).toBe("code")
    expect(parseCode(" code ", "state")).toBe("code")
    expect(() => parseCode("code#wrong", "state")).toThrow("state")
    expect(() => parseCode("", "state")).toThrow()
  })

  test("exchanges through injected network and forwards abort signal", async () => {
    const abort = new AbortController()
    const result = await exchange(
      "code#verifier",
      "verifier",
      {
        now: () => 1000,
        fetch: async (url, init) => {
          expect(url).toBe("https://platform.claude.com/v1/oauth/token")
          expect(init.signal).toBe(abort.signal)
          const body = new URLSearchParams(String(init.body))
          expect(body.get("code")).toBe("code")
          expect(body.get("code_verifier")).toBe("verifier")
          return Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 60 })
        },
      },
      abort.signal,
    )
    expect(result).toEqual({ type: "oauth", methodID, access: "new", refresh: "rotated", expires: 61000 })
  })

  test("refresh preserves metadata and retains an omitted refresh token", async () => {
    const value = { ...credential, metadata: { accountID: "fixture", custom: { retained: true } } }
    const result = await Effect.runPromise(
      refresh(value, {
        now: () => 1000,
        fetch: async (_, init) => {
          expect(new URLSearchParams(String(init.body)).get("refresh_token")).toBe("native")
          expect(init.signal).toBeInstanceOf(AbortSignal)
          return Response.json({ access_token: "new", expires_in: 60 })
        },
      }),
    )
    expect(result.metadata).toEqual(value.metadata)
    expect(result.refresh).toBe("native")
    expect(result.access).toBe("new")
  })

  test("access-only marker forbids refresh before any network, even if a refresh token was accidentally retained", async () => {
    let calls = 0
    for (const token of ["", "live-token-must-not-be-used"]) {
      await expect(
        Effect.runPromise(
          refresh(
            { ...credential, refresh: token, metadata: { shuvcodeAuthImport: "access-only" } },
            {
              fetch: async () => {
                calls++
                throw new Error("network must not run")
              },
            },
          ),
        ),
      ).rejects.toThrow("access-only")
    }
    expect(calls).toBe(0)
  })

  test("rejects malformed OAuth payloads and unsuccessful status", async () => {
    for (const payload of [
      { access_token: 123, expires_in: 60 },
      { access_token: "", expires_in: 60 },
      { access_token: "x", expires_in: "60" },
      { access_token: "x", expires_in: 0 },
      { access_token: "x", expires_in: -1 },
      { access_token: "x", expires_in: 60, refresh_token: 123 },
    ]) {
      await expect(
        Effect.runPromise(refresh(credential, { fetch: async () => Response.json(payload) })),
      ).rejects.toThrow()
    }
    await expect(
      exchange("code", "verifier", { fetch: async () => Response.json({ access_token: "x", expires_in: 60 }) }),
    ).rejects.toThrow("refresh token")
    await expect(
      Effect.runPromise(refresh(credential, { fetch: async () => new Response("private error", { status: 401 }) })),
    ).rejects.toThrow("HTTP 401")
  })

  test("already aborted exchange does not call the network", async () => {
    let calls = 0
    const abort = new AbortController()
    abort.abort()
    await expect(
      exchange(
        "code",
        "verifier",
        {
          fetch: async () => {
            calls++
            return new Response()
          },
        },
        abort.signal,
      ),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })

  test("interrupting refresh aborts the injected fetch", async () => {
    const started = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const abort = new AbortController()
    const running = Effect.runPromise(
      refresh(credential, {
        fetch: (_, init) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => {
                aborted.resolve()
                reject(new Error("aborted"))
              },
              { once: true },
            )
            started.resolve()
          }),
      }),
      { signal: abort.signal },
    )
    await started.promise
    abort.abort()
    await expect(running).rejects.toThrow()
    await aborted.promise
  })
})
