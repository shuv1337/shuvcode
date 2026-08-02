export * as AnthropicClaudeCode from "./anthropic-claude-code"

// Claude Pro/Max subscription support.
//
// Unlike an API key, a subscription token only draws from the plan when the
// request looks like one genuine Claude Code would send. Anthropic inspects the
// system prompt, the tool names and the headers; a request that authenticates
// correctly but *presents* differently is accepted and then billed as
// pay-as-you-go "extra usage" instead of against the subscription. So this
// module is two things at once: an OAuth method, and a wire-shaping middleware.
//
// Why middleware and not an OpenAI-plugin-style ownership model: the ChatGPT
// plan only needs a different baseURL and auth, which the OpenAI plugin can
// express. This needs the request body rewritten *and* the streaming response
// rewritten back, which is inherently request/response middleware. The provider
// is nominally `aisdk:@ai-sdk/anthropic`, but ModelResolver short-circuits that
// package to the native AnthropicMessages route, so `aisdk.hook("sdk")` never
// runs for it. The seam is therefore a wrapped route transport, selected by a
// guarded subscription branch in ModelResolver.
//
// Token plumbing deliberately lives nowhere in here. Integration.connection
// .resolve refreshes and persists the credential, and ModelResolver injects the
// resolved value into the apiKey slot, which @ai-sdk/anthropic sends as
// `x-api-key`. The middleware simply moves that value to `Authorization:
// Bearer`. Platform owns the lifecycle; this file owns the disguise.

import { createHash, randomBytes } from "node:crypto"
import type { TransportDef } from "@opencode-ai/ai/route"
import { Stream } from "effect"
import { Integration } from "../../integration"

export const methodID = Integration.MethodID.make("claude-pro-max")
export const integrationID = Integration.ID.make("anthropic")

const clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const authorizeEndpoint = "https://claude.ai/oauth/authorize"
const tokenEndpoint = "https://platform.claude.com/v1/oauth/token"
const redirectURI = "https://platform.claude.com/oauth/code/callback"
const scopes = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"

/** Claude Code's own UA and beta flags; the subscription path expects both. */
export const userAgent = "claude-cli/2.1.81 (external, cli)"
export const betaFlags =
  "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05"

/**
 * A `claude setup-token` value. It lives in the key slot because that is the
 * only place a headless host can paste one, but it is an OAuth token: sent as
 * `x-api-key` it 401s, so it must take the subscription path.
 */
const setupTokenPrefix = "sk-ant-oat"

/** Structural credential shape so core and plugin-facing types both fit. */
type CredentialLike = {
  readonly type: string
  readonly methodID?: string
  readonly key?: string
}

export const isSubscription = (credential: CredentialLike | undefined) => {
  if (!credential) return false
  if (credential.type === "oauth") return credential.methodID === methodID
  if (credential.type === "key") return credential.key?.startsWith(setupTokenPrefix) === true
  return false
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export type Tokens = { access: string; refresh: string; expires: number }

const base64url = (buf: Buffer) => buf.toString("base64url").replace(/=+$/, "")

export const pkce = () => {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) }
}

export const authorizeURL = (challenge: string, state: string) =>
  `${authorizeEndpoint}?${new URLSearchParams({
    code: "true",
    response_type: "code",
    client_id: clientID,
    redirect_uri: redirectURI,
    scope: scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })}`

/** The callback page renders `code#state`; accept either form. */
export const parseCode = (raw: string) => {
  const trimmed = raw.trim()
  const hash = trimmed.indexOf("#")
  return hash >= 0 ? trimmed.slice(0, hash) : trimmed
}

async function token(body: URLSearchParams): Promise<Tokens> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent },
    body: body.toString(),
  })
  if (!response.ok) throw new Error(`Claude OAuth failed with HTTP ${response.status}`)
  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!data.access_token || !Number.isFinite(data.expires_in))
    throw new Error("Claude OAuth returned an invalid credential response")
  return {
    access: data.access_token,
    refresh: data.refresh_token ?? "",
    expires: Date.now() + data.expires_in! * 1000,
  }
}

export const exchange = (code: string, verifier: string) =>
  token(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: parseCode(code),
      code_verifier: verifier,
      client_id: clientID,
      redirect_uri: redirectURI,
      state: verifier,
    }),
  )

export const refresh = async (refreshToken: string) => {
  const tokens = await token(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientID }),
  )
  return { ...tokens, refresh: tokens.refresh || refreshToken }
}

// ---------------------------------------------------------------------------
// Wire shaping
// ---------------------------------------------------------------------------

export const systemIdentity = "You are Claude Code, Anthropic's official CLI for Claude."

/** Claude Code 2.x canonical tool names. */
const tools = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
]
const canonical = new Map(tools.map((name) => [name.toLowerCase(), name]))
const toCanonical = (name: string) => canonical.get(name.toLowerCase()) ?? name

/**
 * The canonical `<env>` shape genuine Claude Code sends.
 *
 * MAINTENANCE LIABILITY. Anthropic fuzzy-matches this block to decide whether a
 * request is really Claude Code. A block that diverges — an extra harness key,
 * different indentation, the date outside the tag — is billed as "extra usage"
 * against the account instead of drawing from the subscription. The failure is
 * silent: requests still succeed, they just cost money. Header, tool and
 * identity shaping alone do not satisfy the check.
 *
 * Verified against build 0.0.0-next-15329 on 2026-07-11. If opencode's own
 * prompt format changes, `isCanonical` below stops matching and the middleware
 * warns; that warning is the only early signal of a billing regression, so do
 * not silence it without re-verifying against a real subscription.
 */
