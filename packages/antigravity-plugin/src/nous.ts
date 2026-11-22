export * as NousPortalOAuth from "./nous"

import { Credential, Integration } from "@opencode/plugin/effect"
import { Clock, Effect, Option, Schema } from "effect"
import {
  DEFAULT_NOUS_PORTAL_URL,
  type Fetch,
  isVercelMitigated,
  readBoundedText,
  requestSignal,
  retryAfterMs,
  sanitizeErrorCode,
  validateHttpsOrLoopback,
} from "./url"

export const integrationID = Integration.ID.make("nous")
export const methodID = Integration.MethodID.make("nous-device")
export const clientID = "hermes-cli"
export const scope = "inference:invoke"
export const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"
export const defaultPortalURL = DEFAULT_NOUS_PORTAL_URL
export const defaultTokenTTLSeconds = 900

const MAX_POLL_INTERVAL_MS = 30_000
const MAX_RETRY_AFTER_MS = 60_000
const DEFAULT_DEVICE_EXPIRES_SECONDS = 600
const DEFAULT_POLL_INTERVAL_SECONDS = 5

export class NousGrantDeadError extends Error {
  readonly _tag = "NousGrantDeadError" as const
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = "NousGrantDeadError"
    this.code = code
  }
}

export class NousTransientError extends Error {
  readonly _tag = "NousTransientError" as const
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "NousTransientError"
    this.status = status
  }
}

export type Options = {
  readonly fetch?: Fetch
  readonly now?: () => number
  readonly timeoutMs?: number
  readonly portalURL?: string
}

export type DeviceCode = {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationURI: string
  readonly verificationURIComplete?: string
  readonly expiresAt: number
  readonly intervalMs: number
}

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
})
const decodeDeviceCode = Schema.decodeUnknownOption(Schema.fromJsonString(DeviceCodeResponse))

const TokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})
const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(TokenResponse))

const JwtClaims = Schema.Struct({
  exp: Schema.optional(Schema.Number),
  iat: Schema.optional(Schema.Number),
})
const decodeJwtClaims = Schema.decodeUnknownOption(Schema.fromJsonString(JwtClaims))

function parseJwtTTLSeconds(accessToken: string, nowMs: number): number | undefined {
  const parts = accessToken.split(".")
  if (parts.length < 2 || !parts[1]) return undefined
  const payload = Buffer.from(parts[1], "base64url").toString("utf8")
  const claims = Option.getOrUndefined(decodeJwtClaims(payload))
  if (!claims || claims.exp === undefined || !Number.isFinite(claims.exp)) return undefined
  if (claims.iat !== undefined && Number.isFinite(claims.iat) && claims.exp > claims.iat) {
    return Math.floor(claims.exp - claims.iat)
  }
  const remaining = Math.floor(claims.exp - nowMs / 1000)
  return remaining > 0 ? remaining : undefined
}

function resolveTTLSeconds(expiresIn: number | undefined, accessToken: string, nowMs: number): number | undefined {
  if (expiresIn !== undefined) {
    if (!Number.isInteger(expiresIn) || expiresIn <= 0) return undefined
    return expiresIn
  }
  return parseJwtTTLSeconds(accessToken, nowMs) ?? defaultTokenTTLSeconds
}

