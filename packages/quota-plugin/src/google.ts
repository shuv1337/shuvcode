export * as Google from "./google.js"

import type { Window } from "./rpc.js"
import { clampPercent, humanizePlan, json, number, record, string, time } from "./shared.js"
import type { FetchOptions, Result, Token } from "./shared.js"

export const id = "google"
export const name = "Google"
export const integrationID = "google"
/** OAuth method registered by the bundled Antigravity plugin for Google AI Pro subscriptions. */
export const methodIDs: ReadonlySet<string> = new Set(["google-ai-pro"])
export const cloudCodeEndpoint = "https://daily-cloudcode-pa.googleapis.com"

// Mirrors the Antigravity CLI identity the bundled OAuth plugin already presents.
const cliVersion = "1.1.13"
const cliCL = "964361259"
const userAgent = `antigravity/cli/${cliVersion} (aidev_client; os_type=linux; arch=amd64; cl=${cliCL}; auth_method=consumer)`

const tiers: Record<string, string> = {
  "g1-pro-tier": "Google AI Pro",
  "g1-ultra-tier": "Google AI Ultra",
}

function groupPrefix(group: Record<string, unknown>, index: number) {
  const text = (string(group.displayName) ?? string(group.display_name) ?? string(group.id) ?? "").toLowerCase()
  if (text.includes("gemini")) return { id: "gemini", label: "Gemini" }
  if (text.includes("claude") || text.includes("gpt")) return { id: "3p", label: "Claude+GPT" }
  const label = string(group.displayName) ?? string(group.display_name) ?? `Models ${index + 1}`
  return { id: string(group.id) ?? `group-${index}`, label }
}

function windowSuffix(bucket: Record<string, unknown>) {
  const raw = (string(bucket.window) ?? "").toLowerCase()
  if (raw === "5h") return { id: "5h", label: "5h" }
  if (raw === "weekly") return { id: "weekly", label: "weekly" }
  const label = string(bucket.displayName) ?? string(bucket.display_name) ?? raw
  return { id: raw || string(bucket.bucketId) || string(bucket.bucket_id) || "limit", label: label || "limit" }
}

/** Normalize `retrieveUserQuotaSummary` into one window per group bucket. */
export function normalize(raw: unknown): { windows: Window[]; plan?: string } | undefined {
  const root = record(raw)
  if (!root || !Array.isArray(root.groups)) return undefined
  const windows: Window[] = []
  const seen = new Set<string>()
  root.groups.forEach((rawGroup, index) => {
    const group = record(rawGroup)
    if (!group || !Array.isArray(group.buckets)) return
    const prefix = groupPrefix(group, index)
    for (const rawBucket of group.buckets) {
      const bucket = record(rawBucket)
      if (!bucket) continue
      const fraction = number(bucket.remainingFraction ?? bucket.remaining_fraction)
      if (fraction === undefined) continue
      const suffix = windowSuffix(bucket)
      const id = `${prefix.id}:${suffix.id}`
      if (seen.has(id)) continue
      seen.add(id)
      const resetsAt = time(bucket.resetTime ?? bucket.reset_time)
      windows.push({
        id,
        label: `${prefix.label} ${suffix.label}`,
        remaining: clampPercent(fraction * 100),
        ...(resetsAt === undefined ? {} : { resetsAt }),
      })
    }
  })
  const tier = string(root.paidTier) ?? string(root.paid_tier)
  const plan = tier ? (tiers[tier] ?? humanizePlan(tier)) : undefined
  if (!windows.length) return undefined
  return { windows, ...(plan ? { plan } : {}) }
}

export function projectId(token: Token) {
  return string(token.metadata?.projectId)
}

export function plan(token: Token) {
  const tier = string(token.metadata?.paidTier)
  return tier ? (tiers[tier] ?? humanizePlan(tier)) : undefined
}

export function account(token: Token) {
  return string(token.metadata?.email)
}

function cloudCode(token: Token, path: string, body: unknown, options: FetchOptions) {
  return json(
    `${cloudCodeEndpoint}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access}`,
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    options,
  )
}

/** Resolve a Cloud Code project id when the stored credential omitted one. */
export async function loadProjectId(token: Token, options: FetchOptions = {}) {
  const response = await cloudCode(token, "/v1internal:loadCodeAssist", { metadata: { ideType: "ANTIGRAVITY" } }, options)
  if (!response.ok) return undefined
  const data = record(response.body)
  const project = data?.cloudaicompanionProject
  const projectRecord = record(project)
  return string(project) ?? string(projectRecord?.id) ?? string(projectRecord?.name)
}

export async function fetchQuota(token: Token, options: FetchOptions = {}): Promise<Result> {
  const project = projectId(token) ?? (await loadProjectId(token, options))
  if (!project) return { ok: false, error: "Missing Cloud Code project id" }
  const response = await cloudCode(token, "/v1internal:retrieveUserQuotaSummary", { project }, options)
  if (!response.ok) return response
  const normalized = normalize(response.body)
  if (!normalized) return { ok: false, error: "Quota unavailable" }
  const tier = normalized.plan ?? plan(token)
  const label = account(token)
  return { ok: true, windows: normalized.windows, ...(tier ? { plan: tier } : {}), ...(label ? { account: label } : {}) }
}
