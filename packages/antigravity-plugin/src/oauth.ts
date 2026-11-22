export * as GoogleSolsticeOAuth from "./oauth"

import { createHash, randomBytes } from "node:crypto"
import { Credential, Integration } from "@opencode/plugin/effect"
import { Option, Schema } from "effect"
import {
  type Fetch,
  isVercelMitigated,
  readBoundedText,
  requestSignal,
  sanitizeErrorCode,
  validateAuthorizeURL,
  validateHttpsOrLoopback,
} from "./url"

export const integrationID = Integration.ID.make("google")
export const methodID = Integration.MethodID.make("google-solstice")
export const legacyMethodID = Integration.MethodID.make("google-ai-pro")
export const callbackPath = "/gemini-auth/callback"

const DEFAULT_TOKEN_TTL_SECONDS = 3600

export type DeadGrantCode = "invalid_grant" | "unauthorized_client"
export const DEAD_GRANT_ERRORS: ReadonlySet<string> = new Set(["invalid_grant", "unauthorized_client"])

export class SolsticeGrantDeadError extends Error {
  readonly _tag = "SolsticeGrantDeadError" as const
  readonly code: DeadGrantCode
  constructor(code: DeadGrantCode, message?: string) {
    super(
      message ??
        `Google (Solstice) authorization was revoked or expired (${code}). Reconnect Google (Solstice) in /connect.`,
    )
    this.name = "SolsticeGrantDeadError"
    this.code = code
  }
}

export class NousAuthRequiredError extends Error {
  readonly _tag = "NousAuthRequiredError" as const
  constructor(message = "Nous Portal sign-in is required. Sign in to Nous Portal in /connect.") {
    super(message)
    this.name = "NousAuthRequiredError"
  }
}

export class SolsticeBrokerTransientError extends Error {
  readonly _tag = "SolsticeBrokerTransientError" as const
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "SolsticeBrokerTransientError"
    this.status = status
  }
}

export type Options = {
  readonly fetch?: Fetch
  readonly now?: () => number
  readonly timeoutMs?: number
}

export type ClientConfig = {
  readonly clientID: string
  readonly authorizeURL: string
  readonly scope: string
}

export type Tokens = {
  readonly access: string
  readonly refresh: string
  readonly expires: number
  readonly scope?: string
}

type CredentialLike = {
  readonly type: string
  readonly methodID?: string
}

export const isSubscription = (credential: CredentialLike | undefined) =>
  credential?.type === "oauth" && credential.methodID === methodID

export const isLegacyAntigravity = (credential: CredentialLike | undefined) =>
  credential?.type === "oauth" && credential.methodID === legacyMethodID

const base64url = (buf: Buffer) => buf.toString("base64url").replace(/=+$/, "")

export const pkce = () => {
  const verifier = base64url(randomBytes(32))
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
  }
}

export const randomState = () => base64url(randomBytes(32))

export const refreshFingerprint = (refreshToken: string) =>
  createHash("sha256").update(refreshToken).digest("hex").slice(0, 12)

const ConfigResponse = Schema.Struct({
  client_id: Schema.String,
  authorize_url: Schema.String,
  scope: Schema.String,
})
const decodeConfig = Schema.decodeUnknownOption(Schema.fromJsonString(ConfigResponse))

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
})
const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(TokenResponse))

const ErrorBody = Schema.Struct({
  error: Schema.optional(Schema.Unknown),
})
const decodeErrorBody = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorBody))

function parseDeadGrantCode(code: string | undefined): DeadGrantCode | undefined {
  if (code === "invalid_grant" || code === "unauthorized_client") return code
  return undefined
}

