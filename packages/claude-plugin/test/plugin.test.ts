import { expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { IntegrationMethodRegistration } from "@opencode/plugin/effect/integration"
import type { ModelEditor } from "@opencode/plugin/effect/model"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Credential } from "@opencode/schema/credential"
import { Event } from "@opencode/schema/event"
import { IntegrationID } from "@opencode/schema/integration-id"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Deferred, Effect, Stream } from "effect"
import { createPlugin } from "../src/index.js"
import { methodID } from "../src/oauth.js"

test("public plugin registers filtered hooks, OAuth/env methods, zero cost and account-change lifecycle", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const reloaded = yield* Deferred.make<void>()
        const switched = yield* Deferred.make<void>()
        const methods: IntegrationMethodRegistration[] = []
        const registered: Array<{ name: keyof SessionHooks; providerID?: string }> = []
        const transforms: Array<(editor: ModelEditor) => void> = []
        let current: Credential.Value = Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "fixture",
          refresh: "native",
          expires: 9999999999999,
        })
        const source = Model.Info.default(Provider.ID.make("anthropic"), Model.ID.make("claude-sonnet-4"))
        // A minimal public-domain fixture: only members the plugin owns are present; no Core service or global mocks.
        const context = {
          integration: {
            connection: {
              active: () => Effect.succeed({ type: "env" as const, name: "CLAUDE_CODE_OAUTH_TOKEN" }),
              resolve: () => Effect.sync(() => current),
            },
            transform: (callback) =>
              Effect.sync(() => {
                callback({
                  list: () => [{ id: "anthropic", name: "Anthropic" }],
                  get: () => ({ id: "anthropic", name: "Anthropic" }),
                  update: () => {},
                  remove: () => {},
                  method: {
                    list: () => [{ type: "env", names: ["EXISTING_KEY"] }],
                    update: (method) => {
                      methods.push(method)
                    },
                    remove: () => {},
                  },
                })
                return { dispose: Effect.void }
              }),
          } satisfies Pick<Context["integration"], "connection" | "transform">,
          model: {
            transform: (callback) =>
              Effect.sync(() => {
                transforms.push(callback)
                return { dispose: Effect.void }
              }),
            reload: () => Deferred.succeed(reloaded, undefined).pipe(Effect.asVoid),
          } satisfies Pick<Context["model"], "transform" | "reload">,
          session: {
            hook: (name, _, options) =>
              Effect.sync(() => {
                registered.push({ name, providerID: options?.providerID })
                return { dispose: Effect.void }
              }),
          } satisfies Pick<Context["session"], "hook">,
          event: {
            subscribe: () =>
              Stream.fromEffect(Deferred.await(switched)).pipe(
                Stream.map(() => ({
                  id: Event.ID.make("evt_fixture"),
                  created: 1,
                  type: "credential.switched" as const,
                  data: { integrationID: IntegrationID.make("anthropic"), credentialID: null },
                })),
              ),
          } satisfies Context["event"],
        }
        yield* createPlugin({
          fetch: async () => {
            throw new Error("No OAuth calls expected")
          },
        }).effect(context as unknown as Context)
        expect(registered).toEqual([
          { name: "http.request", providerID: "anthropic" },
          { name: "http.response", providerID: "anthropic" },
        ])
        expect(methods.find((method) => method.method.type === "oauth")?.method).toEqual({
          type: "oauth",
          id: methodID,
          label: "Claude Pro/Max",
        })
        expect(methods.find((method) => method.method.type === "env")?.method).toEqual({
          type: "env",
          names: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "EXISTING_KEY"],
        })
        let updates = 0
        const editor: ModelEditor = {
          list: () => [structuredClone(source)],
          get: () => structuredClone(source),
          update: (_, __, update) => {
            updates++
            const draft = structuredClone(source)
            update(draft)
            expect(draft.cost).toEqual([])
          },
          remove: () => {},
          default: { get: () => undefined, set: () => {} },
          provider: { list: () => [], get: () => undefined },
        }
        transforms[0](editor)
        expect(updates).toBe(1)
        current = { type: "key", key: "sk-ant-api03-normal" }
        yield* Deferred.succeed(switched, undefined)
        yield* Deferred.await(reloaded)
        transforms[0](editor)
        expect(updates).toBe(1)
      }),
    ),
  )
})
