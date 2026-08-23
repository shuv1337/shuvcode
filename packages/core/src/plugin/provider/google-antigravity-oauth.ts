export * as GoogleAntigravityOAuth from "./google-antigravity-oauth"

import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import { Integration } from "../../integration"
import { Global } from "@opencode-ai/util/global"

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

export type ImportedAccount = {
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
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

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

async function token(body: URLSearchParams, currentRefresh?: string): Promise<Tokens> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent() },
    body: body.toString(),
    signal: AbortSignal.timeout(8_000),
  })
  // Google reports the actionable reason (invalid_grant, invalid_client) only in the body,
  // so a status-only message leaves the user with nothing to act on.
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Google OAuth failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`)
  }
  const data = Option.getOrUndefined(decodeToken(await response.json()))
  if (!data) throw new Error("Google OAuth returned an invalid credential response")
  return tokensFrom(data, currentRefresh)
}

export const exchange = (code: string, verifier: string) =>
  token(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientID,
      client_secret: clientSecret,
      redirect_uri: redirectURI,
    }),
  )

export const refresh = (refreshToken: string) =>
  token(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientID,
      client_secret: clientSecret,
    }),
    refreshToken,
  )

async function cloudCode<A>(path: string, access: string, body: unknown) {
  const response = await fetch(`${cloudCodeEndpoint}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Cloud Code ${path} failed with HTTP ${response.status}`)
  return (await response.json()) as A
}

const stringField = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)

const record = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

export async function loadCodeAssist(access: string): Promise<AccountInfo> {
  const data = record(
    await cloudCode<unknown>("/v1internal:loadCodeAssist", access, { metadata: { ideType: "ANTIGRAVITY" } }),
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

export async function fetchUserInfo(access: string) {
  const response = await fetch(userInfoEndpoint, {
    headers: { Authorization: `Bearer ${access}`, "User-Agent": userAgent() },
    signal: AbortSignal.timeout(8_000),
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

export async function fetchAvailableModels(access: string, project: string) {
  return parseCatalogModels(await cloudCode<unknown>("/v1internal:fetchAvailableModels", access, { project }))
}

export function splitRefresh(value: string) {
  const index = value.indexOf("|")
  if (index <= 0) return { refresh: value }
  return { refresh: value.slice(0, index), projectId: value.slice(index + 1) || undefined }
}

export function parseV1Accounts(text: string): ImportedAccount | undefined {
  const parsed = Option.getOrUndefined(decodeJson(text))
  const data = record(parsed)
  if (!data || !Array.isArray(data.accounts) || data.accounts.length === 0) return
  const index = typeof data.activeIndex === "number" && data.activeIndex >= 0 ? data.activeIndex : 0
  const account = record(data.accounts[index] ?? data.accounts[0])
  const refreshToken = stringField(account?.refreshToken) ?? stringField(account?.refresh_token)
  if (!refreshToken) return
  const parts = splitRefresh(refreshToken)
  return {
    refresh: parts.refresh,
    projectId: stringField(account?.projectId) ?? stringField(account?.project_id) ?? parts.projectId,
    email: stringField(account?.email),
  }
}

function tokenFields(value: unknown): ImportedAccount | undefined {
  const data = record(value)
  if (!data) return
  const refreshToken = stringField(data.refresh_token) ?? stringField(data.refreshToken) ?? stringField(data.refresh)
  if (!refreshToken) return
  const parts = splitRefresh(refreshToken)
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined
  const expiry =
    typeof data.expiry_date === "number"
      ? data.expiry_date
      : typeof data.expires === "number"
        ? data.expires
        : undefined
  return {
    refresh: parts.refresh,
    access: stringField(data.access_token) ?? stringField(data.accessToken) ?? stringField(data.access),
    expires: expiry ?? (expiresIn ? Date.now() + expiresIn * 1000 : undefined),
    projectId: stringField(data.projectId) ?? stringField(data.project_id) ?? parts.projectId,
    email: stringField(data.email),
  }
}

export function parseOAuthTokenBlob(value: string): ImportedAccount | undefined {
  const direct = tokenFields(Option.getOrUndefined(decodeJson(value)))
  if (direct) return direct
  const decoded = Buffer.from(value, "base64").toString("utf8")
  const fromDecoded = tokenFields(Option.getOrUndefined(decodeJson(decoded)))
  if (fromDecoded) return fromDecoded
  const matches = decoded.match(/\{[^{}]+\}/g) ?? value.match(/\{[^{}]+\}/g) ?? []
  for (const match of matches) {
    const found = tokenFields(Option.getOrUndefined(decodeJson(match)))
    if (found) return found
  }
  return
}

export function antigravityStatePaths(home = os.homedir()) {
  if (process.platform === "darwin")
    return [path.join(home, "Library/Application Support/Antigravity/User/globalStorage/state.vscdb")]
  if (process.platform === "win32")
    return [
      path.join(
        process.env.APPDATA ?? path.join(home, "AppData/Roaming"),
        "Antigravity/User/globalStorage/state.vscdb",
      ),
    ]
  return [
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "Antigravity/User/globalStorage/state.vscdb"),
  ]
}

async function importFromVscdb(statePath: string): Promise<ImportedAccount | undefined> {
  const sqlite = await import("bun:sqlite")
  const db = new sqlite.Database(statePath, { readonly: true })
  const row = db.query("SELECT value FROM ItemTable WHERE key = ?").get("antigravityUnifiedStateSync.oauthToken") as {
    value?: string
  } | null
  db.close()
  if (typeof row?.value !== "string") return
  return parseOAuthTokenBlob(row.value)
}

async function importFromV1(dataDir: string): Promise<ImportedAccount | undefined> {
  const text = await fs.readFile(path.join(dataDir, "antigravity-accounts.json"), "utf8")
  return parseV1Accounts(text)
}

export async function importExisting(options?: { dataDir?: string; statePaths?: string[] }) {
  for (const statePath of options?.statePaths ?? antigravityStatePaths()) {
    const imported = await importFromVscdb(statePath).catch(() => undefined)
    if (imported) return imported
  }
  return importFromV1(options?.dataDir ?? Global.Path.data).catch(() => undefined)
}

export async function completeAccount(input: ImportedAccount | Tokens): Promise<CompletedAccount> {
  const access = "access" in input ? input.access : undefined
  const expires = "expires" in input ? input.expires : undefined
  const tokens =
    access && expires && expires > Date.now() + 60_000
      ? { access, refresh: input.refresh, expires }
      : await refresh(input.refresh)
  const assist = await loadCodeAssist(tokens.access).catch(() => ({}) as AccountInfo)
  const project = assist.projectId ?? ("projectId" in input ? input.projectId : undefined)
  if (!project) throw new Error("Google AI Pro did not return a Cloud Code project id")
  const email =
    ("email" in input ? input.email : undefined) ?? (await fetchUserInfo(tokens.access).catch(() => undefined))?.email
  return {
    ...tokens,
    projectId: project,
    email,
    paidTier: assist.paidTier,
  }
}
