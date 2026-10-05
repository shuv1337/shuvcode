import { afterEach, beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { evaluationClient } from "@opencode/core/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Form } from "@opencode/core/form"
import { Image } from "@opencode/core/image"
import { Integration } from "@opencode/core/integration"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { JevTool } from "@opencode/core/tool/plugin/jev"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { integrationHost } from "./plugin/host"

const key = "ts-secret-key-value"
const sessionID = Session.ID.make("ses_jev_test")
const requests: Array<{ readonly url: string; readonly headers: Record<string, string>; readonly body: unknown }> = []
const assertions: Permission.AssertInput[] = []
let response = { status: 200, body: "" }

const jevToolNode = makeLocationNode({
  name: "test/jev-tool-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* registerToolPlugin(JevTool.Plugin, { integration: integrationHost(integrations) })
    }),
  ),
  deps: [Tool.node, Permission.node, Config.node, Integration.node, evaluationClient],
})

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : undefined
      requests.push({
        url: request.url,
        headers: request.headers,
        body: body === undefined ? undefined : JSON.parse(body),
      })
      return HttpClientResponse.fromWeb(
        request,
        new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } }),
      )
    }),
  ),
)

const layer = (entries: Entry[]) =>
  AppNodeBuilder.build(
    LayerNode.group([Tool.node, Integration.node, Credential.node, Bus.node, Form.node, jevToolNode]),
    [
      Config.node.replace(Config.testLayer(entries)),
      Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => assertions.push(input)) })),
      Image.node.replace(imagePassthrough),
      LayerNodePlatform.httpClient.replace(http),
    ],
  )

const enabled = [
  new Document({ type: "document", info: new Info({ experimental: new ConfigExperimental.Info({ jev: true }) }) }),
]
const it = testEffect(layer(enabled))
const disabled = testEffect(layer([]))

// Calls jev.systemOne the way the session model does, from Code Mode.
const call = (input: unknown, id = "call-jev") => ({
  sessionID,
  ...toolIdentity,
  call: {
    type: "tool-call" as const,
    id,
    name: "execute",
    input: { code: `return await tools.jev.systemOne(${JSON.stringify(input)})` },
  },
})

const ask = (input: unknown, id = "call-jev") =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    const result = yield* executeTool(registry, call(input, id))
    expect(JSON.stringify(result)).not.toContain(key)
    if (result.output.error) return { error: result.output.output as string }
    return { value: JSON.parse(result.output.output) }
  })

const connect = Effect.gen(function* () {
  const integrations = yield* Integration.Service
  yield* integrations.connection.key({ integrationID: Integration.ID.make(JevTool.integrationID), key })
})

const reply = (body: unknown, status = 200) => {
  response = { status, body: typeof body === "string" ? body : JSON.stringify(body) }
}

const previousEnv = process.env[JevTool.envName]

beforeEach(() => {
  requests.length = 0
  assertions.length = 0
  reply({ model: "jev-1.13.0", answers: {} })
  delete process.env[JevTool.envName]
})

afterEach(() => {
  if (previousEnv === undefined) delete process.env[JevTool.envName]
  else process.env[JevTool.envName] = previousEnv
})

