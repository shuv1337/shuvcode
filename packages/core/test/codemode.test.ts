import { describe, expect } from "bun:test"
import { CodeModeTool } from "@opencode-ai/core/codemode/tool"
import { Config } from "@opencode-ai/core/config"
import { ConfigCodeMode } from "@opencode-ai/core/config/codemode"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { Cause, Effect, Exit, Layer, Schema, Stream } from "effect"
import { it } from "./lib/effect"
import { toolIdentity } from "./lib/tool"

const configLayer = (info?: ConfigCodeMode.Info) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed(
          info === undefined
            ? []
            : [new Config.Document({ type: "document", info: new Config.Info({ codemode: info }) })],
        ),
      changes: () => Stream.empty,
    }),
  )

const node = (info?: ConfigCodeMode.Info) =>
  AppNodeBuilder.build(LayerNode.group([Tool.node, Config.node]), [
    [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    [Config.node, configLayer(info)],
  ])

const toolNode = node()

const counter = {
  name: "tick",
  description: "Count a call",
  input: Schema.Struct({}),
  output: Schema.String,
  execute: () => Effect.succeed({ output: "ok" }),
} as const

const runProgram = (code: string, id: string) =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    yield* tools.transform((draft) => draft.add(counter))
    const snapshot = yield* tools.snapshot()
    return yield* snapshot.execute({
      sessionID: Session.ID.make("ses_codemode_limits"),
      ...toolIdentity,
      call: { type: "tool-call", id, name: "execute", input: { code } },
    })
  })

const outputText = (result: { readonly content: ReadonlyArray<Tool.Content> }) =>
  result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

describe("CodeMode", () => {
  it.effect("owns registrations, execute, and catalog materialization", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* tools.transform((draft) =>
        draft.add({
          name: "echo",
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          options: { pinned: true },
          execute: ({ text }) => Effect.succeed({ output: text }),
        }),
      )

      const snapshot = yield* tools.snapshot()
      expect(snapshot.definitions.some((tool) => tool.name === "execute")).toBe(true)
      expect(snapshot.codeModeCatalog).toStrictEqual([
        {
          path: "echo",
          description: "Echo text",
          signature: "tools.echo(input: {\n  text: string,\n}): Promise<string>",
          pinned: true,
        },
      ])
    }).pipe(Effect.scoped, Effect.provide(toolNode)),
  )

  it.effect("aborts the step when a tool inside a program is declined", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* tools.transform((draft) =>
        draft.add({
          name: "restricted",
          description: "Requires permission",
          input: Schema.Struct({}),
          output: Schema.String,
          // Permission.assert raises a decline through this same defect tunnel.
          execute: () => Effect.die(new Permission.DeclinedError()),
        }),
      )

      const snapshot = yield* tools.snapshot()
      const exit = yield* Effect.exit(
        snapshot.execute({
          sessionID: Session.ID.make("ses_codemode_decline"),
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-decline",
            name: "execute",
            input: { code: "return await tools.restricted({})" },
          },
        }),
      )

      // A decline must reach the runner as a defect, not as a completed execute result the model
      // can shrug off.
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) return
      const defects = exit.cause.reasons.flatMap((reason) => (Cause.isDieReason(reason) ? [reason.defect] : []))
      expect(defects.some((defect) => defect instanceof Permission.DeclinedError)).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(toolNode)),
  )
})

describe("CodeMode execution limits", () => {
  it.effect("caps unbounded tool fan-out at the default tool-call limit", () =>
    Effect.gen(function* () {
      const limit = CodeModeTool.DEFAULT_LIMITS.maxToolCalls
      const result = yield* runProgram(
        `for (let i = 0; i <= ${limit}; i++) await tools.tick({})`,
        "call-default-tool-calls",
      )

      const toolCalls = result.metadata?.toolCalls
      expect(result.metadata?.error).toBe(true)
      expect(outputText(result)).toContain(`Execution exceeded its tool-call limit of ${limit}.`)
      expect(Array.isArray(toolCalls) ? toolCalls.length : undefined).toBe(limit)
    }).pipe(Effect.scoped, Effect.provide(toolNode)),
  )

  it.effect("honours a configured tool-call limit", () =>
    Effect.gen(function* () {
      const result = yield* runProgram("for (let i = 0; i < 5; i++) await tools.tick({})", "call-configured-limit")

      expect(outputText(result)).toContain("Execution exceeded its tool-call limit of 2.")
    }).pipe(Effect.scoped, Effect.provide(node(new ConfigCodeMode.Info({ max_tool_calls: 2 })))),
  )

  it.effect("honours a configured output limit", () =>
    Effect.gen(function* () {
      const result = yield* runProgram(`return "x".repeat(500)`, "call-configured-output")

      expect(outputText(result)).toContain("exceeds the 32-byte output limit")
    }).pipe(Effect.scoped, Effect.provide(node(new ConfigCodeMode.Info({ max_output_bytes: 32 })))),
  )

  it.live("interrupts a busy loop at the configured timeout", () =>
    Effect.gen(function* () {
      const result = yield* runProgram("while (true) {}", "call-configured-timeout")

      expect(outputText(result)).toContain("Execution timed out after 25ms.")
    }).pipe(Effect.scoped, Effect.provide(node(new ConfigCodeMode.Info({ timeout_ms: 25 })))),
  )
})
