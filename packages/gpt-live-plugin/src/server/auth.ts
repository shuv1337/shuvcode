import type { Plugin } from "@opencode/plugin"

import type { Auth } from "./live"

type Context = Plugin.Context

export type AuthResult = { ok: true; auth: Auth; plan?: string } | { ok: false; reason: string }

interface Claims {
  chatgpt_account_id?: string
  chatgpt_plan_type?: string
}

export function claims(token: string): Claims {
  const part = token.split(".")[1]
  if (!part) return {}
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>
    const auth = (payload["https://api.openai.com/auth"] ?? {}) as Claims
    return {
      chatgpt_account_id: auth.chatgpt_account_id ?? (payload.chatgpt_account_id as string | undefined),
      chatgpt_plan_type: auth.chatgpt_plan_type,
    }
  } catch {
    return {}
  }
}

const NOT_SIGNED_IN = 'GPT-Live needs your ChatGPT subscription. Run /connect, choose OpenAI, then "ChatGPT Pro/Plus".'

/**
 * Finds the ChatGPT sign-in among the OpenAI connections. OpenCode refreshes the
 * access token during resolve when it is close to expiring, so resolve before each call.
 */
export async function resolveAuth(ctx: Context): Promise<AuthResult> {
  const integration = await ctx.integration.get({ integrationID: "openai" as never }).catch(() => undefined)
  const connections = (integration?.data as { connections?: unknown[] } | undefined)?.connections ?? []
  const oauth = connections.filter(
    (connection): connection is { type: "credential"; id: string; label: string; method: "oauth" } =>
      (connection as { type?: string }).type === "credential" && (connection as { method?: string }).method === "oauth",
  )
  if (oauth.length === 0) return { ok: false, reason: NOT_SIGNED_IN }
  const active = await ctx.integration.connection.active("openai").catch(() => undefined)
  const ordered = oauth.toSorted(
    (a, b) => Number(b.id === (active as { id?: string })?.id) - Number(a.id === (active as { id?: string })?.id),
  )
  // Resolve every connection at once, then take the first usable one in priority order.
  const credentials = await Promise.all(
    ordered.map((connection) => ctx.integration.connection.resolve(connection as never).catch(() => undefined)),
  )
  for (const credential of credentials) {
    if (!credential || credential.type !== "oauth") continue
    const claim = claims(credential.access)
    const metadata = (credential.metadata ?? {}) as Record<string, unknown>
    const accountID =
      (typeof metadata.accountID === "string" && metadata.accountID) ||
      (typeof metadata.accountId === "string" && metadata.accountId) ||
      claim.chatgpt_account_id
    if (!accountID) continue
    return { ok: true, auth: { token: credential.access, accountID }, plan: claim.chatgpt_plan_type }
  }
  return { ok: false, reason: NOT_SIGNED_IN }
}
