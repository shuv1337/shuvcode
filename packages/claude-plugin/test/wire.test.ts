import { describe, expect, test } from "bun:test"
import {
  decodeBody,
  headers,
  isCanonical,
  normalizeEnv,
  restoreStream,
  restoreToolNames,
  shapeRequestBody,
  systemIdentity,
} from "../src/wire.js"

const event = (name = "Bash") =>
  `event: content_block_start\r\ndata: ${JSON.stringify({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "tool-1", name, input: { name: "Bash", text: "日本語 🦈" } },
  })}\r\n\r\n`
const names = new Map([["Bash", "bAsH"]])

describe("wire shaping", () => {
  test("preserves instructions and cache metadata, canonicalizes tools/history/choice without mutating input", () => {
    const body = decodeBody({
      system: [{ type: "text", text: "Keep this first instruction", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "bash" }, { name: "mcp_custom" }],
      tool_choice: { type: "tool", name: "bash" },
      apiKey: "not-for-the-body",
      messages: [{ role: "assistant", content: [{ type: "tool_use", name: "bash", input: { name: "bash" } }] }],
    })
    const shaped = shapeRequestBody(body)
    expect(shaped.system).toEqual([
      { type: "text", text: systemIdentity },
      ...(Array.isArray(body.system) ? body.system : []),
    ])
    expect(shaped.tools?.map((tool) => tool.name)).toEqual(["Bash", "mcp_custom"])
    expect(shaped.tool_choice?.name).toBe("Bash")
    expect(shaped.messages).toEqual([
      { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { name: "bash" } }] },
    ])
    expect(shaped.apiKey).toBeUndefined()
    expect(body.tools?.[0].name).toBe("bash")
    expect(shapeRequestBody(shaped)).toEqual(shaped)
    expect(shapeRequestBody(decodeBody({ system: "instructions" })).system).toEqual([
      { type: "text", text: systemIdentity },
      { type: "text", text: "instructions" },
    ])
    expect(shapeRequestBody(decodeBody({})).system).toEqual([{ type: "text", text: systemIdentity }])
  })

  test("normalizes the upstream environment canary", () => {
    const text =
      "Here is useful information about the environment you are running in:\n<env>\n  Working directory: /tmp/project\n  Workspace root folder: /tmp/project\n  Platform: linux\n</env>\n\nToday's date: 2026-07-29"
    const expected =
      "Here is useful information about the environment you are running in:\n<env>\nWorking directory: /tmp/project\nPlatform: linux\nToday's date: 2026-07-29\n</env>"
    expect(normalizeEnv(text)).toBe(expected)
    expect(normalizeEnv(expected)).toBe(expected)
    expect(isCanonical(expected)).toBe(true)
    expect(isCanonical("<env>inline</env>")).toBe(false)
    const warnings: string[] = []
    shapeRequestBody(decodeBody({ system: "<env>inline</env>" }), (warning) => warnings.push(warning))
    expect(warnings[0]).toContain("extra usage")
  })

  test("merges beta flags case-insensitively", () => {
    const result = headers({ "Anthropic-Beta": "custom,oauth-2025-04-20" })
    expect(result["anthropic-beta"].split(",").filter((flag) => flag === "oauth-2025-04-20")).toHaveLength(1)
    expect(result["anthropic-beta"]).toContain("custom")
    expect(result["user-agent"]).toBe("claude-cli/2.1.260 (external, cli)")
  })
})

describe("SSE restoration", () => {
  test("changes only tool-use names, retaining input names and Unicode", () => {
    const restored = restoreToolNames(event(), names)
    expect(restored).toContain('"name":"bAsH"')
    expect(restored).toContain('"input":{"name":"Bash","text":"日本語 🦈"}')
    expect(restoreToolNames('data: {"type":"text_delta","name":"Bash"}\n\n', names)).toBe(
      'data: {"type":"text_delta","name":"Bash"}\n\n',
    )
    expect(restoreToolNames("data: [DONE]\n\n", names)).toBe("data: [DONE]\n\n")
  })

  test("all byte split positions including UTF-8 and CRLF; multiple events and final partial event", async () => {
    const text = event() + ": ping\r\n\r\n" + event("unknown") + "data: [DONE]"
    const bytes = new TextEncoder().encode(text)
    const expected = restoreToolNames(event(), names) + ": ping\r\n\r\n" + event("unknown") + "data: [DONE]"
    for (let split = 1; split < bytes.length; split++) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, split))
          controller.enqueue(bytes.slice(split))
          controller.close()
        },
      })
      expect(await new Response(stream.pipeThrough(restoreStream(names))).text()).toBe(expected)
    }
  })

  test("one-byte chunks, LF and multiline data", async () => {
    const text =
      'event: content_block_start\ndata: {"type":"content_block_start",\ndata: "content_block":{"type":"tool_use","name":"Bash"}}\n\n'
    const bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        bytes.forEach((byte) => controller.enqueue(new Uint8Array([byte])))
        controller.close()
      },
    })
    expect(await new Response(stream.pipeThrough(restoreStream(names))).text()).toBe(restoreToolNames(text, names))
  })

  test("propagates cancellation to the source", async () => {
    const cancelled = Promise.withResolvers<unknown>()
    const source = new ReadableStream<Uint8Array>({
      cancel: (reason) => {
        cancelled.resolve(reason)
      },
    })
    const reader = source.pipeThrough(restoreStream(names)).getReader()
    await reader.cancel("stop")
    expect(await cancelled.promise).toBe("stop")
  })

  test("propagates source errors", async () => {
    const failure = new Error("stream failed")
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure)
      },
    })
    await expect(new Response(source.pipeThrough(restoreStream(names))).text()).rejects.toThrow("stream failed")
  })
})