export function normalizeEnv(text: string): string {
  return text.replace(
    /(?:[^\n]*(?:useful )?information about the environment you are running in:\n)?<env>\n([\s\S]*?)\n<\/env>((?:\n+Today's date:[^\n]*)?)/,
    (_match, inner: string, trailingDate: string) => {
      const lines = String(inner)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        // Harness-specific keys never appear in genuine Claude Code.
        .filter((line) => !/^Workspace root folder:/i.test(line))
      const date = trailingDate.match(/Today's date:\s*(.+)\s*$/)
      if (date && !lines.some((line) => /^Today's date:/i.test(line))) lines.push(`Today's date: ${date[1].trim()}`)
      return `Here is useful information about the environment you are running in:\n<env>\n${lines.join("\n")}\n</env>`
    },
  )
}

/**
 * Canary for the above. True when the text carries no `<env>` block at all, or
 * carries one already in canonical form. False means normalization did not
 * produce what Anthropic expects and billing has probably silently moved to
 * "extra usage".
 */
export function isCanonical(text: string): boolean {
  if (!text.includes("<env>")) return true
  return /Here is useful information about the environment you are running in:\n<env>\n(?:[^\n ][^\n]*\n)*<\/env>/.test(
    text,
  )
}

/**
 * Shape the outgoing Anthropic payload into what genuine Claude Code sends:
 * the Claude Code identity first in `system`, a canonical `<env>` block, and
 * Claude Code's tool casing. Operates on the decoded payload rather than
 * request text, so the protocol keeps ownership of encoding.
 */
export function shapeRequestBody(body: unknown, warn?: (message: string) => void): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const parsed = { ...(body as Record<string, unknown>) } as {
    system?: unknown
    tools?: Array<{ name?: string } & Record<string, unknown>>
    messages?: Array<{ content?: Array<Record<string, unknown>> }>
    apiKey?: unknown
  }

  const identity = { type: "text", text: systemIdentity }
  const normalize = (text: string) => {
    const next = normalizeEnv(text)
    if (!isCanonical(next))
      warn?.(
        "Claude Code <env> block is not in canonical form after normalization; " +
          "subscription requests may be billed as extra usage. See normalizeEnv in anthropic-claude-code.ts.",
      )
    return next
  }

  if (Array.isArray(parsed.system) && parsed.system.length > 0) {
    parsed.system = parsed.system.map((entry: unknown, index: number) => {
      if (index === 0) return identity
      if (entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string") {
        const block = entry as { type?: string; text: string }
        return { ...block, text: normalize(block.text) }
      }
      return entry
    })
  } else if (typeof parsed.system === "string" && parsed.system.length > 0) {
    parsed.system = [identity, { type: "text", text: normalize(parsed.system) }]
  } else {
    parsed.system = [identity]
  }

  // A configured provider `body.apiKey` is merged into the payload upstream and
  // the Anthropic API rejects it as an unexpected input.
  delete parsed.apiKey

  if (Array.isArray(parsed.tools))
    parsed.tools = parsed.tools.map((tool) => ({ ...tool, name: tool.name ? toCanonical(tool.name) : tool.name }))

  if (Array.isArray(parsed.messages))
    parsed.messages = parsed.messages.map((message) => {
      if (!Array.isArray(message.content)) return message
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "tool_use" && typeof block.name === "string"
            ? { ...block, name: toCanonical(block.name) }
            : block,
        ),
      }
    })

  return parsed
}

/** Reverse the canonical casing so the rest of opencode sees its own names. */
export function restoreToolNames(text: string): string {
  let out = text
  for (const name of tools)
    out = out.replace(new RegExp(`"name"\\s*:\\s*"${name}"`, "g"), `"name": "${name.toLowerCase()}"`)
  return out
}

/**
 * Headers Claude Code sends. `anthropic-beta` is merged rather than replaced so
 * a provider- or config-supplied flag survives alongside the required ones.
 */
export function headers(existing?: Record<string, string>): Record<string, string> {
  const incoming = Object.entries(existing ?? {}).find(([key]) => key.toLowerCase() === "anthropic-beta")?.[1] ?? ""
  const merged = [
    ...new Set([
      ...betaFlags.split(","),
      ...incoming
        .split(",")
        .map((flag) => flag.trim())
        .filter(Boolean),
    ]),
  ].join(",")
  return {
    "anthropic-beta": merged,
    "anthropic-dangerous-direct-browser-access": "true",
    "user-agent": userAgent,
    "x-app": "cli",
  }
}

/**
 * Wrap a route transport so requests present as Claude Code and responses are
 * mapped back to opencode's tool names.
 *
 * This is the seam because ModelResolver dispatches `@ai-sdk/anthropic` through
 * the native AnthropicMessages route, not the AI SDK -- `aisdk.hook("sdk")` is
 * never invoked for it. Framing splits the SSE stream into whole events before
 * this sees them, so the reverse mapping needs no boundary buffering.
 */
export function transport<Body, Prepared>(
  base: TransportDef<Body, Prepared, unknown>,
  warn?: (message: string) => void,
): TransportDef<Body, Prepared, unknown> {
  return {
    id: `${base.id}/claude-code`,
    prepare: (input) => base.prepare({ ...input, body: shapeRequestBody(input.body, warn) as Body }),
    frames: (prepared, request, runtime) =>
      base
        .frames(prepared, request, runtime)
        .pipe(Stream.map((frame) => (typeof frame === "string" ? restoreToolNames(frame) : frame))),
  }
}
