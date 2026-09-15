export * as GoogleAntigravityOAuth from "./oauth"

import { createHash, randomBytes } from "node:crypto"
import { Credential, Integration } from "@opencode/plugin/effect"
import { Option, Schema } from "effect"

export const methodID = Integration.MethodID.make("google-ai-pro")
export const integrationID = Integration.ID.make("google")

/** Official Antigravity CLI client, extracted from `agy` 1.1.13. */
export const clientID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
const clientSecret = "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"
export const callbackPort = 36742
export const redirectURI = `http://localhost:${callbackPort}/oauth-callback`
export const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
export const tokenEndpoint = "https://oauth2.googleapis.com/token"
export const userInfoEndpoint = "https://www.googleapis.com/oauth2/v2/userinfo"
export const cloudCodeEndpoint = "https://daily-cloudcode-pa.googleapis.com"
export const scopes = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
] as const

const cliVersion = "1.1.13"
const cliCL = "964361259"

export type Tokens = {
  access: string
  refresh: string
  expires: number
}

export type AccountInfo = {
  projectId?: string
  email?: string
  paidTier?: string
}

export type AccountTokens = {
  refresh: string
  access?: string
  expires?: number
  projectId?: string
  email?: string
}

export type CompletedAccount = Tokens & {
  projectId: string
  email?: string
  paidTier?: string
}

export type CatalogModel = {
  id: string
  name?: string
  modelEnum?: string
  provider?: string
  internal?: boolean
  recommended?: boolean
}

type CredentialLike = {
  readonly type: string
  readonly methodID?: string
}

export const isSubscription = (credential: CredentialLike | undefined) =>
  credential?.type === "oauth" && credential.methodID === methodID

export const projectId = (metadata: Readonly<Record<string, unknown>> | undefined) => {
  const value = metadata?.projectId
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
const decodeToken = Schema.decodeUnknownOption(TokenResponse)

const osType = () => {
  if (process.platform === "darwin") return "darwin"
  if (process.platform === "win32") return "windows"
  return "linux"
}

const archType = () => {
  if (process.arch === "arm64") return "arm64"
  return "amd64"
}

export const userAgent = () =>
  `antigravity/cli/${cliVersion} (aidev_client; os_type=${osType()}; arch=${archType()}; cl=${cliCL}; auth_method=consumer)`

const base64url = (buf: Buffer) => buf.toString("base64url").replace(/=+$/, "")

export const pkce = () => {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) }
}

export const authorizeURL = (challenge: string, state: string) =>
  `${authorizeEndpoint}?${new URLSearchParams({
    response_type: "code",
    client_id: clientID,
    redirect_uri: redirectURI,
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state,
  })}`

export const nextRefresh = (current: string, returned?: string) => returned || current

function tokensFrom(data: typeof TokenResponse.Type, currentRefresh?: string): Tokens {
  const refresh = nextRefresh(currentRefresh ?? "", data.refresh_token)
  if (!refresh) throw new Error("Google OAuth returned no refresh token")
  return {
    access: data.access_token,
    refresh,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

async function token(
  body: URLSearchParams,
  currentRefresh?: string,
  request: Fetch = fetch,
  signal?: AbortSignal,
): Promise<Tokens> {
  const response = await request(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent() },
    body: body.toString(),
    signal: requestSignal(signal),
  })
  // OAuth bodies may echo credentials; never include provider-controlled details.
  if (!response.ok) throw new Error(`Google OAuth failed with HTTP ${response.status}`)
  const data = Option.getOrUndefined(
    decodeToken(
      await response.json().catch(() => {
        signal?.throwIfAborted()
        // JSON parser errors can include a snippet of the credential response too.
        throw new Error("Google OAuth returned an invalid credential response")
      }),
    ),
  )
  if (
    !data ||
    !data.access_token.trim() ||
    (data.expires_in !== undefined && (!Number.isInteger(data.expires_in) || data.expires_in <= 0))
  ) {
    throw new Error("Google OAuth returned an invalid credential response")
  }
  return tokensFrom(data, currentRefresh)
}

function requestSignal(signal?: AbortSignal) {
  signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(8_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export const exchange = (code: string, verifier: string, request: Fetch = fetch, signal?: AbortSignal) =>
  token(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientID,
      client_secret: clientSecret,
      redirect_uri: redirectURI,
    }),
    undefined,
    request,
    signal,
  )

export const refresh = (refreshToken: string, request: Fetch = fetch, signal?: AbortSignal) =>
  token(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientID,
      client_secret: clientSecret,
    }),
    refreshToken,
    request,
    signal,
  )

