import { timingSafeEqual } from "node:crypto"

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export const DEFAULT_NOUS_PORTAL_URL = "https://portal.nousresearch.com"

const SAFE_ERROR_CODE = /^[a-z0-9_.-]{1,64}$/i
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1"])

export const isLoopbackHost = (hostname: string) => LOOPBACK_HOSTS.has(hostname.toLowerCase())

export function isLoopbackOrigin(raw: string): boolean {
  const trimmed = raw.trim()
  if (!URL.canParse(trimmed)) return false
  const url = new URL(trimmed)
  return url.protocol === "http:" && isLoopbackHost(url.hostname)
}

export function validateHttpsOrLoopback(
  raw: string,
  label: string,
  options?: { readonly allowQuery?: boolean },
): string {
  const trimmed = raw.trim()
  if (!trimmed || !URL.canParse(trimmed)) throw new Error(`${label} must be a valid URL`)
  const url = new URL(trimmed)
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`)
  if (url.hash) throw new Error(`${label} must not contain a fragment`)
  if (!options?.allowQuery && url.search) throw new Error(`${label} must not contain query parameters`)
  if (url.protocol === "https:") {
    if (!url.hostname) throw new Error(`${label} must include a hostname`)
    if (options?.allowQuery) return url.toString()
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
  }
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    if (options?.allowQuery) return url.toString()
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
  }
  throw new Error(`${label} must use https:// (or http://127.0.0.1 / http://[::1] for local testing)`)
}

export function validateAuthorizeURL(raw: string, portalBaseURL: string): URL {
  const trimmed = raw.trim()
  if (!trimmed || !URL.canParse(trimmed)) throw new Error("Solstice authorize URL is invalid")
  const url = new URL(trimmed)
  if (url.username || url.password) throw new Error("Solstice authorize URL must not contain credentials")
  if (url.hash) throw new Error("Solstice authorize URL must not contain a fragment")
  if (url.protocol === "https:" && url.hostname === "accounts.google.com") return url
  if (url.protocol === "http:" && isLoopbackHost(url.hostname) && isLoopbackOrigin(portalBaseURL)) return url
  throw new Error("Solstice authorize URL must point to https://accounts.google.com")
}

export function resolvePortalBaseURL(
  explicit?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const candidates: ReadonlyArray<readonly [string | undefined, string]> = [
    [explicit, "portalURL option"],
    [env.SHUVCODE_NOUS_PORTAL_URL, "SHUVCODE_NOUS_PORTAL_URL"],
    [env.NOUS_PORTAL_BASE_URL, "NOUS_PORTAL_BASE_URL"],
    [env.HERMES_PORTAL_BASE_URL, "HERMES_PORTAL_BASE_URL"],
  ]
  const found = candidates.find(([value]) => typeof value === "string" && value.trim().length > 0)
  if (!found || !found[0]) return DEFAULT_NOUS_PORTAL_URL
  return validateHttpsOrLoopback(found[0], found[1])
}

export function timingSafeEqualString(a: string, b: string | null | undefined): boolean {
  if (b === null || b === undefined) return false
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function sanitizeErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return SAFE_ERROR_CODE.test(trimmed) ? trimmed : undefined
}

export async function readBoundedText(response: Response, maxBytes = 65_536): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    const remaining = maxBytes - total
    if (remaining <= 0) {
      await reader.cancel().catch(() => {})
      break
    }
    const slice = next.value.byteLength > remaining ? next.value.subarray(0, remaining) : next.value
    chunks.push(slice)
    total += slice.byteLength
    if (next.value.byteLength > remaining) {
      await reader.cancel().catch(() => {})
      break
    }
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

export function requestSignal(signal: AbortSignal | undefined, timeoutMs = 30_000): AbortSignal {
  signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export const isVercelMitigated = (response: Response) => Boolean(response.headers.get("x-vercel-mitigated"))

export function retryAfterMs(response: Response, now: number, maxMs = 60_000): number | undefined {
  const raw = response.headers.get("retry-after")?.trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) return Math.min(Number(raw) * 1000, maxMs)
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return undefined
  return Math.min(Math.max(0, parsed - now), maxMs)
}
