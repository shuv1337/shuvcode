import { describe, expect } from "bun:test"
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ID, Info, Ref, VariantID } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionSchema } from "@opencode/core/session/schema"
import { DateTime, Effect, Layer } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const catalogModel = (providerID: string, id: string) =>
  Info.make({
    id: ID.make(id),
    modelID: ID.make(id),
    providerID: Provider.ID.make(providerID),
    name: id,
    package: "test",
    settings: {},
    headers: {},
    body: {},
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

const fallback = catalogModel("opencode", "free-default")
const agentModel = catalogModel("openai", "agent-model")
const sessionModel = catalogModel("anthropic", "session-model")
const available = () => Effect.succeed([fallback, agentModel, sessionModel])

const resolvedFor = (model: Info, variant?: VariantID) =>
  SessionRunnerModel.resolved(
    LanguageModel.make({ id: model.id, provider: model.providerID, route: OpenAIChat.route }),
    { capabilities: model.capabilities, cost: model.cost, limit: model.limit, variant },
  )

const resolver = Layer.mock(ModelResolver.Service)({
  fallback: () => Effect.succeed(fallback),
  resolveModel: (model, variant) => Effect.succeed(resolvedFor(model, variant)),
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([SessionRunnerModel.node, Agent.node]), [ModelResolver.node.replace(resolver)]),
)

const session = (model?: Ref) =>
  SessionSchema.Info.make({
    id: SessionSchema.ID.make("ses_runner_model_test"),
    projectID: Project.ID.make("prj_runner_model_test"),
    agent: Agent.ID.make("build"),
    ...(model === undefined ? {} : { model }),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: { directory: AbsolutePath.make("/project") },
  } as SessionSchema.Info)

const request = { kind: "primary" as const, agent: Agent.ID.make("build") }

const agent = (model?: Ref) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(request.agent, (info) => {
        info.model = model
      }),
    )
  })

const ref = (model: Info, variant?: string) =>
  Ref.make({
    providerID: model.providerID,
    id: model.id,
    ...(variant === undefined ? {} : { variant: VariantID.make(variant) }),
  })

describe("SessionRunnerModel.resolve", () => {
  it.effect("uses the agent model, including its variant, when the Session has none", () =>
    Effect.gen(function* () {
      const models = yield* SessionRunnerModel.Service
      yield* agent(ref(agentModel, "medium"))
      const resolved = yield* models.resolve(session(), available, request)
      expect(resolved.ref).toEqual(ref(agentModel, "medium"))
    }),
  )

  it.effect("prefers the explicit Session model over the agent model", () =>
    Effect.gen(function* () {
      const models = yield* SessionRunnerModel.Service
      yield* agent(ref(agentModel))
      const resolved = yield* models.resolve(session(ref(sessionModel)), available, request)
      expect(resolved.ref).toEqual(ref(sessionModel))
    }),
  )

  it.effect("falls back to the catalog default when neither Session nor agent selects a model", () =>
    Effect.gen(function* () {
      const models = yield* SessionRunnerModel.Service
      expect((yield* models.resolve(session(), available, request)).ref).toEqual(ref(fallback))
      yield* agent()
      expect((yield* models.resolve(session(), available, request)).ref).toEqual(ref(fallback))
    }),
  )

  it.effect("reports an unavailable agent model instead of falling back to the default", () =>
    Effect.gen(function* () {
      const models = yield* SessionRunnerModel.Service
      const missing = Ref.make({ providerID: Provider.ID.make("openai"), id: ID.make("missing") })
      yield* agent(missing)
      const error = yield* models.resolve(session(), available, request).pipe(Effect.flip)
      expect(error).toEqual(
        new SessionRunnerModel.ModelUnavailableError({ providerID: missing.providerID, modelID: missing.id }),
      )
    }),
  )
})