describe("JevTool", () => {
  disabled.effect("is not registered unless experimental.jev is enabled", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const toolSet = yield* registry.snapshot()
      expect(toolSet.definitions.map((tool) => tool.name)).not.toContain(JevTool.effectiveName)
      expect(codeModeListings(toolSet.codeModeCatalog!).map((tool) => tool.path)).not.toContain("jev.systemOne")
      const integrations = yield* Integration.Service
      expect(yield* integrations.get(Integration.ID.make(JevTool.integrationID))).toBeUndefined()
    }),
  )

  it.effect("registers jev.systemOne in Code Mode and the TypeSafe integration", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const toolSet = yield* registry.snapshot()
      expect(toolSet.definitions.map((tool) => tool.name)).not.toContain(JevTool.effectiveName)
      expect(codeModeListings(toolSet.codeModeCatalog!).map((tool) => tool.path)).toContain("jev.systemOne")
      const integrations = yield* Integration.Service
      expect(yield* integrations.get(Integration.ID.make(JevTool.integrationID))).toMatchObject({
        name: "TypeSafe",
        methods: [{ type: "key" }, { type: "env", names: [JevTool.envName] }],
      })
    }),
  )

  it.effect("fails with a configuration error and makes no request without a key", () =>
    Effect.gen(function* () {
      expect(
        yield* ask({ state: "diff", questions: { api: { type: "boolean", instructions: "Public API change?" } } }),
      ).toEqual({ error: JevTool.NOT_CONFIGURED })
      expect(requests).toHaveLength(0)
      expect(assertions).toHaveLength(0)
    }),
  )

  it.effect("asks boolean, choice, and score questions and returns typed answers", () =>
    Effect.gen(function* () {
      yield* connect
      reply({
        model: "jev-1.13.0",
        answers: {
          api: { type: "noul", noul: 0.83 },
          approach: {
            type: "choice",
            choice: "adapter",
            probabilities: { adapter: 0.7, rewrite: 0.2, flag: 0.1 },
            confidence: 0.6,
          },
          risk: { type: "score", score: 1, probabilities: { "0": 0.2, "1": 0.7, "2": 0.1 } },
        },
        usage: { input_tokens: 40, output_tokens: 3 },
      })
      const questions = {
        api: { type: "boolean", instructions: "Does this diff change the public API?" },
        approach: {
          type: "choice",
          instructions: "Which approach fits best?",
          criteria: { adapter: "Wrap the old API", rewrite: "Replace it", flag: "Gate it behind a flag" },
        },
        risk: { type: "score", instructions: "How risky is this change?", criteria: ["Low", "Medium", "High"] },
      }

      expect(yield* ask({ state: "diff --git a/x b/x", questions })).toEqual({
        value: {
          model: "jev-1.13.0",
          answers: {
            api: { type: "boolean", probability: 0.83 },
            approach: {
              type: "choice",
              choice: "adapter",
              probabilities: { adapter: 0.7, rewrite: 0.2, flag: 0.1 },
              confidence: 0.6,
            },
            risk: { type: "score", score: 1, probabilities: { "0": 0.2, "1": 0.7, "2": 0.1 } },
          },
        },
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe("https://api.typesafe.ai/v1/systemone")
      expect(requests[0]?.headers.authorization).toBe(`Bearer ${key}`)
      expect(requests[0]?.body).toEqual({
        model: JevTool.defaultModel,
        state: "diff --git a/x b/x",
        questions: { ...questions, api: { type: "noul", instructions: "Does this diff change the public API?" } },
      })
      expect(assertions).toEqual([
        expect.objectContaining({
          action: JevTool.effectiveName,
          resources: [JevTool.defaultModel],
          sessionID,
          metadata: { model: JevTool.defaultModel, questions: ["api", "approach", "risk"] },
        }),
      ])
    }),
  )

  it.effect("uses TYPESAFE_API_KEY and a requested model", () =>
    Effect.gen(function* () {
      process.env[JevTool.envName] = "env-key"
      reply({ model: "jev-1.12.0", answers: { done: { type: "noul", noul: 0.1 } } })
      expect(
        yield* ask({
          model: "jev-1.12",
          state: { task: "ship" },
          questions: { done: { type: "boolean", instructions: "Is it done?" } },
        }),
      ).toEqual({ value: { model: "jev-1.12.0", answers: { done: { type: "boolean", probability: 0.1 } } } })
      expect(requests[0]?.headers.authorization).toBe("Bearer env-key")
      expect(requests[0]?.body).toMatchObject({ model: "jev-1.12", state: { task: "ship" } })
    }),
  )

  it.effect("maps HTTP failures to clear errors without leaking the key", () =>
    Effect.gen(function* () {
      yield* connect
      const input = { state: "x", questions: { ok: { type: "boolean", instructions: "OK?" } } }
      const cases = [
        [401, `TypeSafe rejected the System One credentials. Check ${JevTool.envName} or the TypeSafe connection.`],
        [429, "TypeSafe System One rate limited the request. Try again later."],
        [500, "System One request failed: "],
      ] as const
      for (const [status, message] of cases) {
        reply({ error: { message: `failed with ${status}` } }, status)
        const result = yield* ask(input, `call-${status}`)
        expect(result.error).toStartWith(message)
      }
      expect(requests.map((request) => request.headers.authorization)).toEqual(cases.map(() => `Bearer ${key}`))
    }),
  )

  it.effect("reports invalid provider output and answers that do not match the questions", () =>
    Effect.gen(function* () {
      yield* connect
      const input = { state: "x", questions: { ok: { type: "boolean", instructions: "OK?" } } }

      reply("not json")
      expect(yield* ask(input, "call-invalid")).toEqual({
        error: "System One request failed: System One returned an invalid response",
      })

      reply({ model: "jev-1.13.0", answers: { other: { type: "noul", noul: 0.5 } } })
      expect(yield* ask(input, "call-mismatch")).toEqual({
        error: "System One request failed: Evaluation answers do not match the requested questions",
      })
    }),
  )

  it.effect("rejects an empty question map before calling the API", () =>
    Effect.gen(function* () {
      yield* connect
      const result = yield* ask({ state: "x", questions: {} })
      expect(result.error).toStartWith("Invalid System One request:")
      expect(requests).toHaveLength(0)
    }),
  )
})
