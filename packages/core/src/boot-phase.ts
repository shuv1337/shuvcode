export * as BootPhase from "./boot-phase"

import { Context, Effect, Layer } from "effect"

/**
 * Mutable per-boot phase durations in fractional milliseconds, keyed by phase
 * name. Present only on fibers descending from a recorded location boot.
 */
export type Phases = Record<string, number>

const Current = Context.Reference<Phases | undefined>("@opencode/BootPhase/Current", {
  defaultValue: () => undefined,
})

/**
 * Attributes the duration of `effect` to `name` when the current fiber belongs
 * to a recorded location boot; otherwise runs `effect` untouched. Repeated
 * calls accumulate, and a tracked call nested inside another (wellknown inside
 * config discovery) counts toward both names.
 *
 * Durations are wall-clock, so concurrent boots time-slicing the JS thread
 * inflate each other's phases; the breakdown attributes where a boot spent its
 * wait, not exclusive CPU cost.
 */
export const track = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const phases = yield* Current
    if (!phases) return yield* effect
    const start = performance.now()
    return yield* Effect.onExit(effect, () =>
      Effect.sync(() => {
        phases[name] = (phases[name] ?? 0) + performance.now() - start
      }),
    )
  })

/**
 * Runs `layer`'s build with `phases` receiving tracked phase durations. Forked
 * fibers inherit the recorder, so late recordings after boot completes mutate
 * an already-reported object and are harmless.
 */
export function record<A, E, R>(layer: Layer.Layer<A, E, R>, phases: Phases): Layer.Layer<A, E, R> {
  return Layer.fromBuild((memoMap, scope) =>
    Effect.provideService(Layer.buildWithMemoMap(layer, memoMap, scope), Current, phases),
  )
}

/** Rounds recorded durations for logging. */
export function summarize(phases: Phases): Record<string, number> {
  return Object.fromEntries(Object.entries(phases).map(([name, duration]) => [name, Math.round(duration)]))
}
