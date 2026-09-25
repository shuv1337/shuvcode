import { describe, expect } from "bun:test"
import { ToolActivity } from "@opencode/core/tool-activity"
import { Session } from "@opencode/schema/session"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.fresh(ToolActivity.layer))
const sessionID = Session.ID.make("ses_lease")
const otherID = Session.ID.make("ses_other")

const hold = (started: Deferred.Deferred<void>, release: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    const activity = yield* ToolActivity.Service
    return yield* activity.lease(sessionID).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        }),
      ),
      Effect.scoped,
    )
  })

describe("ToolActivity leases", () => {
  it.effect("counts overlapping leases per session and releases each one", () =>
    Effect.gen(function* () {
      const activity = yield* ToolActivity.Service
      const firstStarted = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      const otherStarted = yield* Deferred.make<void>()
      const otherRelease = yield* Deferred.make<void>()

      const first = yield* hold(firstStarted, firstRelease).pipe(Effect.forkScoped)
      const second = yield* hold(secondStarted, secondRelease).pipe(Effect.forkScoped)
      const unrelated = yield* activity.lease(otherID).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            yield* Deferred.succeed(otherStarted, undefined)
            yield* Deferred.await(otherRelease)
          }),
        ),
        Effect.scoped,
        Effect.forkScoped,
      )
      yield* Deferred.await(firstStarted)
      yield* Deferred.await(secondStarted)
      yield* Deferred.await(otherStarted)
      expect(yield* activity.count(sessionID)).toBe(2)
      expect(yield* activity.count(otherID)).toBe(1)
      expect(Array.from(yield* activity.holding).toSorted()).toEqual([sessionID, otherID].toSorted())

      yield* Deferred.succeed(firstRelease, undefined)
      yield* Fiber.join(first)
      expect(yield* activity.count(sessionID)).toBe(1)
      expect(yield* activity.count(otherID)).toBe(1)

      yield* Deferred.succeed(secondRelease, undefined)
      yield* Fiber.join(second)
      expect(yield* activity.count(sessionID)).toBe(0)
      expect(Array.from(yield* activity.holding)).toEqual([otherID])

      yield* Deferred.succeed(otherRelease, undefined)
      yield* Fiber.join(unrelated)
      expect(yield* activity.holding).toEqual(new Set())
    }),
  )

  it.effect("releases a lease after success, failure, interruption, and defect", () =>
    Effect.gen(function* () {
      const activity = yield* ToolActivity.Service
      const run = <A, E>(effect: Effect.Effect<A, E>) =>
        activity.lease(sessionID).pipe(Effect.andThen(effect), Effect.scoped)

      yield* run(Effect.void)
      expect(yield* activity.count(sessionID)).toBe(0)

      const failed = yield* run(Effect.fail("nope")).pipe(Effect.flip)
      expect(failed).toBe("nope")
      expect(yield* activity.count(sessionID)).toBe(0)

      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const fiber = yield* hold(started, release).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(yield* activity.count(sessionID)).toBe(1)
      yield* Fiber.interrupt(fiber)
      expect(yield* activity.count(sessionID)).toBe(0)

      const died = yield* run(Effect.die("tool defect")).pipe(Effect.exit)
      expect(died._tag).toBe("Failure")
      expect(yield* activity.count(sessionID)).toBe(0)
      expect(yield* activity.holding).toEqual(new Set())
    }),
  )
})
