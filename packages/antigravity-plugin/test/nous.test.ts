import { describe, expect, test } from "bun:test"
import { Credential } from "@opencode/plugin/effect"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { NousPortalOAuth } from "../src/nous"

const portal = "http://127.0.0.1:9001"
const jwt = (payload: Record<string, unknown>) =>
  `hdr.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`

describe("NousPortalOAuth", () => {
  test("requestDeviceCode sends form payload and validates verification URIs", async () => {
    const now = 1_700_000_000_000
    let seenURL = ""
    let seenContentType = ""
    let seenBody = ""
    const device = await NousPortalOAuth.requestDeviceCode(portal, {
      now: () => now,
      fetch: async (url, init) => {
        seenURL = url
        seenContentType = new Headers(init?.headers).get("content-type") ?? ""
        seenBody = String(init?.body ?? "")
        return Response.json({
          device_code: "dev_123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://portal.nousresearch.com/device",
          verification_uri_complete: "https://portal.nousresearch.com/device?user_code=ABCD-EFGH",
          expires_in: 300,
          interval: 5,
        })
      },
    })
    expect(seenURL).toBe(`${portal}/api/oauth/device/code`)
    expect(seenContentType).toBe("application/x-www-form-urlencoded")
    expect(new URLSearchParams(seenBody).get("client_id")).toBe("hermes-cli")
    expect(new URLSearchParams(seenBody).get("scope")).toBe("inference:invoke")
    expect(device).toEqual({
      deviceCode: "dev_123",
      userCode: "ABCD-EFGH",
      verificationURI: "https://portal.nousresearch.com/device",
      verificationURIComplete: "https://portal.nousresearch.com/device?user_code=ABCD-EFGH",
      expiresAt: now + 300_000,
      intervalMs: 5_000,
    })

    await expect(
      NousPortalOAuth.requestDeviceCode(portal, {
        fetch: async () =>
          Response.json({
            device_code: "dev_123",
            user_code: "ABCD-EFGH",
            verification_uri: "http://localhost:3000/device",
          }),
      }),
    ).rejects.toThrow()
  })

  test("pollDeviceToken handles authorization_pending, slow_down, x-vercel-mitigated, non-JSON 502, and JWT TTL", async () => {
    const start = 1_700_000_000_000
    let attempt = 0
    const accessToken = jwt({ iat: 1_700_000_000, exp: 1_700_001_200 })
    const device: NousPortalOAuth.DeviceCode = {
      deviceCode: "dev_123",
      userCode: "ABCD-EFGH",
      verificationURI: "https://portal.nousresearch.com/device",
      expiresAt: start + 600_000,
      intervalMs: 5_000,
    }
    const credential = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          NousPortalOAuth.pollDeviceToken(portal, device, {
            now: () => start,
            fetch: async () => {
              attempt += 1
              if (attempt === 1) return Response.json({ error: "authorization_pending" }, { status: 400 })
              if (attempt === 2) return Response.json({ error: "slow_down" }, { status: 400 })
              if (attempt === 3) {
                return new Response("challenge", {
                  status: 403,
                  headers: { "x-vercel-mitigated": "challenge", "retry-after": "15" },
                })
              }
              if (attempt === 4) return new Response("<html>502</html>", { status: 502 })
              return Response.json({
                access_token: accessToken,
                refresh_token: "nous_refresh_1",
                scope: "inference:invoke",
              })
            },
          }),
          { startImmediately: true },
        )
        // Advance through pending (5s) + slow_down (10s) + mitigated Retry-After (15s) + 502 (10s)
        for (const ms of [5_000, 10_000, 15_000, 10_000]) {
          yield* TestClock.adjust(ms)
        }
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(attempt).toBe(5)
    expect(credential).toEqual(
      Credential.OAuth.make({
        type: "oauth",
        methodID: NousPortalOAuth.methodID,
        access: accessToken,
        refresh: "nous_refresh_1",
        expires: start + 1_200_000,
        metadata: { portalBaseURL: portal, scope: "inference:invoke" },
      }),
    )
  })

  test("pollDeviceToken fails safely on terminal OAuth error without leaking body", async () => {
    const start = 1_700_000_000_000
    const device: NousPortalOAuth.DeviceCode = {
      deviceCode: "dev_secret_token",
      userCode: "ABCD",
      verificationURI: "https://portal.nousresearch.com/device",
      expiresAt: start + 60_000,
      intervalMs: 5_000,
    }
    const error = await Effect.runPromise(
      Effect.flip(
        NousPortalOAuth.pollDeviceToken(portal, device, {
          now: () => start,
          fetch: async () =>
            Response.json(
              { error: "access_denied", error_description: "secret-leak-payload dev_secret_token" },
              { status: 400 },
            ),
        }),
      ),
    )
    expect(error.message).toBe("Nous Portal sign-in was denied.")
    expect(error.message).not.toContain("secret-leak-payload")
    expect(error.message).not.toContain("dev_secret_token")
  })

  test("refreshCredential sends x-nous-refresh-token header and classifies transient vs dead errors", async () => {
    const now = 1_700_000_000_000
    const cred = Credential.OAuth.make({
      type: "oauth",
      methodID: NousPortalOAuth.methodID,
      access: "old-nous-access",
      refresh: "secret-nous-refresh",
      expires: now - 1000,
      metadata: { portalBaseURL: portal, custom: "keep" },
    })

    let seenHeader = ""
    let seenBody = ""
    const refreshed = await NousPortalOAuth.refreshCredential(cred, {
      now: () => now,
      fetch: async (_url, init) => {
        seenHeader = new Headers(init?.headers).get("x-nous-refresh-token") ?? ""
        seenBody = String(init?.body ?? "")
        return Response.json({ access_token: "new-nous-access", expires_in: 900 })
      },
    })
    expect(seenHeader).toBe("secret-nous-refresh")
    expect(new URLSearchParams(seenBody).get("grant_type")).toBe("refresh_token")
    expect(new URLSearchParams(seenBody).get("client_id")).toBe("hermes-cli")
    expect(seenBody).not.toContain("secret-nous-refresh")
    expect(refreshed.access).toBe("new-nous-access")
    expect(refreshed.refresh).toBe("secret-nous-refresh")
    expect(refreshed.expires).toBe(now + 900_000)
    expect(refreshed.metadata).toEqual({ portalBaseURL: portal, custom: "keep" })

    // 403 with x-vercel-mitigated stays transient
    await expect(
      NousPortalOAuth.refreshCredential(cred, {
        fetch: async () => new Response("challenge", { status: 403, headers: { "x-vercel-mitigated": "challenge" } }),
      }),
    ).rejects.toBeInstanceOf(NousPortalOAuth.NousTransientError)

    // 503 stays transient
    await expect(
      NousPortalOAuth.refreshCredential(cred, {
        fetch: async () => new Response("upstream down", { status: 503 }),
      }),
    ).rejects.toBeInstanceOf(NousPortalOAuth.NousTransientError)

    // 400 invalid_grant is dead, never leaking token/body
    const dead = await NousPortalOAuth.refreshCredential(cred, {
      fetch: async () =>
        Response.json(
          { error: "refresh_token_reused", error_description: "secret-nous-refresh was reused" },
          { status: 400 },
        ),
    }).catch((err: unknown) => err)
    expect(dead).toBeInstanceOf(NousPortalOAuth.NousGrantDeadError)
    expect(String(dead)).not.toContain("secret-nous-refresh")

    // access-only fails before any network call
    let called = false
    await expect(
      NousPortalOAuth.refreshCredential(
        Credential.OAuth.make({ ...cred, metadata: { shuvcodeAuthImport: "access-only" } }),
        {
          fetch: async () => {
            called = true
            return Response.json({})
          },
        },
      ),
    ).rejects.toThrow("Access-only")
    expect(called).toBe(false)
  })
})
