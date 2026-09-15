import { expect, test } from "bun:test"
import { Credential } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { GoogleAntigravityOAuth, isGoogleCredentialEvent, oauth } from "../src/index"

function value(metadata?: Record<string, unknown>) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID: GoogleAntigravityOAuth.methodID,
    access: "fixture-access",
    refresh: "fixture-refresh",
    expires: 1,
    metadata: { projectId: "fixture-project", email: "fixture@example.test", ...metadata },
  })
}

test("access-only import refuses refresh before calling the injected HTTP boundary", async () => {
  let calls = 0
  await expect(
    GoogleAntigravityOAuth.refreshCredential(value({ shuvcodeAuthImport: "access-only" }), async () => {
      calls++
      throw new Error("must not call")
    }),
  ).rejects.toThrow("Access-only")
  expect(calls).toBe(0)
  const result = await Effect.runPromise(Effect.result(oauth.refresh(value({ shuvcodeAuthImport: "access-only" }))))
  expect(result._tag).toBe("Failure")
})

test("refresh preserves metadata and omitted refresh token with injected fetch", async () => {
  const bodies: string[] = []
  const original = value({ custom: "kept" })
  const result = await GoogleAntigravityOAuth.refreshCredential(original, async (_url, init) => {
    bodies.push(String(init?.body))
    return Response.json({ access_token: "next-access", expires_in: 3600 })
  })
  expect(result.access).toBe("next-access")
  expect(result.refresh).toBe(original.refresh)
  expect(result.metadata).toEqual(original.metadata)
  expect(result.expires).toBeGreaterThan(Date.now())
  expect(new URLSearchParams(bodies[0]).get("grant_type")).toBe("refresh_token")
})

test("refresh failures and malformed responses fail rather than fall back", async () => {
  await expect(
    GoogleAntigravityOAuth.refreshCredential(value(), async () => new Response("invalid_grant", { status: 400 })),
  ).rejects.toThrow("HTTP 400")
  await expect(GoogleAntigravityOAuth.refreshCredential(value(), async () => Response.json({}))).rejects.toThrow(
    "invalid credential response",
  )
  await expect(
    GoogleAntigravityOAuth.refreshCredential({ ...value(), refresh: "" }, async () => {
      throw new Error("network")
    }),
  ).rejects.toThrow("missing a refresh token")
})

test("credential event selection respects integration scope", () => {
  expect(isGoogleCredentialEvent({ type: "credential.updated" })).toBe(true)
  expect(isGoogleCredentialEvent({ type: "credential.switched", data: { integrationID: "google" } })).toBe(true)
  expect(isGoogleCredentialEvent({ type: "credential.switched", data: { integrationID: "openai" } })).toBe(false)
  expect(isGoogleCredentialEvent({ type: "model.updated" })).toBe(false)
})

test("explicit browser cancellation releases the callback listener", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* oauth.authorize()
        const state = new URL(auth.url).searchParams.get("state")!
        const response = yield* Effect.promise(() =>
          fetch(`${GoogleAntigravityOAuth.redirectURI}?state=${state}&error=access_denied`),
        )
        expect(response.status).toBe(400)
        expect((yield* Effect.result(auth.callback))._tag).toBe("Failure")
      }),
    ),
  )
  // A second scope must bind the same port, and closing it needs no provider call.
  await Effect.runPromise(Effect.scoped(oauth.authorize()))
})
