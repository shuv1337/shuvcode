export * as WellKnownPlugin from "./plugin"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { WellKnown } from "../wellknown"

export const Plugin = define({
  id: "opencode.wellknown",
  effect: Effect.fn(function* (ctx) {
    const wellknown = yield* WellKnown.Service
    yield* wellknown.entries().pipe(Effect.orDie)
    yield* ctx.integration.transform((draft) => {
      wellknown.snapshot().forEach((entry) => {
        if (!entry.manifest.auth) return
        draft.update(entry.integrationID, (integration) => {
          integration.name = new URL(entry.origin).hostname
        })
        draft.method.update({
          integrationID: entry.integrationID,
          method: {
            id: "login",
            type: "command",
            label: "Log in",
            command: [...entry.manifest.auth.command],
          },
        })
      })
    })
    yield* wellknown.changes.pipe(
      Stream.runForEach(() => ctx.integration.reload()),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
