import { describe, expect } from "bun:test"
import { Clock, Context, Deferred, Duration, Effect, Fiber, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { Node } from "@opencode/util/effect/app-node"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const single = testEffect(AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node])))
const located = testEffect(Layer.empty)
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
  method: "oauth" as const,
})

describe("OAuth refresh safety", () => {
  single.effect("uses an imported access token only outside the refresh window", () =>
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

  single.effect("rejects expired imported auth even when the method has no refresh callback", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      yield* register()
      const credential = yield* create(0, true)
      const error = yield* integration.connection.resolve(connection(credential)).pipe(Effect.flip)
      expect(error.cause).toEqual(expect.objectContaining({ message: expect.stringContaining("refresh is disabled") }))
    }),
  )

  single.effect("coalesces concurrent refreshes and rereads the persisted replacement", () =>
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

  single.effect("does not serialize different credentials", () =>
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

  single.effect("releases a timed-out refresh lock after its first caller is interrupted", () =>
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
      const waiting = yield* integration.connection.resolve(connection(credential)).pipe(Effect.flip, Effect.forkScoped)
      yield* Effect.yieldNow
      // Credential owns refresh independently of the caller; its timeout must still release the lock.
      yield* TestClock.adjust("30 seconds")
      expect(yield* Fiber.join(waiting)).toBeInstanceOf(Integration.AuthorizationError)
      expect((yield* credentials.get(credential.id))?.value).toEqual(credential.value)
      expect(yield* integration.connection.resolve(connection(credential))).toMatchObject({ expires: now + 3_600_000 })
      expect(yield* Ref.get(calls)).toBe(2)
    }),
  )

  single.effect("releases the refresh lock after failure without replacing stored auth", () =>
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

const locations = Effect.gen(function* () {
  const layer = LayerNode.compile(LayerNode.group([Integration.node, Credential.node]), {
    shared: Node.tags.values.global,
  })
  const memo = yield* Layer.makeMemoMap
  const scope = yield* Effect.scope
  const first = yield* Layer.buildWithMemoMap(layer, memo, scope)
  const second = yield* Layer.buildWithMemoMap(layer, memo, scope)
  const a = Context.get(first, Integration.Service)
  const b = Context.get(second, Integration.Service)
  const credentials = Context.get(first, Credential.Service)
  expect(a).not.toBe(b)
  expect(credentials).toBe(Context.get(second, Credential.Service))
  return { a, b, credentials }
})

for (const cancel of [false, true]) {
  located.effect(`shares refresh across Locations${cancel ? " after the first caller is interrupted" : ""}`, () =>
    Effect.gen(function* () {
      const services = yield* locations
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("oauth")
      let calls = 0
      const registration = {
        integrationID,
        method: { id: methodID, type: "oauth" as const, label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: (value: Credential.OAuth) =>
          Effect.gen(function* () {
            calls++
            expect(value.refresh).toBe("old-refresh")
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return Credential.OAuth.make({
              ...value,
              access: "new-access",
              refresh: "new-refresh",
              expires: Number.MAX_SAFE_INTEGER,
            })
          }),
      }
      yield* services.a.transform((editor) => editor.method.update(registration))
      yield* services.b.transform((editor) => editor.method.update(registration))
      const stored = yield* services.credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "old-access",
          refresh: "old-refresh",
          expires: 1,
        }),
      })
      const connection = { type: "credential" as const, id: stored.id, label: stored.label, method: "oauth" as const }
      const first = yield* services.a.connection.resolve(connection).pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      if (cancel) yield* Fiber.interrupt(first)
      const second = yield* services.b.connection.resolve(connection).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      expect(calls).toBe(1)
      yield* Deferred.succeed(release, undefined)
      const value = yield* Fiber.join(second)
      if (!cancel) expect(yield* Fiber.join(first)).toEqual(value)
      expect((yield* services.credentials.get(stored.id))?.value).toEqual(value)
      expect(yield* services.b.connection.resolve(connection)).toEqual(value)
      expect(calls).toBe(1)
    }),
  )
}

located.effect("bounds a stuck integration refresh and allows a later attempt", () =>
  Effect.gen(function* () {
    const services = yield* locations
    const entered = yield* Deferred.make<void>()
    const integrationID = Integration.ID.make("openai")
    const methodID = Integration.MethodID.make("oauth")
    const stored = yield* services.credentials.create({
      integrationID,
      value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "refresh", expires: 1 }),
    })
    yield* services.a.transform((editor) =>
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
      }),
    )
    const connection = { type: "credential" as const, id: stored.id, label: stored.label, method: "oauth" as const }
    const first = yield* services.a.connection.resolve(connection).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(entered)
    yield* TestClock.adjust("30 seconds")
    expect(yield* Fiber.join(first)).toBeInstanceOf(Integration.AuthorizationError)
    yield* services.a.transform((editor) =>
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: (value) =>
          Effect.succeed(Credential.OAuth.make({ ...value, access: "new", expires: Number.MAX_SAFE_INTEGER })),
      }),
    )
    expect(yield* services.a.connection.resolve(connection)).toMatchObject({ access: "new" })
  }),
)
