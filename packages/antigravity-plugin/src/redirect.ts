import type { ServerResponse } from "node:http"
import { Deferred, Effect } from "effect"
import { sanitizeErrorCode, timingSafeEqualString } from "./url"

export type ParsedRedirect =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly kind: "error"; readonly message: string }
  | { readonly ok: true; readonly kind: "code"; readonly code: string }

export type ReceivedCallback = {
  readonly code: string
  readonly response?: ServerResponse
}

export function parseRedirect(raw: string, expectedState: string): ParsedRedirect {
  const value = raw.trim()
  if (!URL.canParse(value)) return { ok: false, reason: "Paste the full URL from the browser's address bar" }
  const params = new URL(value).searchParams
  if (!timingSafeEqualString(expectedState, params.get("state")))
    return { ok: false, reason: "This URL belongs to a different sign-in" }
  const error = params.get("error")
  if (error !== null && error.trim().length > 0) {
    const code = sanitizeErrorCode(error)
    return {
      ok: true,
      kind: "error",
      message: code ? `Google authorization failed (${code})` : "Google authorization failed",
    }
  }
  const code = params.get("code")?.trim()
  if (!code) return { ok: false, reason: "The URL does not contain an authorization code" }
  return { ok: true, kind: "code", code }
}

/**
 * Handles pasted redirect URLs when the user's browser cannot reach the local loopback callback server.
 * Malformed URLs, state mismatches, or missing codes reject only this paste so the pending attempt stays active.
 */
export function submitRedirect(input: {
  readonly state: string
  readonly received: Deferred.Deferred<ReceivedCallback, Error>
}) {
  return (raw: string): Effect.Effect<void, Error> => {
    const parsed = parseRedirect(raw, input.state)
    if (!parsed.ok) return Effect.fail(new Error(parsed.reason))
    if (parsed.kind === "error") return Deferred.fail(input.received, new Error(parsed.message)).pipe(Effect.asVoid)
    return Deferred.succeed(input.received, { code: parsed.code }).pipe(Effect.asVoid)
  }
}
