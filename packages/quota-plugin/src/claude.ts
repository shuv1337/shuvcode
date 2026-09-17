export * as Claude from "./claude.js"

import type { Window } from "./rpc.js"
import { clampPercent, humanizePlan, json, number, percentUsed, record, string, time } from "./shared.js"
import type { FetchOptions, Result, Token } from "./shared.js"

export const id = "claude"
export const name = "Claude"
export const integrationID = "anthropic"
/** OAuth method registered by the bundled Claude plugin for Pro/Max subscriptions. */
export const methodIDs: ReadonlySet<string> = new Set(["claude-pro-max"])
export const usageURL = "https://api.anthropic.com/api/oauth/usage"
const version = "2023-06-01"
const beta = "oauth-2025-04-20"

const plans: Record<string, string> = {
  pro: "Pro",
  claude_pro: "Pro",
  max: "Max",
  claude_max: "Max",
  default_claude_max: "Max",
  default_claude_pro: "Pro",
  default_claude_max_5x: "Max 5x",
  default_claude_max_20x: "Max 20x",
  claude_max_5x: "Max 5x",
  claude_max_20x: "Max 20x",
  max_5x: "Max 5x",
  max_20x: "Max 20x",
}

function utilization(raw: unknown, id: string, label: string): Window | undefined {
  const value = record(raw)
  if (!value) return undefined
  const remainingPercent = number(value.remaining_percent)
  const used = percentUsed(value.utilization ?? value.used_percent)
  const remaining = remainingPercent ?? (used === undefined ? undefined : 100 - used)
  if (remaining === undefined) return undefined
  const resetsAt = time(value.resets_at ?? value.reset_at)
  return { id, label, remaining: clampPercent(remaining), ...(resetsAt === undefined ? {} : { resetsAt }) }
}

function scopedName(scope: unknown): string | undefined {
  const value = record(scope)
  if (!value) return undefined
  const model = value.model
  if (typeof model === "string") return model
  const modelRecord = record(model)
  const modelName = string(modelRecord?.display_name) ?? string(modelRecord?.name) ?? string(modelRecord?.id)
  if (modelName) return modelName
  const surface = value.surface
  if (typeof surface === "string") return surface
  const surfaceRecord = record(surface)
  return string(surfaceRecord?.display_name) ?? string(surfaceRecord?.name) ?? string(surfaceRecord?.id)
}

function limitWindow(raw: unknown): Window | undefined {
  const value = record(raw)
  if (!value) return undefined
  const kind = string(value.kind) ?? ""
  const group = string(value.group) ?? ""
  const scoped = scopedName(value.scope)
  const descriptor = (() => {
    if (scoped) {
      const label = humanizePlan(scoped)
      const weekly = group === "weekly" || kind.startsWith("weekly")
      return { id: `model:${label.toLowerCase()}:${weekly ? "weekly" : group || kind || "scoped"}`, label: weekly ? `${label} weekly` : label }
    }
    if (group === "session" || kind === "session") return { id: "session", label: "5h" }
    if (kind === "weekly_all" || (group === "weekly" && !value.scope)) return { id: "weekly", label: "Weekly" }
    const fallback = humanizePlan(kind || group || "limit")
    return { id: `${group || "limit"}:${kind || fallback.toLowerCase()}`, label: fallback }
  })()
  return utilization(
    { ...value, utilization: value.percent ?? value.utilization ?? value.used_percent },
    descriptor.id,
    descriptor.label,
  )
}

/** Normalize `GET /api/oauth/usage` into windows. Model-scoped weekly limits follow the shared ones. */
export function normalize(raw: unknown): Window[] {
  const root = record(raw)
  if (!root) return []
  const usage = record(root.usage) ?? root
  const windows: Window[] = []
  const seen = new Set<string>()
  const push = (item: Window | undefined) => {
    if (!item || seen.has(item.id)) return
    seen.add(item.id)
    windows.push(item)
  }
  push(utilization(usage.five_hour, "session", "5h"))
  push(utilization(usage.seven_day, "weekly", "Weekly"))
  for (const key of Object.keys(usage)) {
    const match = key.match(/^seven_day_(.+)$/)
    if (!match) continue
    const model = humanizePlan(match[1])
    push(utilization(usage[key], `model:${model.toLowerCase()}:weekly`, `${model} weekly`))
  }
  if (Array.isArray(usage.limits)) for (const limit of usage.limits) push(limitWindow(limit))
  return windows
}

export function plan(token: Token) {
  const raw = string(token.metadata?.subscriptionType) ?? string(token.metadata?.rateLimitTier)
  if (!raw) return undefined
  return plans[raw.toLowerCase()] ?? humanizePlan(raw)
}

export function account(token: Token) {
  return string(token.metadata?.email)
}

export async function fetchQuota(token: Token, options: FetchOptions = {}): Promise<Result> {
  const response = await json(
    usageURL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.access}`,
        accept: "application/json",
        "anthropic-version": version,
        "anthropic-beta": beta,
      },
    },
    options,
  )
  if (!response.ok) return response
  const windows = normalize(response.body)
  if (!windows.length) return { ok: false, error: "Quota unavailable" }
  const tier = plan(token)
  const label = account(token)
  return { ok: true, windows, ...(tier ? { plan: tier } : {}), ...(label ? { account: label } : {}) }
}