export async function requestDeviceCode(
  portalBaseURL: string,
  options?: Options,
  signal?: AbortSignal,
): Promise<DeviceCode> {
  const base = validateHttpsOrLoopback(portalBaseURL, "Nous Portal URL")
  const request = options?.fetch ?? fetch
  const now = options?.now ?? Date.now
  const { response, text } = await (async () => {
    const res = await request(`${base}/api/oauth/device/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ client_id: clientID, scope }).toString(),
      signal: requestSignal(signal, options?.timeoutMs),
    })
    const body = await readBoundedText(res)
    return { response: res, text: body }
  })().catch((cause: unknown) => {
    signal?.throwIfAborted()
    throw new NousTransientError(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Nous Portal device code request timed out"
        : "Nous Portal device code request failed",
    )
  })
  if (!response.ok) {
    throw new NousTransientError(
      `Nous Portal device authorization failed with HTTP ${response.status}`,
      response.status,
    )
  }
  const data = Option.getOrUndefined(decodeDeviceCode(text))
  const deviceCode = data?.device_code.trim()
  const userCode = data?.user_code.trim()
  if (!data || !deviceCode || !userCode) {
    throw new Error("Nous Portal returned an invalid device authorization response")
  }
  const verificationURI = validateHttpsOrLoopback(data.verification_uri, "Nous Portal verification URL", {
    allowQuery: true,
  })
  const verificationURIComplete = data.verification_uri_complete?.trim()
    ? validateHttpsOrLoopback(data.verification_uri_complete, "Nous Portal verification URL", { allowQuery: true })
    : undefined
  const expiresIn =
    data.expires_in !== undefined && Number.isInteger(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : DEFAULT_DEVICE_EXPIRES_SECONDS
  const intervalSeconds =
    data.interval !== undefined && Number.isFinite(data.interval) && data.interval > 0
      ? Math.max(1, Math.ceil(data.interval))
      : DEFAULT_POLL_INTERVAL_SECONDS
  return {
    deviceCode,
    userCode,
    verificationURI,
    ...(verificationURIComplete ? { verificationURIComplete } : {}),
    expiresAt: now() + expiresIn * 1000,
    intervalMs: intervalSeconds * 1000,
  }
}

export function pollDeviceToken(
  portalBaseURL: string,
  device: DeviceCode,
  options?: Options,
): Effect.Effect<Credential.OAuth, Error> {
  return Effect.gen(function* () {
    const base = yield* Effect.try({
      try: () => validateHttpsOrLoopback(portalBaseURL, "Nous Portal URL"),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    const request = options?.fetch ?? fetch
    const currentTime = () => (options?.now ? Effect.sync(options.now) : Clock.currentTimeMillis)
    let intervalMs = Math.max(100, device.intervalMs)

    while (true) {
      const now = yield* currentTime()
      const remainingMs = device.expiresAt - now
      if (remainingMs <= 0) {
        return yield* Effect.fail(new Error("Nous Portal device sign-in expired. Start sign-in again."))
      }
      const attempt = yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await request(`${base}/api/oauth/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams({
              grant_type: deviceGrantType,
              client_id: clientID,
              device_code: device.deviceCode,
            }).toString(),
            signal: requestSignal(signal, options?.timeoutMs),
          })
          const text = await readBoundedText(response)
          return { response, text }
        },
        catch: () => new NousTransientError("Nous Portal token poll network error"),
      }).pipe(
        Effect.map((value) => ({ ok: true as const, ...value })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )

      if (!attempt.ok) {
        const waitMs = Math.min(intervalMs, Math.max(0, device.expiresAt - (yield* currentTime())))
        if (waitMs <= 0) {
          return yield* Effect.fail(new Error("Nous Portal device sign-in expired. Start sign-in again."))
        }
        yield* Effect.sleep(waitMs)
        continue
      }

      const { response, text } = attempt
      const data = Option.getOrUndefined(decodeToken(text))
      const after = yield* currentTime()

      if (response.ok) {
        const access = data?.access_token?.trim()
        const refresh = data?.refresh_token?.trim()
        const ttl = access ? resolveTTLSeconds(data?.expires_in, access, after) : undefined
        if (!access || !refresh || ttl === undefined) {
          return yield* Effect.fail(new Error("Nous Portal returned an invalid credential response"))
        }
        const tokenScope = data?.scope?.trim()
        return Credential.OAuth.make({
          type: "oauth",
          methodID,
          access,
          refresh,
          expires: after + ttl * 1000,
          metadata: {
            portalBaseURL: base,
            ...(tokenScope ? { scope: tokenScope } : {}),
          },
        })
      }

      const errorCode = sanitizeErrorCode(data?.error)
      if (errorCode === "authorization_pending") {
        const waitMs = Math.min(intervalMs, Math.max(0, device.expiresAt - after))
        if (waitMs <= 0) {
          return yield* Effect.fail(new Error("Nous Portal device sign-in expired. Start sign-in again."))
        }
        yield* Effect.sleep(waitMs)
        continue
      }
      if (errorCode === "slow_down") {
        intervalMs = Math.min(intervalMs + 5_000, MAX_POLL_INTERVAL_MS)
        const waitMs = Math.min(intervalMs, Math.max(0, device.expiresAt - after))
        if (waitMs <= 0) {
          return yield* Effect.fail(new Error("Nous Portal device sign-in expired. Start sign-in again."))
        }
        yield* Effect.sleep(waitMs)
        continue
      }

      const mitigated =
        isVercelMitigated(response) && (response.status === 401 || response.status === 403 || response.status === 429)
      const transientStatus = response.status === 408 || response.status === 429 || response.status >= 500
      if (mitigated || transientStatus) {
        const backoff = retryAfterMs(response, after, MAX_RETRY_AFTER_MS) ?? intervalMs
        const waitMs = Math.min(backoff, Math.max(0, device.expiresAt - after))
        if (waitMs <= 0) {
          return yield* Effect.fail(new Error("Nous Portal device sign-in expired. Start sign-in again."))
        }
        yield* Effect.sleep(waitMs)
        continue
      }

      if (errorCode === "access_denied") {
        return yield* Effect.fail(new Error("Nous Portal sign-in was denied."))
      }
      if (errorCode === "expired_token") {
        return yield* Effect.fail(new Error("Nous Portal device code expired. Start sign-in again."))
      }
      return yield* Effect.fail(
        new Error(`Nous Portal device sign-in failed${errorCode ? ` (${errorCode})` : ` (HTTP ${response.status})`}.`),
      )
    }
  })
}