export async function refreshCredential(value: Credential.OAuth, request: Fetch = fetch, signal?: AbortSignal) {
  // Importer deliberately provides no refresh token: fail before any network I/O.
  if (value.metadata?.shuvcodeAuthImport === "access-only") {
    throw new Error("Access-only imported credentials cannot be refreshed; import fresh credentials explicitly")
  }
  if (!value.refresh) throw new Error("Google AI Pro is missing a refresh token")
  const tokens = await refresh(value.refresh, request, signal)
  return Credential.OAuth.make({
    ...value,
    ...tokens,
    metadata: value.metadata,
  })
}

async function cloudCode<A>(path: string, access: string, body: unknown, request: Fetch, signal?: AbortSignal) {
  const response = await request(`${cloudCodeEndpoint}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent(),
    },
    body: JSON.stringify(body),
    signal: requestSignal(signal),
  })
  if (!response.ok) throw new Error(`Cloud Code ${path} failed with HTTP ${response.status}`)
  return (await response.json()) as A
}

const stringField = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)

const record = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

export async function loadCodeAssist(
  access: string,
  request: Fetch = fetch,
  signal?: AbortSignal,
): Promise<AccountInfo> {
  const data = record(
    await cloudCode<unknown>(
      "/v1internal:loadCodeAssist",
      access,
      { metadata: { ideType: "ANTIGRAVITY" } },
      request,
      signal,
    ),
  )
  if (!data) return {}
  const project = data.cloudaicompanionProject
  const projectRecord = record(project)
  const paid = data.paidTier
  const paidRecord = record(paid)
  return {
    projectId: stringField(project) ?? stringField(projectRecord?.id) ?? stringField(projectRecord?.name),
    paidTier: stringField(paid) ?? stringField(paidRecord?.id) ?? stringField(paidRecord?.name),
  }
}

export async function fetchUserInfo(access: string, request: Fetch = fetch, signal?: AbortSignal) {
  const response = await request(userInfoEndpoint, {
    headers: { Authorization: `Bearer ${access}`, "User-Agent": userAgent() },
    signal: requestSignal(signal),
  })
  if (!response.ok) return
  const data = record(await response.json())
  return { email: stringField(data?.email) }
}

export function parseCatalogModels(payload: unknown): CatalogModel[] {
  const data = record(payload)
  const list = [data?.models, data?.availableModels, data?.model].find(Array.isArray)
  if (!list) return []
  return list.flatMap((item) => {
    const model = record(item)
    if (!model) return []
    const id = stringField(model.id) ?? stringField(model.name) ?? stringField(model.modelId)
    if (!id) return []
    return [
      {
        id,
        name: stringField(model.displayName) ?? stringField(model.display_name) ?? stringField(model.name),
        modelEnum: stringField(model.model) ?? stringField(model.model_enum) ?? stringField(model.modelEnum),
        provider: stringField(model.modelProvider) ?? stringField(model.model_provider),
        internal: model.isInternal === true || model.is_internal === true,
        recommended: model.recommended === true,
      },
    ]
  })
}

export async function fetchAvailableModels(
  access: string,
  project: string,
  request: Fetch = fetch,
  signal?: AbortSignal,
) {
  return parseCatalogModels(
    await cloudCode<unknown>("/v1internal:fetchAvailableModels", access, { project }, request, signal),
  )
}

export async function completeAccount(
  input: AccountTokens | Tokens,
  request: Fetch = fetch,
  signal?: AbortSignal,
): Promise<CompletedAccount> {
  signal?.throwIfAborted()
  const access = "access" in input ? input.access : undefined
  const expires = "expires" in input ? input.expires : undefined
  const tokens =
    access && expires && expires > Date.now() + 60_000
      ? { access, refresh: input.refresh, expires }
      : await refresh(input.refresh, request, signal)
  const assist = await loadCodeAssist(tokens.access, request, signal).catch(() => ({}) as AccountInfo)
  signal?.throwIfAborted()
  const project = assist.projectId ?? ("projectId" in input ? input.projectId : undefined)
  if (!project) throw new Error("Google AI Pro did not return a Cloud Code project id")
  const email =
    ("email" in input ? input.email : undefined) ??
    (await fetchUserInfo(tokens.access, request, signal).catch(() => undefined))?.email
  signal?.throwIfAborted()
  return {
    ...tokens,
    projectId: project,
    email,
    paidTier: assist.paidTier,
  }
}
