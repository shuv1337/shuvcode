import { expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { definition, execute } from "../../core/src/tool/runtime"
import type { ToolEditor } from "../../plugin/src/promise/tool"

test("bundled supervisor schemas validate through their owning runtime and retain provider constraints", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supervisor-plugin-schema-"))
  try {
    const build = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "../src/supervisor/plugin/index.ts")],
      outdir: directory,
      target: "bun",
      format: "esm",
      minify: true,
    })
    expect(build.success).toBe(true)
    const bundled: { default: Plugin.Plugin } = await import(build.outputs[0]!.path)
    const inputs = new Map<string, Tool.ValueSchema>()
    // Capture the actual plugin's registration; workflow execution is covered by the managed CLI tests.
    await bundled.default.setup({
      options: { home: directory },
      session: { hook: async () => undefined },
      tool: {
        transform: async (transform: (editor: ToolEditor) => void) => {
          transform({
            list: () => [],
            get: () => undefined,
            namespace: () => undefined,
            add: (tool) => {
              inputs.set(tool.name, tool.input)
            },
            update: () => undefined,
            remove: () => undefined,
          })
        },
      },
    } as unknown as Plugin.Context)
    const input = inputs.get("supervisor_result")
    if (!input) throw new Error("Supervisor result tool was not registered")
    const received: unknown[] = []
    const tool: Tool.Info = {
      name: "supervisor_result",
      description: "Bundled input validation",
      input,
      execute: (value) => {
        received.push(value)
        return Effect.succeed({ content: "accepted" })
      },
    }
    const context: Tool.Context = {
      sessionID: Session.ID.make("ses_schema"),
      messageID: SessionMessage.ID.make("msg_schema"),
      agent: Agent.ID.make("build"),
      id: Tool.CallID.make("schema"),
      progress: () => Effect.void,
    }
    expect(definition(tool).inputSchema).toMatchObject({
      properties: { relativePath: { type: "string", minLength: 1 } },
    })
    await Effect.runPromise(execute(tool, { relativePath: "RESULT.md" }, context))
    expect(received).toEqual([{ relativePath: "RESULT.md" }])
    expect((await Effect.runPromiseExit(execute(tool, { relativePath: "" }, context)))._tag).toBe("Failure")
    expect(received).toHaveLength(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
