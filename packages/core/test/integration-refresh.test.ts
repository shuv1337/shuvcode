import { describe, expect } from "bun:test"
import { Clock, Deferred, Duration, Effect, Fiber, Ref } from "effect"
import { TestClock } from "effect/testing"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node])))
const integrationID = Integration.ID.make("anthropic")
const methodID = Integration.MethodID.make("claude-pro-max")

const register = (refresh?: Integration.OAuthImplementation["refresh"]) =>
  Effect.gen(function* () {
    const integration = yield* Integration.Service
    yield* integration.transform((editor) =>
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "Fixture" },
        authorize: () => Effect.die("Authorization is not part of this fixture"),
        ...(refresh ? { refresh } : {}),
      }),
    )
  })

const create = (expires: number, imported = false) =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    return yield* credentials.create({
      integrationID,
      value: Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "fixture-access",
        refresh: imported ? "" : "fixture-refresh",
        expires,
        ...(imported ? { metadata: { shuvcodeAuthImport: "access-only" } } : {}),
      }),
    })
  })

const connection = (credential: Credential.Info) => ({
  type: "credential" as const,
  id: credential.id,
  label: credential.label,
})

describe("OAuth refresh safety", () => {
  it.effect("uses an imported access token only outside the refresh window", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const refreshes = yield* Ref.make(0)
      yield* register((value) => Ref.update(refreshes, (count) => count + 1).pipe(Effect.as(value)))
      const now = yield* Clock.currentTimeMillis
      const credential = yield* create(now + Duration.toMillis("6 minutes"), true)
      expect(yield* integration.connection.resolve(connection(credential))).toEqual(credential.value)
      yield* TestClock.adjust("1 minute")
      const error = yield* integration.connection.resolve(connection(credential)).pipe(Effect.flip)
      expect(error.cause).toEqual(expect.objectContaining({ message: expect.stringContaining("refresh is disabled") }))
      expect(yield* Ref.get(refreshes)).toBe(0)
    }),
  )

  it.effect("rejects expired imported auth even when the method has no refresh callback", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      yield* register()
      const credential = yield* create(0, true)
      const error = yield* integration.connection.resolve(connection(credential)).pipe(Effect.flip)
      expect(error.cause).toEqual(expect.objectContaining({ message: expect.stringContaining("refresh is disabled") }))
    }),
  )

  it.effect("coalesces concurrent refreshes and rereads the persisted replacement", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const now = yield* Clock.currentTimeMillis
      const calls = yield* Ref.make(0)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* register((value) =>
        Effect.gen(function* () {
          yield* Ref.update(calls, (count) => count + 1)
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return Credential.OAuth.make({
            ...value,
            access: "replacement-access",
            refresh: "replacement-refresh",
            expires: now + 3_600_000,
          })
        }),
      )
      const credential = yield* create(now)
      const first = yield* integration.connection.resolve(connection(credential)).pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      const second = yield* integration.connection.resolve(connection(credential)).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      const values = yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      expect(yield* Ref.get(calls)).toBe(1)
      expect(values[0]).toEqual(values[1])
      expect((yield* credentials.get(credential.id))?.value).toEqual(values[0])
      expect(values[0]).toMatchObject({ access: "replacement-access", refresh: "replacement-refresh" })
    }),
  )

  it.effect("does not serialize different credentials", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const now = yield* Clock.currentTimeMillis
      const entered = yield* Ref.make(0)
      const both = yield* Deferred.make<void>()
      yield* register((value) =>
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(entered, (n) => n + 1)
          if (count === 2) yield* Deferred.succeed(both, undefined)
          yield* Deferred.await(both)
          return Credential.OAuth.make({ ...value, expires: now + 3_600_000 })
        }),
      )
      const first = yield* create(now)
      const second = yield* create(now)
      yield* Effect.all(
        [integration.connection.resolve(connection(first)), integration.connection.resolve(connection(second))],
        { concurrency: "unbounded" },
      )
      expect(yield* Ref.get(entered)).toBe(2)
    }),
  )

  it.effect("releases the refresh lock when its owner is interrupted", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const now = yield* Clock.currentTimeMillis
      const calls = yield* Ref.make(0)
      const entered = yield* Deferred.make<void>()
      yield* register((value) =>
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(calls, (n) => n + 1)
          if (count === 1) {
            yield* Deferred.succeed(entered, undefined)
            return yield* Effect.never
          }
          return Credential.OAuth.make({ ...value, expires: now + 3_600_000 })
        }),
      )
      const credential = yield* create(now)
      const pending = yield* integration.connection.resolve(connection(credential)).pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(pending)
      expect((yield* credentials.get(credential.id))?.value).toEqual(credential.value)
      expect(yield* integration.connection.resolve(connection(credential))).toMatchObject({ expires: now + 3_600_000 })
      expect(yield* Ref.get(calls)).toBe(2)
    }),
  )

  it.effect("releases the refresh lock after failure without replacing stored auth", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const calls = yield* Ref.make(0)
      const now = yield* Clock.currentTimeMillis
      yield* register((value) =>
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(calls, (n) => n + 1)
          if (count === 1) return yield* Effect.fail(new Error("fixture refresh failed"))
          return Credential.OAuth.make({ ...value, expires: now + 3_600_000 })
        }),
      )
      const credential = yield* create(now)
      yield* integration.connection.resolve(connection(credential)).pipe(Effect.flip)
      expect((yield* credentials.get(credential.id))?.value).toEqual(credential.value)
      expect(yield* integration.connection.resolve(connection(credential))).toMatchObject({ expires: now + 3_600_000 })
      expect(yield* Ref.get(calls)).toBe(2)
    }),
  )
})
