import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { Cause, Effect, Exit, Schema } from "effect"
import { it } from "./lib/effect"
import { toolIdentity } from "./lib/tool"

const toolNode = AppNodeBuilder.build(Tool.node, [
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
])

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
