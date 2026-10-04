import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Review complete", "review") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: (session) =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: session.model?.id ?? "parent", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ]),
  ),
)

const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })

const inheritanceIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    Watcher.node.replace(Watcher.configured({ enabled: false })),
    LayerNodePlatform.llmClient.replace(llmLayer),
  ]),
)

describe("command subagents", () => {
  for (const agent of ["explore", "general", "reviewer"]) {
    inheritanceIt.live(
      agent === "reviewer"
        ? "prefers the child's configured model over the parent agent model"
        : `inherits the parent's resolved agent model and variant for ${agent}`,
      () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          yield* Effect.promise(() =>
            Bun.write(
              path.join(tmp.path, "opencode.json"),
              JSON.stringify({
                agents: {
                  build: { model: "test/parent#fast" },
                  reviewer: { mode: "subagent", model: "test/child#fast" },
                },
                providers: {
                  test: {
                    package: "@opencode/ai/providers/openai/chat",
                    settings: { apiKey: "test" },
                    models: { parent: { variants: [{ id: "fast" }] }, child: { variants: [{ id: "fast" }] } },
                  },
                },
                commands: { review: { subagent: true, agent, template: "Review $ARGUMENTS" } },
              }),
            ),
          )
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(tmp.path) },
            agent: Agent.ID.make("build"),
          })
          expect(parent.model).toBeUndefined()
          yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
          const children = (yield* sessions.list({ parentID: parent.id })).data
          expect(children).toHaveLength(1)
          expect(children[0]?.model).toEqual({
            ...parentModel,
            id: Model.ID.make(agent === "reviewer" ? "child" : "parent"),
            variant: Model.VariantID.make("fast"),
          })
          expect((yield* sessions.get(parent.id)).model).toBeUndefined()
        }),
    )
  }

  inheritanceIt.live("keeps catalog-default command children model-less and follows later default changes", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, "opencode.json"),
          JSON.stringify({
            model: "test/initial",
            providers: {
              test: {
                package: "@opencode/ai/providers/openai/chat",
                settings: { apiKey: "test" },
                models: { initial: {}, later: {} },
              },
            },
            commands: { review: { subagent: true, agent: "general", template: "Review $ARGUMENTS" } },
          }),
        ),
      )
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({
        location: { directory: AbsolutePath.make(tmp.path) },
        agent: Agent.ID.make("build"),
      })
      yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
      const children = (yield* sessions.list({ parentID: parent.id })).data
      expect(children).toHaveLength(1)
      const child = children[0]
      if (!child) return yield* Effect.die("Expected a child session")
      expect(child.model).toBeUndefined()
      const locations = yield* LocationServiceMap.Service
      const models = yield* Model.Service.pipe(Effect.provide(locations.get(parent.location)))
      const runner = yield* SessionRunnerModel.Service.pipe(Effect.provide(locations.get(parent.location)))
      expect((yield* runner.resolve(child, models.available)).ref.id).toBe(Model.ID.make("initial"))
      yield* models.transform((editor) => editor.default.set(Provider.ID.make("test"), Model.ID.make("later")))
      expect((yield* runner.resolve(child, models.available)).ref.id).toBe(Model.ID.make("later"))
      expect((yield* sessions.get(child.id)).model).toBeUndefined()
      expect((yield* sessions.get(parent.id)).model).toBeUndefined()
    }),
  )

  for (const fixture of [
    {
      name: "native JSON",
      format: "json",
      command: { subagent: true, agent: "build", model: "test/override" },
      agent: "build",
      model: "override",
    },
    {
      name: "legacy Markdown",
      format: "markdown",
      command: { subtask: true, agent: "build" },
      agent: "build",
      model: "parent",
    },
    {
      name: "subagent mode by default",
      format: "json",
      command: { agent: "reviewer" },
      agent: "reviewer",
      model: "child",
    },
  ] as const) {
    it.live(`runs ${fixture.name} in the background without switching the parent`, () =>
      Effect.gen(function* () {
        const parent = yield* project(fixture.command, fixture.format)
        const sessions = yield* Session.Service
        const llm = yield* TestLLM.Test
        const gate = yield* llm.gate()

        // This must return while the child's model is still blocked.
        yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
        yield* gate.started
        const children = (yield* sessions.list({ parentID: parent.id })).data
        expect(children).toHaveLength(1)
        const child = children[0]
        if (!child) return yield* Effect.die("Expected a child session")
        expect(child).toMatchObject({ agent: fixture.agent, model: { id: fixture.model }, title: "Review code" })
        expect(yield* sessions.get(parent.id)).toMatchObject({ agent: "build", model: parentModel })
        expect(yield* sessions.context(parent.id)).toEqual([])
        expect(yield* llm.requests()).toHaveLength(1)
        expect((yield* sessions.context(child.id)).filter((message) => message.type === "user")).toMatchObject([
          { text: "You are a subagent spawned by another session.\nReview changes: ready" },
        ])
        yield* gate.release
        yield* llm.wait(2)
        yield* sessions.wait(parent.id)
        const notices = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
        expect(notices).toMatchObject([{ metadata: { source: "subagent", childID: child.id, state: "completed" } }])
        expect(notices[0]?.text).toContain("Review complete")
      }),
    )
  }

  it.live("subagent: false overrides subagent mode and the legacy alias", () =>
    Effect.gen(function* () {
      const parent = yield* project({ subagent: false, subtask: true, agent: "reviewer" }, "json")
      const sessions = yield* Session.Service
      yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
      yield* sessions.wait(parent.id)
      expect((yield* sessions.list({ parentID: parent.id })).data).toEqual([])
      expect(yield* sessions.get(parent.id)).toMatchObject({
        agent: "reviewer",
        model: { id: "child" },
      })
      expect((yield* sessions.context(parent.id)).filter((message) => message.type === "user")).toMatchObject([
        { text: "Review changes: ready" },
      ])
    }),
  )
})

function project(
  command: { agent?: string; model?: string; subagent?: boolean; subtask?: boolean },
  format: "json" | "markdown",
) {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const definition = { description: "Review code", template: "Review $ARGUMENTS: !`printf ready`", ...command }
    yield* Effect.promise(() =>
      Bun.write(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({
          agents: { reviewer: { mode: "subagent", model: "test/child" } },
          ...(format === "markdown" ? {} : { commands: { review: definition } }),
        }),
      ),
    )
    if (format === "markdown")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/commands/review.md"),
          [
            "---",
            "description: Review code",
            ...Object.entries(command).map(([key, value]) => `${key}: ${value}`),
            "---",
            definition.template,
          ].join("\n"),
        ),
      )
    const sessions = yield* Session.Service
    return yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      title: "Parent session",
      agent: Agent.ID.make("build"),
      model: parentModel,
    })
  })
}
