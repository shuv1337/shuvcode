import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { GoogleAntigravityOAuth } from "../src/oauth"

const account = {
  access: "fixture-access",
  refresh: "fixture-refresh",
  expires: Date.now() + 3_600_000,
  projectId: "fixture-project",
}

const operations = [
  {
    name: "exchange",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.exchange("code", "verifier", request, signal),
  },
  {
    name: "refresh",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.refresh("refresh", request, signal),
  },
  {
    name: "refreshCredential",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.refreshCredential(
        { type: "oauth", methodID: GoogleAntigravityOAuth.methodID, ...account },
        request,
        signal,
      ),
  },
  {
    name: "loadCodeAssist",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.loadCodeAssist("access", request, signal),
  },
  {
    name: "userinfo",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.fetchUserInfo("access", request, signal),
  },
  {
    name: "discovery",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.fetchAvailableModels("access", "project", request, signal),
  },
  {
    name: "completeAccount refresh",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.completeAccount({ ...account, expires: 1 }, request, signal),
  },
  {
    name: "completeAccount assist",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.completeAccount(account, request, signal),
  },
  {
    name: "completeAccount userinfo",
    run: (request: GoogleAntigravityOAuth.Fetch, signal: AbortSignal) =>
      GoogleAntigravityOAuth.completeAccount(
        account,
        async (url, init) => (url.endsWith(":loadCodeAssist") ? Response.json({}) : request(url, init)),
        signal,
      ),
  },
]

for (const operation of operations) {
  test(`${operation.name}: Effect interruption aborts injected HTTP`, async () => {
    const started = Promise.withResolvers<AbortSignal>()
    const aborted = Promise.withResolvers<unknown>()
    const settled = Promise.withResolvers<unknown>()
    const request: GoogleAntigravityOAuth.Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) throw new Error("missing request signal")
        signal.addEventListener(
          "abort",
          () => {
            aborted.resolve(signal.reason)
            reject(signal.reason)
          },
          { once: true },
        )
        started.resolve(signal)
      })
    const fiber = Effect.runFork(
      Effect.tryPromise({
        try: (signal) =>
          operation.run(request, signal).then(
            () => {
              settled.resolve("unexpected success")
            },
            (error) => {
              settled.resolve(error)
              throw error
            },
          ),
        catch: (error) => error,
      }),
    )
    const signal = await started.promise
    expect(signal.aborted).toBe(false)
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(signal.aborted).toBe(true)
    expect(await settled.promise).toBe(await aborted.promise)
  })

  test(`${operation.name}: already cancelled caller does not reach HTTP`, async () => {
    const reason = new Error("cancelled")
    let calls = 0
    await expect(
      operation.run(async () => {
        calls++
        return Response.json({})
      }, AbortSignal.abort(reason)),
    ).rejects.toBe(reason)
    expect(calls).toBe(0)
  })
}

for (const body of [
  "secret-access secret-refresh authorization-code",
  JSON.stringify({ error: "invalid_grant", error_description: "secret-access", access_token: "secret-access" }),
  JSON.stringify({ error: "secret-refresh" }),
  "<html>secret-access</html>",
]) {
  test("token errors expose status only, never OAuth response content", async () => {
    await expect(
      GoogleAntigravityOAuth.exchange("code", "verifier", async () => new Response(body, { status: 400 })),
    ).rejects.toThrow(/^Google OAuth failed with HTTP 400$/)
  })
}

for (const expires of [0, -1, 0.5, NaN, Infinity, "3600", null]) {
  test(`rejects malformed expires_in: ${String(expires)}`, async () => {
    // An injected json boundary preserves NaN/Infinity rather than JSON's null conversion.
    const response = new Response()
    response.json = async () => ({ access_token: "access", expires_in: expires })
    await expect(GoogleAntigravityOAuth.refresh("refresh", async () => response)).rejects.toThrow(
      "invalid credential response",
    )
  })
}

for (const access of ["", "   ", null]) {
  test(`rejects empty access token: ${JSON.stringify(access)}`, async () => {
    await expect(
      GoogleAntigravityOAuth.refresh("refresh", async () => Response.json({ access_token: access, expires_in: 3600 })),
    ).rejects.toThrow("invalid credential response")
  })
}

test("malformed successful token JSON cannot leak response snippets", async () => {
  await expect(
    GoogleAntigravityOAuth.refresh("refresh", async () => new Response("secret-access not JSON")),
  ).rejects.toThrow(/^Google OAuth returned an invalid credential response$/)
})

test("omitted expiry retains the default; positive integer expiry is accepted", async () => {
  for (const expires of [undefined, 60]) {
    const before = Date.now()
    const result = await GoogleAntigravityOAuth.refresh("refresh", async () =>
      Response.json({ access_token: "access", expires_in: expires }),
    )
    expect(result.expires).toBeGreaterThanOrEqual(before + (expires ?? 3600) * 1000)
  }
})

test("non-cancellation assist/userinfo failures still allow supplied project fallback", async () => {
  const result = await GoogleAntigravityOAuth.completeAccount(account, async () => new Response(null, { status: 503 }))
  expect(result.projectId).toBe(account.projectId)
  expect(result.email).toBeUndefined()
})
