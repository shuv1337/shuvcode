export * as XAI from "./xai.js"

import type { Window } from "./rpc.js"
import { clampPercent, json, jwtPayload, number, record, string, time } from "./shared.js"
import type { FetchOptions, Result, Token } from "./shared.js"

export const id = "xai"
export const name = "xAI"
export const integrationID = "xai"
/** OAuth methods registered by core's xAI plugin for SuperGrok subscriptions. */
export const methodIDs: ReadonlySet<string> = new Set(["device", "browser"])
export const billingURL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"

/** Known SuperGrok JWT tier numbers. Unknown tiers fall back to "Tier N". */
const tiers: Record<number, string> = {
  0: "SuperGrok",
  1: "SuperGrok",
  2: "SuperGrok",
  3: "SuperGrok",
  4: "SuperGrok",
  5: "SuperGrok Heavy",
}

function periodLabel(type: string | undefined) {
  if (!type) return "Credits"
  if (type.includes("WEEKLY")) return "Weekly"
  if (type.includes("MONTHLY")) return "Monthly"
  if (type.includes("DAILY")) return "Daily"
  return "Credits"
}

function periodID(type: string | undefined) {
  if (!type) return "credits"
  if (type.includes("WEEKLY")) return "weekly"
  if (type.includes("MONTHLY")) return "monthly"
  if (type.includes("DAILY")) return "daily"
  return "credits"
}

function confirmedZeroUsage(config: Record<string, unknown>, period: Record<string, unknown> | undefined) {
  return (
    period?.type === "USAGE_PERIOD_TYPE_WEEKLY" &&
    Date.parse(String(period.start)) === Date.parse(String(config.billingPeriodStart)) &&
    Date.parse(String(period.end)) === Date.parse(String(config.billingPeriodEnd))
  )
}

/** Normalize `GET /v1/billing?format=credits` into a single credit window. */
export function normalize(raw: unknown): Window[] {
  const root = record(raw)
  const config = record(root?.config)
  if (!config) return []
  const period = record(config.currentPeriod)
  const used = number(config.creditUsagePercent) ?? (confirmedZeroUsage(config, period) ? 0 : undefined)
  if (used === undefined) return []
  const type = string(period?.type) ?? string(config.periodType)
  const resetsAt = time(period?.end) ?? time(config.billingPeriodEnd)
  return [
    {
      id: periodID(type),
      label: periodLabel(type),
      remaining: clampPercent(100 - used),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    },
  ]
}

export function plan(token: Token) {
  const override = string(token.metadata?.plan)
  if (override) return override
  const tier = number(jwtPayload(token.access)?.tier)
  if (tier === undefined) return undefined
  return tiers[tier] ?? `Tier ${tier}`
}

export function account(token: Token) {
  return string(token.metadata?.email) ?? string(jwtPayload(token.access)?.email)
}

export async function fetchQuota(token: Token, options: FetchOptions = {}): Promise<Result> {
  const response = await json(
    billingURL,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token.access}`, accept: "application/json" },
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
