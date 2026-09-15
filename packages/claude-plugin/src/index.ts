import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { hooks } from "./hooks.js"
import { authorizeURL, exchange, integrationID, isSubscription, methodID, pkce, refresh } from "./oauth.js"
import type { Options } from "./oauth.js"

export { integrationID, methodID } from "./oauth.js"

/** Options inject only the OAuth network/clock boundary; inference remains owned by the host. */
export function createPlugin(options: Options = {}) {
  return define({
    id: "shuvcode.provider.claude",
    effect: Effect.fn(function* (ctx) {
      let subscription = false
      const load = Effect.gen(function* () {
        const active = yield* ctx.integration.connection.active(integrationID)
        const value = active
          ? yield* ctx.integration.connection.resolve(active).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        subscription = isSubscription(value)
      })
      yield* ctx.integration.transform((editor) => {
        editor.method.update({
          integrationID,
          method: { type: "oauth", id: methodID, label: "Claude Pro/Max" },
          authorize: () =>
            Effect.gen(function* () {
              const proof = yield* Effect.promise(pkce)
              return {
                mode: "code" as const,
                url: authorizeURL(proof.challenge, proof.verifier),
                instructions: "Paste the authorization code.",
                callback: (code: string) =>
                  Effect.tryPromise({
                    try: (signal) => exchange(code, proof.verifier, options, signal),
                    catch: (cause) => cause,
                  }),
              }
            }),
          refresh: (value) => refresh(value, options),
        })
        const names = editor.method.list(integrationID).flatMap((method) => (method.type === "env" ? method.names : []))
        editor.method.update({
          integrationID,
          method: { type: "env", names: [...new Set(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", ...names])] },
        })
      })
      yield* load
      yield* ctx.model.transform((models) => {
        if (!subscription) return
        models.list(integrationID).forEach((model) =>
          models.update(model.providerID, model.id, (draft) => {
            draft.cost = []
          }),
        )
      })
      const http = hooks(ctx.integration.connection)
      yield* ctx.session.hook("http.request", http.request, { providerID: integrationID })
      yield* ctx.session.hook("http.response", http.response, { providerID: integrationID })
      yield* ctx.event.subscribe().pipe(
        Stream.filter(
          (event) =>
            event.type === "credential.updated" ||
            (event.type === "credential.switched" && event.data.integrationID === integrationID),
        ),
        Stream.runForEach(() => load.pipe(Effect.andThen(ctx.model.reload()))),
        Effect.forkScoped({ startImmediately: true }),
      )
    }),
  })
}

export const ClaudePlugin = createPlugin()
export default ClaudePlugin
