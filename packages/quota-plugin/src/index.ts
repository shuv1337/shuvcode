import { Plugin } from "@opencode/plugin/effect"
import type { Credential } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { Claude } from "./claude.js"
import { Codex } from "./codex.js"
import { Google } from "./google.js"
import { QuotaRpc } from "./rpc.js"
import type { Result, Token } from "./shared.js"
import { XAI } from "./xai.js"

export const ID = "shuvcode.quota"
export { QuotaRpc } from "./rpc.js"

/** Server-side cache lifetime. The TUI polls faster than this; only refresh=true bypasses it. */
export const CACHE_TTL_MS = 5 * 60 * 1000

interface Source {
  readonly id: string
  readonly name: string
  readonly integrationID: string
  readonly methodIDs: ReadonlySet<string>
  readonly fetchQuota: (token: Token) => Promise<Result>
  readonly account?: (token: Token) => string | undefined
  readonly plan?: (token: Token) => string | undefined
  /** Accept a key credential as a subscription token (Claude OAuth access tokens stored as keys). */
  readonly key?: (key: string) => boolean
}

/** Display order matches the sidebar: ChatGPT/Codex, Claude, xAI, Google AI Pro. */
export const sources: readonly Source[] = [
  { ...Codex, fetchQuota: (token) => Codex.fetchQuota(token) },
  {
    ...Claude,
    fetchQuota: (token) => Claude.fetchQuota(token),
    key: (key) => key.startsWith("sk-ant-oat"),
  },
  { ...XAI, fetchQuota: (token) => XAI.fetchQuota(token) },
  { ...Google, fetchQuota: (token) => Google.fetchQuota(token) },
]

export function token(source: Source, credential: Credential.Value | undefined): Token | undefined {
  if (!credential) return undefined
  if (credential.type === "oauth") {
    if (!source.methodIDs.has(credential.methodID)) return undefined
    return { access: credential.access, metadata: credential.metadata }
  }
  if (source.key?.(credential.key)) return { access: credential.key, metadata: credential.metadata }
  return undefined
}

export function toProvider(
  source: Source,
  result: Result,
  value: Token,
  fetched: number,
  label?: string,
): QuotaRpc.Provider {
  const account = result.ok ? result.account : undefined
  const resolvedAccount = account ?? source.account?.(value) ?? label
  const plan = result.ok ? result.plan : source.plan?.(value)
  return {
    id: source.id,
    name: source.name,
    integrationID: source.integrationID,
    status: result.ok ? "ok" : "error",
    ...(plan ? { plan } : {}),
    ...(resolvedAccount ? { account: resolvedAccount } : {}),
    ...(result.ok ? {} : { error: result.error }),
    windows: result.ok ? result.windows : [],
    fetched,
  }
}

export const QuotaPlugin = Plugin.define({
  id: ID,
  effect: Effect.fn(function* (ctx) {
    const cache = new Map<string, QuotaRpc.Provider>()
    const inflight = new Map<string, Promise<QuotaRpc.Provider | undefined>>()

    const load = (source: Source, refresh: boolean) =>
      Effect.gen(function* () {
        const connection = yield* ctx.integration.connection.active(source.integrationID)
        if (!connection || connection.type !== "credential") {
          cache.delete(source.id)
          return undefined
        }
        // Resolution refreshes near-expiry OAuth tokens; a failure means sign-in is needed.
        const resolved = yield* ctx.integration.connection.resolve(connection).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((cause) =>
            Effect.succeed({ ok: false as const, error: cause instanceof Error ? cause.message : String(cause) }),
          ),
        )
        if (!resolved.ok) {
          cache.delete(source.id)
          return {
            id: source.id,
            name: source.name,
            integrationID: source.integrationID,
            status: "error" as const,
            error: "Sign in required",
            account: connection.label,
            windows: [],
            fetched: Date.now(),
          } satisfies QuotaRpc.Provider
        }
        const value = token(source, resolved.value)
        if (!value) {
          cache.delete(source.id)
          return undefined
        }
        const cached = cache.get(source.id)
        if (!refresh && cached && Date.now() - cached.fetched < CACHE_TTL_MS) return cached
        const pending = inflight.get(source.id)
        if (pending) return yield* Effect.promise(() => pending)
        const promise = source
          .fetchQuota(value)
          .then((result) => toProvider(source, result, value, Date.now(), connection.label))
          .catch((cause: unknown) =>
            toProvider(
              source,
              { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
              value,
              Date.now(),
              connection.label,
            ),
          )
          .then((provider) => {
            // Keep the last good snapshot when a refetch fails so the sidebar never flashes empty.
            const next = provider.status === "error" && cached ? { ...cached, error: provider.error } : provider
            cache.set(source.id, next)
            return next
          })
          .finally(() => inflight.delete(source.id))
        inflight.set(source.id, promise)
        return yield* Effect.promise(() => promise)
      })

    // A registration failure means a broken definition, not a runtime condition.
    yield* ctx.rpc
      .register(QuotaRpc.Definition, {
        list: (input) =>
          Effect.forEach(sources, (source) => load(source, input.refresh === true), { concurrency: "unbounded" }).pipe(
            Effect.map((providers) => ({
              providers: providers.filter((provider): provider is QuotaRpc.Provider => provider !== undefined),
            })),
          ),
      })
      .pipe(Effect.orDie)
  }),
})

export default QuotaPlugin