export async function refreshCredential(
  credential: Credential.OAuth,
  options?: Options,
  signal?: AbortSignal,
): Promise<Credential.OAuth> {
  if (credential.metadata?.shuvcodeAuthImport === "access-only") {
    throw new Error("Access-only imported credentials cannot be refreshed; import fresh credentials explicitly")
  }
  if (!credential.refresh.trim()) {
    throw new NousGrantDeadError("Nous Portal credential is missing a refresh token")
  }
  const metadataPortal =
    typeof credential.metadata?.portalBaseURL === "string" && credential.metadata.portalBaseURL.trim().length > 0
      ? credential.metadata.portalBaseURL
      : undefined
  const base = validateHttpsOrLoopback(metadataPortal ?? options?.portalURL ?? defaultPortalURL, "Nous Portal URL")
  const request = options?.fetch ?? fetch
  const now = options?.now ?? Date.now

  const { response, text } = await (async () => {
    const res = await request(`${base}/api/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        // NAS refresh expects the refresh token in this header rather than the form body.
        "x-nous-refresh-token": credential.refresh,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientID,
      }).toString(),
      signal: requestSignal(signal, options?.timeoutMs),
    })
    const body = await readBoundedText(res)
    return { response: res, text: body }
  })().catch((cause: unknown) => {
    signal?.throwIfAborted()
    throw new NousTransientError(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Nous Portal token refresh timed out"
        : "Nous Portal token refresh network error",
    )
  })

  const data = Option.getOrUndefined(decodeToken(text))

  if (response.ok) {
    const access = data?.access_token?.trim()
    const current = now()
    const ttl = access ? resolveTTLSeconds(data?.expires_in, access, current) : undefined
    if (!access || ttl === undefined) {
      throw new NousTransientError("Nous Portal returned an invalid token refresh response")
    }
    const nextRefresh = data?.refresh_token?.trim() || credential.refresh
    return Credential.OAuth.make({
      ...credential,
      access,
      refresh: nextRefresh,
      expires: current + ttl * 1000,
      metadata: credential.metadata,
    })
  }

  if (isVercelMitigated(response) && (response.status === 401 || response.status === 403 || response.status === 429)) {
    throw new NousTransientError("Nous Portal token refresh was temporarily challenged", response.status)
  }
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    throw new NousTransientError(
      `Nous Portal token refresh failed transiently (HTTP ${response.status})`,
      response.status,
    )
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    const code = sanitizeErrorCode(data?.error)
    throw new NousGrantDeadError(
      `Nous Portal sign-in expired${code ? ` (${code})` : ""}. Sign in to Nous Portal again.`,
      code,
    )
  }
  throw new NousTransientError(`Nous Portal token refresh failed (HTTP ${response.status})`, response.status)
}
