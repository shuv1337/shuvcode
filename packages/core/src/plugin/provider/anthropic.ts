import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Semaphore, Stream } from "effect"
import { Bus } from "../../bus"
import { Integration } from "../../integration"
import { Provider } from "../../provider.js"
import { AnthropicClaudeCode } from "./anthropic-claude-code.js"
import { AnthropicClaudeCodeProxy } from "./anthropic-claude-code-proxy.js"

const claudeProMax = {
  integrationID: AnthropicClaudeCode.integrationID,
  method: {
    id: AnthropicClaudeCode.methodID,
    type: "oauth",
    label: "Claude Pro/Max",
  },
  authorize: () =>
    Effect.promise(async () => {
      const { verifier, challenge } = await AnthropicClaudeCode.pkce()
      return {
        // Anthropic's callback page displays the code rather than redirecting
        // to a loopback port, so this cannot be "auto" like ChatGPT's.
        mode: "code" as const,
        url: AnthropicClaudeCode.authorizeURL(challenge, verifier),
        instructions: "Authorize with Claude, then paste the code shown.",
        callback: (code: string) =>
          Effect.tryPromise({
            try: async () => ({
              type: "oauth" as const,
              methodID: AnthropicClaudeCode.methodID,
              ...(await AnthropicClaudeCode.exchange(code, verifier)),
            }),
            catch: () => new Error("Claude authorization failed"),
          }),
      }
    }),
  refresh: (value) =>
    Effect.tryPromise({
      try: async () => ({ ...value, ...(await AnthropicClaudeCode.refresh(value.refresh)) }),
      catch: () => new Error("Claude token refresh failed"),
    }),
} satisfies IntegrationOAuthMethodRegistration

export const AnthropicPlugin = define({
  id: "opencode.provider.anthropic",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    let subscription = false

    // Resolved rather than cached at every use: a CLAUDE_CODE_OAUTH_TOKEN in the
    // environment surfaces as an `env` connection, which is derived at resolve
    // time and never publishes ConnectionUpdated, so a setup-at-startup flag
    // would stay false forever on exactly the headless hosts that need it.
    const load = Effect.fn("AnthropicPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(AnthropicClaudeCode.integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      subscription = AnthropicClaudeCode.isSubscription(credential)
      return subscription
    })

    // Request-time credential for the subscription proxy. Resolving through the
    // Integration service means a stale token is refreshed (and persisted)
    // before it authorizes a request, instead of riding on whatever the model
    // resolver saw when the session started.
    const accessToken = Effect.fn("AnthropicPlugin.accessToken")(function* () {
      const connection = yield* ctx.integration.connection.active(AnthropicClaudeCode.integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      if (!AnthropicClaudeCode.isSubscription(credential)) return undefined
      if (credential?.type === "oauth") return credential.access
      if (credential?.type === "key") return credential.key
      return undefined
    })

    // Subscription requests route through a loopback proxy that authorizes at
    // request time; body shaping stays in the claude-code route transport. The
    // proxy exists only while a subscription connection does.
    let proxy: AnthropicClaudeCodeProxy.Proxy | undefined
    const syncProxy = Effect.fn("AnthropicPlugin.syncProxy")(function* () {
      if (subscription === Boolean(proxy)) return
      if (!subscription) {
        const owned = proxy
        proxy = undefined
        if (owned) yield* Effect.promise(() => owned.close())
        return
      }
      proxy = yield* Effect.promise(() =>
        AnthropicClaudeCodeProxy.start({ getAccessToken: () => Effect.runPromise(accessToken()) }),
      ).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => {
        const owned = proxy
        proxy = undefined
        return owned ? owned.close() : Promise.resolve()
      }),
    )

    yield* ctx.integration.transform((draft) => {
      draft.method.update(claudeProMax)
      // A `claude setup-token` value is the only credential a headless host can
      // obtain without a browser, so accept it from the environment too. It
      // arrives as a key credential and isSubscription routes it accordingly.
      draft.method.update({
        integrationID: AnthropicClaudeCode.integrationID,
        method: { type: "env", names: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] },
      })
    })
    yield* load()
    yield* syncProxy()

    // Note: no `aisdk.hook("sdk")` here. ModelResolver short-circuits the
    // `@ai-sdk/anthropic` package to the native AnthropicMessages route, so
    // that hook is never invoked for this provider; subscription request
    // shaping lives in the route transport instead.
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/anthropic") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/anthropic"))
        evt.sdk = mod.createAnthropic(evt.options)
      }),
    )

    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!Provider.isAISDK(item.provider.package)) continue
        if (Provider.packageName(item.provider.package) !== "@ai-sdk/anthropic") continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.headers = {
            ...provider.headers,
            "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          }
        })
      }
      if (!subscription) return
      const item = evt.provider.get(Provider.ID.make("anthropic"))
      if (!item) return
      const proxyURL = proxy?.url
      evt.provider.update(item.provider.id, (provider) => {
        // The route composes `${baseURL}${path}` with a versioned base, so the
        // override must carry `/v1` for paths to reconstruct correctly. An
        // explicitly configured baseURL wins over the proxy.
        if (proxyURL && typeof provider.settings?.baseURL !== "string")
          provider.settings = { ...provider.settings, baseURL: `${proxyURL}/v1` }
      })
      for (const model of item.models.values()) {
        // The subscription covers usage, so per-token cost is not meaningful.
        evt.model.update(item.provider.id, model.id, (draft) => {
          draft.cost = []
        })
      }
    })

    const reload = () =>
      loading.withPermit(load().pipe(Effect.andThen(syncProxy()), Effect.andThen(ctx.catalog.reload())))
    yield* bus.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === AnthropicClaudeCode.integrationID),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )

  }),
})
