export * as Codex from "./codex.js"

import type { Window } from "./rpc.js"
import { clampPercent, humanizePlan, isRecord, json, jwtPayload, number, record, string, time } from "./shared.js"
import type { FetchOptions, Result, Token } from "./shared.js"

export const id = "codex"
export const name = "ChatGPT"
export const integrationID = "openai"
/** OAuth methods registered by core's OpenAI plugin for ChatGPT Pro/Plus subscriptions. */
export const methodIDs: ReadonlySet<string> = new Set(["chatgpt-browser", "chatgpt-headless"])
export const usageURL = "https://chatgpt.com/backend-api/wham/usage"

const plans: Record<string, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro 20x",
  team: "Team",
  enterprise: "Enterprise",
  business: "Business",
}

const WEEK_SECONDS = 6 * 24 * 60 * 60

function window(raw: unknown, fallback: { id: string; label: string }): Window | undefined {
  const value = record(raw)
  if (!value) return undefined
  const remaining = number(value.remaining_percent)
  const used = number(value.used_percent)
  const percent = remaining ?? (used === undefined ? undefined : 100 - used)
  if (percent === undefined) return undefined
  const seconds = number(value.reset_after_seconds)
  // The live API emits `reset_at` (epoch seconds); older captures used `resets_at`.
  const resetsAt =
    time(value.reset_at ?? value.resets_at) ?? (seconds === undefined ? undefined : Date.now() + seconds * 1000)
  const weekly = (number(value.limit_window_seconds) ?? 0) >= WEEK_SECONDS
  return {
    id: weekly ? "weekly" : fallback.id,
    label: weekly ? "Weekly" : fallback.label,
    remaining: clampPercent(percent),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/** Normalize `GET /backend-api/wham/usage` into windows plus plan. */
export function normalize(raw: unknown): { windows: Window[]; plan?: string } | undefined {
  const root = record(raw)
  if (!root) return undefined
  const usage = record(root.usage) ?? root
  const limit = record(usage.rate_limit)
  const primary = window(limit?.primary_window ?? usage.primary, { id: "session", label: "5h" })
  const secondary = window(limit?.secondary_window ?? usage.secondary, { id: "weekly", label: "Weekly" })
  const windows: Window[] = []
  const seen = new Set<string>()
  for (const item of [primary, secondary]) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    windows.push(item)
  }
  const labeled = labelPlan(string(usage.plan_type) ?? string(root.plan_type))
  if (!windows.length && !labeled) return undefined
  return { windows, ...(labeled ? { plan: labeled } : {}) }
}

function labelPlan(raw: string | undefined) {
  if (!raw) return undefined
  return plans[raw.toLowerCase()] ?? humanizePlan(raw)
}

/** JWT / metadata SKU. Usage `plan_type` wins in fetchQuota except when this is the Nx variant. */
export function plan(token: Token) {
  const payload = jwtPayload(token.access)
  const auth = record(payload?.["https://api.openai.com/auth"])
  return labelPlan(
    string(auth?.chatgpt_plan_type) ??
      string(payload?.chatgpt_plan_type) ??
      string(token.metadata?.chatgpt_plan_type) ??
      string(token.metadata?.planType) ??
      string(token.metadata?.plan_type),
  )
}

export function account(token: Token) {
  return string(token.metadata?.email) ?? string(token.metadata?.accountID)
}

export async function fetchQuota(token: Token, options: FetchOptions = {}): Promise<Result> {
  const accountID = string(token.metadata?.accountID)
  const response = await json(
    usageURL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.access}`,
        accept: "application/json",
        originator: "codex_cli_rs",
        ...(accountID ? { "chatgpt-account-id": accountID } : {}),
      },
    },
    options,
  )
  if (!response.ok) return response
  const normalized = normalize(response.body)
  if (!normalized || !normalized.windows.length) return { ok: false, error: "Quota unavailable" }
  const email = isRecord(response.body) ? string(response.body.email) : undefined
  const label = email ?? account(token)
  const tokenPlan = plan(token)
  // Usage is source of truth, but ChatGPT's usage plan_type is often coarse "pro"
  // while the JWT SKU is "prolite" (Pro 20x). Prefer that Nx SKU like Google/xAI.
  const labeled =
    normalized.plan === "Pro" && tokenPlan && /\d+x$/i.test(tokenPlan) ? tokenPlan : (normalized.plan ?? tokenPlan)
  return {
    ok: true,
    windows: normalized.windows,
    ...(labeled ? { plan: labeled } : {}),
    ...(label ? { account: label } : {}),
  }
}
