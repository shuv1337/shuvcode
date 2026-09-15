import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Effect, Option, Schema } from "effect"

export const methodID = IntegrationMethodID.make("claude-pro-max")
export const integrationID = "anthropic"
export const userAgent = "claude-cli/2.1.260 (external, cli)"
const clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const redirectURI = "https://platform.claude.com/oauth/code/callback"
const tokenEndpoint = "https://platform.claude.com/v1/oauth/token"

export type Network = (url: string, init: RequestInit) => Promise<Response>
export type Options = { fetch?: Network; now?: () => number }

export function isSubscription(value: Credential.Value | undefined) {
  return value?.type === "oauth" ? value.methodID === methodID : value?.key.startsWith("sk-ant-oat") === true
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")

export async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function authorizeURL(challenge: string, state: string) {
  return `https://claude.ai/oauth/authorize?${new URLSearchParams({
    code: "true",
    response_type: "code",
    client_id: clientID,
    redirect_uri: redirectURI,
    scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })}`
}

/** The callback page renders code#state. A pasted state must match this authorization. */
export function parseCode(raw: string, state: string) {
  const parts = raw.trim().split("#")
  if (!parts[0] || parts.length > 2 || (parts.length === 2 && parts[1] !== state))
    throw new Error("Invalid Claude authorization code or state")
  return parts[0]
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String.check(Schema.isMinLength(1)),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
})

async function token(body: URLSearchParams, options: Options, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const response = await (options.fetch ?? fetch)(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent },
    body: body.toString(),
    signal,
  })
  if (!response.ok) throw new Error(`Claude OAuth failed with HTTP ${response.status}`)
  const data = Option.getOrUndefined(Schema.decodeUnknownOption(TokenResponse)(await response.json()))
  if (!data) throw new Error("Claude OAuth returned an invalid credential response")
  return {
    access: data.access_token,
    refresh: data.refresh_token ?? "",
    expires: Math.floor((options.now ?? Date.now)() + data.expires_in * 1000),
  }
}

export async function exchange(code: string, verifier: string, options: Options = {}, signal?: AbortSignal) {
  const tokens = await token(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: parseCode(code, verifier),
      code_verifier: verifier,
      client_id: clientID,
      redirect_uri: redirectURI,
      state: verifier,
    }),
    options,
    signal,
  )
  if (!tokens.refresh) throw new Error("Claude OAuth returned no refresh token")
  return Credential.OAuth.make({ type: "oauth", methodID, ...tokens })
}

export function refresh(value: Credential.OAuth, options: Options = {}) {
  return Effect.tryPromise({
    try: async (signal) => {
      // Defense in depth: imported access-only credentials must never rotate the live account's refresh token.
      if (value.metadata?.shuvcodeAuthImport === "access-only")
        throw new Error("Claude access-only import cannot refresh; re-import a fresh access token")
      if (value.methodID !== methodID || !value.refresh)
        throw new Error("Claude OAuth requires a native refresh credential")
      const tokens = await token(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: value.refresh,
          client_id: clientID,
        }),
        options,
        signal,
      )
      return Credential.OAuth.make({ ...value, ...tokens, refresh: tokens.refresh || value.refresh })
    },
    catch: (cause) => cause,
  })
}
