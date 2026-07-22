export * as WarmingPlugin from "./warming"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Clock, Duration, Effect, Scope } from "effect"
import { Config } from "../config"
import { SessionSchema } from "../session/schema"

const defaults = {
  prompt: "This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK",
  interval: Duration.minutes(4),
  duration: Duration.minutes(30),
}

export const Plugin = define({
  id: "opencode.warming",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const warming = Config.latest(yield* config.entries(), "warming")
    if (!warming) return
    const settings = warming === true ? defaults : { ...defaults, ...warming }
    const interval = Duration.toMillis(settings.interval)
    const duration = Duration.toMillis(settings.duration)
    if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(duration) || duration <= 0) {
      yield* Effect.logWarning("warming interval and duration must be finite positive durations")
      return
    }

    const scope = yield* Scope.Scope
    const sessions = new Map<SessionSchema.ID, { last: number; expires: number }>()
    const loop: (sessionID: SessionSchema.ID) => Effect.Effect<void> = Effect.fn("WarmingPlugin.loop")(function* (
      sessionID,
    ) {
      const current = sessions.get(sessionID)
      if (!current) return

      const now = yield* Clock.currentTimeMillis
      const next = Math.min(current.last + interval, current.expires)
      if (now < next) {
        yield* Effect.sleep(Duration.millis(next - now))
        return yield* loop(sessionID)
      }
      if (now >= current.expires) {
        sessions.delete(sessionID)
        return
      }

      const last = current.last
      yield* ctx.session.generate({ sessionID, prompt: settings.prompt }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("failed to warm session", { sessionID, cause })),
      )
      const latest = sessions.get(sessionID)
      if (latest === current && latest.last === last) latest.last = yield* Clock.currentTimeMillis
      return yield* loop(sessionID)
    })

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        // Once generate exposes request metadata to context hooks, tag warm requests instead of matching the prompt.
        const message = event.messages.at(-1)
        if (
          message?.role === "user" &&
          message.content.length === 1 &&
          message.content[0]?.type === "text" &&
          message.content[0].text === settings.prompt
        )
          return

        const now = yield* Clock.currentTimeMillis
        const active = sessions.get(event.sessionID)
        if (active) {
          active.last = now
          active.expires = now + duration
          return
        }
        sessions.set(event.sessionID, { last: now, expires: now + duration })
        yield* loop(event.sessionID).pipe(Effect.forkIn(scope))
      }),
    )
  }),
})
