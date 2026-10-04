import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionContext } from "@opencode/core/session/context"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTitle } from "@opencode/core/session/title"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const llm = TestLLM.testLayer({ fallback: TestLLM.text("Generated title", "title") })
const it = testEffect(
  Layer.merge(
    llm,
    AppNodeBuilder.build(LayerNode.group([Session.node, Bus.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llm),
    ]),
  ),
)

describe("title model selection for an agent-configured parent", () => {
  for (const small of [true, false]) {
    it.live(
      small
        ? "uses a small model on the agent model's provider"
        : "falls back to the full agent model and variant when no small model exists",
      () =>
        Effect.gen(function* () {
          const session = yield* project({ small })
          const locations = yield* LocationServiceMap.Service
          const context = yield* SessionContext.Service.pipe(Effect.provide(locations.get(session.location)))
          const selection = yield* context.selectTitle(session)
          expect(selection?.primary?.ref).toEqual(Model.Ref.parse("primary/full#high"))
          expect(selection?.selected.ref).toEqual(
            small ? Model.Ref.parse("primary/small#none") : selection?.primary?.ref,
          )
          const titles = yield* SessionTitle.Service.pipe(Effect.provide(locations.get(session.location)))
          yield* titles.generate(session.id)
          const test = yield* TestLLM.Test
          const requests = yield* test.requests()
          expect(requests).toHaveLength(1)
          expect(String(requests[0]?.model.id)).toBe(small ? "small" : "full")
          const sessions = yield* Session.Service
          expect((yield* sessions.get(session.id)).title).toBe("Generated title")
          expect((yield* sessions.get(session.id)).model).toBeUndefined()
        }),
    )
  }

  it.live("skips title generation when the configured agent model is unavailable", () =>
    Effect.gen(function* () {
      const session = yield* project({ small: true, unavailable: true })
      const locations = yield* LocationServiceMap.Service
      const titles = yield* SessionTitle.Service.pipe(Effect.provide(locations.get(session.location)))
      yield* titles.generate(session.id)
      const test = yield* TestLLM.Test
      expect(yield* test.requests()).toEqual([])
      const sessions = yield* Session.Service
      expect((yield* sessions.get(session.id)).title).toBeUndefined()
    }),
  )
})

function project(options: { small: boolean; unavailable?: boolean }) {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({
          model: "fallback/free",
          agents: { build: { model: options.unavailable ? "primary/missing" : "primary/full#high" } },
          providers: {
            primary: {
              package: "@opencode/ai/providers/openai/chat",
              settings: { apiKey: "test" },
              models: {
                full: { variants: [{ id: "high" }] },
                ...(options.small ? { small: { family: "gpt-luna", variants: [{ id: "none" }] } } : {}),
              },
            },
            fallback: {
              package: "@opencode/ai/providers/openai/chat",
              settings: { apiKey: "test" },
              models: { free: { family: "gpt-luna" } },
            },
          },
        }),
      ),
    )
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      agent: Agent.ID.make("build"),
    })
    expect(session.model).toBeUndefined()
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
      Effect.provide(locations.get(session.location)),
    )
    const models = yield* Model.Service.pipe(Effect.provide(locations.get(session.location)))
    expect((yield* models.default())?.providerID).toBe(Provider.ID.make("fallback"))
    const bus = yield* Bus.Service
    const inboxID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.InboxEnqueued, {
      sessionID: session.id,
      inboxID,
      item: { type: "user", payload: { text: "Review this project" }, delivery: "steer" },
    })
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: session.id, inboxID })
    return session
  })
}
