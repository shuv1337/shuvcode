export * as LocationActivity from "./location-activity.js"

import { Clock, Context, Duration, Effect, Layer, Option, RcMap, Schema } from "effect"
import type { Document } from "@opencode/schema/config"
import { Bus } from "./bus.js"
import { Config } from "./config.js"
import { Job } from "./job.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { SessionEvent } from "./session/event.js"
import { SessionExecution } from "./session/execution.js"
import { SessionStore } from "./session/store.js"
import { ToolActivity } from "./tool-activity.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const isSessionEvent = Schema.is(SessionEvent.Durable)

export class Service extends Context.Service<Service, {}>()("@opencode/LocationActivity") {}

export function layer(
  options: {
    readonly timeToLive?: Duration.Input
    readonly sweepInterval?: Duration.Input
    /** Test seam. Runs after an expiry is observed and before the keep-or-interrupt decision. */
    readonly beforeDecision?: Effect.Effect<void, never, ToolActivity.Service>
  } = {},
) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const jobs = yield* Job.Service
      const sessions = yield* SessionStore.Service
      const activity = yield* ToolActivity.Service
      const timeToLive = Duration.fromInputUnsafe(options.timeToLive ?? "60 minutes")
      const entries = new Map<string, { readonly ref: Location.Ref; touchedAt: number }>()
      const key = (ref: Location.Ref) => `${LocationServiceMap.canonical(ref).directory}\0${ref.workspaceID ?? ""}`
      const touch = (ref: Location.Ref) =>
        Effect.sync(() => {
          entries.set(key(ref), { ref, touchedAt: clock.currentTimeMillisUnsafe() })
        })

      // Read per location so project config can override the global value.
      const idleTimeout = (ref: Location.Ref) =>
        Effect.gen(function* () {
          const context = yield* locations.contextEffectOption(ref)
          if (Option.isNone(context)) return timeToLive
          const entries = yield* Context.get(context.value, Config.Service).entries()
          const configured = entries.findLast(
            (entry): entry is Document =>
              entry.type === "document" && entry.info.experimental?.location_idle_timeout !== undefined,
          )
          return configured?.info.experimental?.location_idle_timeout ?? timeToLive
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => timeToLive),
        )

      const unsubscribe = yield* bus.listen((event) => {
        if (!isSessionEvent(event) || !event.location) return Effect.void
        const location = LocationServiceMap.canonical(event.location)
        return RcMap.has(locations.rcMap, location).pipe(
          Effect.flatMap((active) => (active ? touch(location) : Effect.void)),
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const unsubscribeActivity = yield* activity.listen((event) => {
        if (event.count !== 0) return Effect.void
        return Effect.gen(function* () {
          const session = yield* sessions.get(event.sessionID)
          if (!session) return
          const id = key(session.location)
          const cached = Array.from(yield* RcMap.keys(locations.rcMap)).some((ref) => key(ref) === id)
          if (!cached) return
          const holding = yield* activity.holding
          const placed = yield* Effect.forEach(holding, (sessionID) => sessions.get(sessionID))
          if (placed.some((other) => other && key(other.location) === id)) return
          // Idle time starts when the last in-flight tool at this Location releases,
          // not when the next sweep happens to notice.
          yield* touch(session.location)
        })
      })
      yield* Effect.addFinalizer(() => unsubscribeActivity)
      yield* Effect.gen(function* () {
        yield* Effect.sleep(options.sweepInterval ?? "1 minute")
        const refs = Array.from(yield* RcMap.keys(locations.rcMap))
        const cached = new Set(refs.map(key))
        yield* Effect.forEach(refs, (ref) => (entries.has(key(ref)) ? Effect.void : touch(ref)), { discard: true })
        for (const id of entries.keys()) {
          if (!cached.has(id)) entries.delete(id)
        }
        const now = clock.currentTimeMillisUnsafe()
        const expired = yield* Effect.filter(Array.from(entries.values()), (entry) =>
          idleTimeout(entry.ref).pipe(
            Effect.map((timeout) => timeout !== false && entry.touchedAt + Duration.toMillis(timeout) <= now),
          ),
        )
        if (expired.length === 0) return
        if (options.beforeDecision) yield* options.beforeDecision
        yield* Effect.forEach(
          expired,
          (entry) =>
            Effect.gen(function* () {
              const decision = yield* activity.exclusive(
                Effect.gen(function* () {
                  const id = key(entry.ref)
                  const active = yield* Effect.forEach(yield* execution.active, (sessionID) => sessions.get(sessionID))
                  const holding = yield* activity.holding
                  const background = (yield* jobs.runningBackground).flatMap((recovery) =>
                    recovery.kind === "subagent"
                      ? [recovery.childSessionID, recovery.parentSessionID]
                      : [recovery.sessionID],
                  )
                  const backgroundSessions = yield* Effect.forEach(background, (sessionID) => sessions.get(sessionID))
                  if (
                    active.some((session) => session && holding.has(session.id) && key(session.location) === id) ||
                    backgroundSessions.some((session) => session && key(session.location) === id)
                  ) {
                    yield* touch(entry.ref)
                    return { action: "keep" as const }
                  }
                  const current = entries.get(id)
                  if (!current) return { action: "keep" as const }
                  const timeout = yield* idleTimeout(current.ref)
                  if (
                    timeout === false ||
                    current.touchedAt + Duration.toMillis(timeout) > clock.currentTimeMillisUnsafe()
                  )
                    return { action: "keep" as const }
                  const owners = active.flatMap((session) => (session && key(session.location) === id ? [session] : []))
                  yield* Effect.forEach(
                    owners,
                    (session) => execution.interrupt(session.id, { reason: "inactivity" }),
                    { discard: true },
                  )
                  return { action: "interrupt" as const, owners }
                }),
              )
              if (decision.action === "keep") return
              // Settlement waits outside the lease lock so a releasing tool can finish.
              yield* Effect.forEach(
                decision.owners,
                (session) => execution.interrupt(session.id, { reason: "inactivity", awaitSettlement: true }),
                { discard: true, concurrency: "unbounded" },
              )
              const remaining = yield* Effect.forEach(yield* execution.active, (sessionID) => sessions.get(sessionID))
              // New work admitted during cleanup may now own the cached graph.
              if (remaining.some((session) => session && key(session.location) === key(entry.ref))) {
                yield* touch(entry.ref)
                return
              }
              entries.delete(key(entry.ref))
              yield* Effect.logInfo("location services evicted", {
                directory: entry.ref.directory,
                workspaceID: entry.ref.workspaceID,
              }).pipe(Effect.andThen(locations.invalidate(entry.ref)))
            }),
          { discard: true, concurrency: "unbounded" },
        )
      }).pipe(Effect.forever, Effect.forkScoped)

      return Service.of({})
    }),
  )
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [Bus.node, Job.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node, ToolActivity.node],
})