export async function discoverClient(
  portalBaseURL: string,
  nousAccessToken: string,
  options?: Options,
  signal?: AbortSignal,
): Promise<ClientConfig> {
  const base = validateHttpsOrLoopback(portalBaseURL, "Nous Portal URL")
  const request = options?.fetch ?? fetch
  const response = await request(`${base}/api/oauth/gemini-auth/config`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${nousAccessToken}`,
    },
    signal: requestSignal(signal, options?.timeoutMs),
  }).catch((cause: unknown) => {
    signal?.throwIfAborted()
    throw new SolsticeBrokerTransientError(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Solstice OAuth configuration request timed out"
        : "Solstice OAuth configuration request failed",
    )
  })

  if (response.status === 404) {
    throw new Error("Solstice is not available on this Nous Portal account yet.")
  }
  if (response.status === 401 && !isVercelMitigated(response)) {
    throw new NousAuthRequiredError("Nous Portal sign-in expired. Sign in to Nous Portal again.")
  }
  if (!response.ok) {
    throw new SolsticeBrokerTransientError(
      `Solstice OAuth configuration failed transiently (HTTP ${response.status})`,
      response.status,
    )
  }

  const text = await readBoundedText(response)
  const data = Option.getOrUndefined(decodeConfig(text))
  const clientID = data?.client_id.trim()
  const rawAuthorizeURL = data?.authorize_url.trim()
  const scope = data?.scope.trim().replace(/\s+/g, " ")
  if (!clientID || !rawAuthorizeURL || !scope) {
    throw new Error("Nous Portal returned an invalid Solstice OAuth configuration")
  }
  const validatedURL = validateAuthorizeURL(rawAuthorizeURL, base)
  return {
    clientID,
    authorizeURL: validatedURL.toString(),
    scope,
  }
}

export function buildAuthorizeURL(
  config: ClientConfig,
  params: { readonly redirectURI: string; readonly challenge: string; readonly state: string },
): string {
  const url = new URL(config.authorizeURL)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", config.clientID)
  url.searchParams.set("redirect_uri", params.redirectURI)
  url.searchParams.set("scope", config.scope.trim().replace(/\s+/g, " "))
  url.searchParams.set("code_challenge", params.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("state", params.state)
  return url.toString()
}

export async function exchange(
  portalBaseURL: string,
  nousAccessToken: string,
  input: { readonly code: string; readonly verifier: string; readonly redirectURI: string },
  options?: Options,
  signal?: AbortSignal,
): Promise<Tokens> {
  const base = validateHttpsOrLoopback(portalBaseURL, "Nous Portal URL")
  const request = options?.fetch ?? fetch
  const now = options?.now ?? Date.now
  const response = await request(`${base}/api/oauth/gemini-auth/exchange`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${nousAccessToken}`,
    },
    body: JSON.stringify({
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectURI,
    }),
    signal: requestSignal(signal, options?.timeoutMs),
  }).catch((cause: unknown) => {
    signal?.throwIfAborted()
    throw new SolsticeBrokerTransientError(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Google (Solstice) token exchange timed out"
        : "Google (Solstice) token exchange failed",
    )
  })

  const text = await readBoundedText(response)
  if (response.status === 401 && !isVercelMitigated(response)) {
    throw new NousAuthRequiredError("Nous Portal sign-in expired. Sign in to Nous Portal again.")
  }
  if (!response.ok) {
    const parsed = Option.getOrUndefined(decodeErrorBody(text))
    const code = sanitizeErrorCode(parsed?.error)
    throw new Error(`Google (Solstice) token exchange failed${code ? ` (${code})` : ` (HTTP ${response.status})`}`)
  }

  const data = Option.getOrUndefined(decodeToken(text))
  const access = data?.access_token.trim()
  const refresh = data?.refresh_token?.trim()
  const validExpiry = data?.expires_in === undefined || (Number.isInteger(data.expires_in) && data.expires_in > 0)
  if (!data || !access || !refresh || !validExpiry) {
    throw new Error("Google (Solstice) returned an invalid credential response")
  }
  const scope = data.scope?.trim()
  return {
    access,
    refresh,
    expires: now() + (data.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000,
    ...(scope ? { scope } : {}),
  }
}

export async function refreshCredential(
  value: Credential.OAuth,
  nousAccessToken: string,
  portalBaseURL: string,
  options?: Options,
  signal?: AbortSignal,
): Promise<Credential.OAuth> {
  // Importer deliberately provides no refresh token: fail before any network I/O.
  if (value.metadata?.shuvcodeAuthImport === "access-only") {
    throw new Error("Access-only imported credentials cannot be refreshed; import fresh credentials explicitly")
  }
  if (!value.refresh.trim()) {
    throw new Error("Google (Solstice) is missing a refresh token")
  }
  const base = validateHttpsOrLoopback(portalBaseURL, "Nous Portal URL")
  const request = options?.fetch ?? fetch
  const now = options?.now ?? Date.now

  const response = await request(`${base}/api/oauth/gemini-auth/refresh`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${nousAccessToken}`,
    },
    body: JSON.stringify({ refresh_token: value.refresh }),
    signal: requestSignal(signal, options?.timeoutMs),
  }).catch((cause: unknown) => {
    signal?.throwIfAborted()
    throw new SolsticeBrokerTransientError(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Google (Solstice) token refresh timed out"
        : "Google (Solstice) token refresh network error",
    )
  })

  const text = await readBoundedText(response)

  if (!response.ok) {
    // Only explicit OAuth dead-grant codes mark the Google grant dead; non-JSON proxy pages
    // and broker 5xx/429/edge-challenge responses stay transient.
    const parsed = Option.getOrUndefined(decodeErrorBody(text))
    const code = sanitizeErrorCode(parsed?.error)
    const deadCode = parseDeadGrantCode(code)
    if (deadCode) throw new SolsticeGrantDeadError(deadCode)
    if (response.status === 401 && !isVercelMitigated(response)) {
      throw new NousAuthRequiredError("Nous Portal sign-in expired. Sign in to Nous Portal again.")
    }
    throw new SolsticeBrokerTransientError(
      `Google (Solstice) token refresh failed transiently${code ? ` (${code})` : ` (HTTP ${response.status})`}`,
      response.status,
    )
  }

  const data = Option.getOrUndefined(decodeToken(text))
  const access = data?.access_token.trim()
  const validExpiry = data?.expires_in === undefined || (Number.isInteger(data.expires_in) && data.expires_in > 0)
  if (!data || !access || !validExpiry) {
    throw new SolsticeBrokerTransientError("Google (Solstice) returned an invalid token refresh response")
  }
  const refresh = data.refresh_token?.trim() || value.refresh
  return Credential.OAuth.make({
    ...value,
    access,
    refresh,
    expires: now() + (data.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000,
    metadata: value.metadata,
  })
}
