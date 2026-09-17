import type { Window } from "./rpc.js"

export type Fetch = typeof fetch

/** Resolved OAuth/key credential material a fetcher needs. Never persisted or logged. */
export interface Token {
  readonly access: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface FetchOptions {
  readonly fetch?: Fetch
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export type Result =
  | {
      readonly ok: true
      readonly windows: readonly Window[]
      readonly plan?: string
      readonly account?: string
    }
  | { readonly ok: false; readonly error: string; readonly status?: number }

export const DEFAULT_TIMEOUT_MS = 15_000

export type Json = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly error: string; readonly status?: number }

/** Fetch JSON with a timeout. 401/403 are reported as a sign-in problem instead of a raw status. */
export async function json(url: string, init: RequestInit, options: FetchOptions = {}): Promise<Json> {
  const fetchFn = options.fetch ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const abort = () => controller.abort()
  options.signal?.addEventListener("abort", abort, { once: true })
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal })
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "Sign in required", status: response.status }
    }
    if (response.status === 429) return { ok: false, error: "Rate limited", status: response.status }
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      return { ok: false, error: errorText(response.status, detail), status: response.status }
    }
    try {
      return { ok: true, body: await response.json() }
    } catch {
      return { ok: false, error: "Invalid JSON response" }
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") return { ok: false, error: "Request timed out" }
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abort)
  }
}

/** One-line error text for the sidebar: prefer a JSON `error.message`, else a collapsed body excerpt. */
export function errorText(status: number, body: string) {
  const text = body.trim()
  if (!text) return `HTTP ${status}`
  const message = (() => {
    try {
      const parsed: unknown = JSON.parse(text)
      const root = record(parsed)
      const error = record(root?.error)
      return string(error?.message) ?? string(root?.message) ?? string(root?.error)
    } catch {
      return undefined
    }
  })()
  const detail = (message ?? text).replace(/\s+/g, " ").slice(0, 120)
  return `HTTP ${status}: ${detail}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

export function number(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value))
}

/**
 * Accept "percent used" that may be expressed as 0-100 or as a 0-1 ratio.
 * Integer 1 stays 1%; only fractional values in (0, 1) are treated as ratios.
 */
export function percentUsed(value: unknown): number | undefined {
  const used = number(value)
  if (used === undefined) return undefined
  return clampPercent(used > 0 && used < 1 ? used * 100 : used)
}

/** Parse ISO strings, epoch seconds, or epoch milliseconds into epoch milliseconds. */
export function time(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const numeric = number(value)
  if (numeric !== undefined) {
    if (numeric <= 0) return undefined
    return numeric < 1e12 ? numeric * 1000 : numeric
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

/** Decode a JWT payload without verifying it. Used only to read plan/tier hints. */
export function jwtPayload(token: string): Record<string, unknown> | undefined {
  const part = token.split(".")[1]
  if (!part) return undefined
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    return record(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return undefined
  }
}

/** Title-case a snake/kebab plan slug while preserving Nx multipliers. */
export function humanizePlan(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\b(\d+)X\b/g, "$1x")
    .trim()
}
