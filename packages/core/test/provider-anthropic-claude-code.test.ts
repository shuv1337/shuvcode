import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { AnthropicClaudeCode } from "@opencode-ai/core/plugin/provider/anthropic-claude-code"

const shape = (body: unknown, warn?: (message: string) => void) =>
  AnthropicClaudeCode.shapeRequestBody(body, warn) as Record<string, any>

describe("AnthropicClaudeCode.isSubscription", () => {
  test("recognizes the Claude Pro/Max OAuth credential", () => {
    expect(AnthropicClaudeCode.isSubscription({ type: "oauth", methodID: "claude-pro-max" })).toBe(true)
  })

  test("ignores another provider's OAuth credential", () => {
    expect(AnthropicClaudeCode.isSubscription({ type: "oauth", methodID: "chatgpt-headless" })).toBe(false)
  })

  test("treats a setup-token in the key slot as a subscription", () => {
    // `claude setup-token` is the only credential a headless host can get, and
    // the key slot is the only place to paste it. Sent as x-api-key it 401s.
    expect(AnthropicClaudeCode.isSubscription({ type: "key", key: "sk-ant-oat01-abc" })).toBe(true)
  })

  test("leaves a genuine API key on the normal path", () => {
    expect(AnthropicClaudeCode.isSubscription({ type: "key", key: "sk-ant-api03-abc" })).toBe(false)
  })

  test("does not throw on a key credential with no value", () => {
    expect(AnthropicClaudeCode.isSubscription({ type: "key" })).toBe(false)
    expect(AnthropicClaudeCode.isSubscription(undefined)).toBe(false)
  })
})

describe("AnthropicClaudeCode.normalizeEnv", () => {
  // Golden fixture. Anthropic fuzzy-matches this block to decide whether the
  // request is really Claude Code; a divergent block is billed as "extra usage"
  // instead of the subscription, silently. If opencode's prompt format changes
  // and this test fails, the fix is to make normalizeEnv produce the canonical
  // shape again -- not to update the expectation.
  const canonical = [
    "Here is useful information about the environment you are running in:",
    "<env>",
    "Working directory: /home/user/project",
    "Platform: linux",
    "Today's date: 2026-07-29",
    "</env>",
  ].join("\n")

  test("strips harness-only keys and indentation", () => {
    const host = [
      "Here is useful information about the environment you are running in:",
      "<env>",
      "  Working directory: /home/user/project",
      "  Workspace root folder: /home/user/project",
      "  Platform: linux",
      "  Today's date: 2026-07-29",
      "</env>",
    ].join("\n")
    expect(AnthropicClaudeCode.normalizeEnv(host)).toBe(canonical)
  })

  test("moves a trailing date inside the block", () => {
    const host = [
      "Here is useful information about the environment you are running in:",
      "<env>",
      "Working directory: /home/user/project",
      "Platform: linux",
      "</env>",
      "",
      "Today's date: 2026-07-29",
    ].join("\n")
    expect(AnthropicClaudeCode.normalizeEnv(host)).toBe(canonical)
  })

  test("is idempotent", () => {
    expect(AnthropicClaudeCode.normalizeEnv(canonical)).toBe(canonical)
  })

  test("normalizes an indented block that lacks the lead-in line", () => {
    expect(AnthropicClaudeCode.normalizeEnv("<env>\n  Platform: linux\n</env>")).toBe(
      "Here is useful information about the environment you are running in:\n<env>\nPlatform: linux\n</env>",
    )
  })

  test("leaves text without an env block alone", () => {
    expect(AnthropicClaudeCode.normalizeEnv("You are a helpful assistant.")).toBe("You are a helpful assistant.")
  })

  test("isCanonical is the billing-regression canary", () => {
    expect(AnthropicClaudeCode.isCanonical(canonical)).toBe(true)
    expect(AnthropicClaudeCode.isCanonical("no env here")).toBe(true)
    expect(AnthropicClaudeCode.isCanonical("<env>\n  indented: yes\n</env>")).toBe(false)
  })
})

describe("AnthropicClaudeCode.shapeRequestBody", () => {
  test("forces the Claude Code identity as the first system entry", () => {
    const body = { system: [{ type: "text", text: "You are opencode." }] }
    const parsed = shape(body)
    expect(parsed.system[0]).toEqual({ type: "text", text: AnthropicClaudeCode.systemIdentity })
  })

  test("preserves later system entries so the agent keeps its instructions", () => {
    const body = {
      system: [
        { type: "text", text: "You are opencode." },
        { type: "text", text: "Follow the project conventions." },
      ],
    }
    const parsed = shape(body)
    expect(parsed.system[1].text).toBe("Follow the project conventions.")
  })

  test("promotes a string system prompt to identity + normalized block", () => {
    const parsed = shape({ system: "You are opencode." })
    expect(parsed.system).toEqual([
      { type: "text", text: AnthropicClaudeCode.systemIdentity },
      { type: "text", text: "You are opencode." },
    ])
  })

  test("adds the identity when there is no system prompt at all", () => {
    const parsed = shape({})
    expect(parsed.system).toEqual([{ type: "text", text: AnthropicClaudeCode.systemIdentity }])
  })

  test("renames tools to Claude Code casing", () => {
    const body = { tools: [{ name: "bash" }, { name: "read" }, { name: "mcp_custom" }] }
    const parsed = shape(body)
    expect(parsed.tools.map((tool: { name: string }) => tool.name)).toEqual(["Bash", "Read", "mcp_custom"])
  })

  test("renames tool_use blocks in prior messages", () => {
    const body = {
      messages: [{ content: [{ type: "tool_use", name: "webfetch" }, { type: "text", text: "hi" }] }],
    }
    const parsed = shape(body)
    expect(parsed.messages[0].content[0].name).toBe("WebFetch")
    expect(parsed.messages[0].content[1]).toEqual({ type: "text", text: "hi" })
  })

  test("drops a merged provider apiKey the API would reject", () => {
    const parsed = shape({ apiKey: "sk-ant-oat01-x" })
    expect(parsed.apiKey).toBeUndefined()
  })

  test("warns when the env block cannot be made canonical", () => {
    const warnings: string[] = []
    // An inline block the normalizer's line-oriented regex cannot parse, so it
    // passes through unchanged and reaches Anthropic in non-Claude-Code shape.
    const body = {
      system: [{ type: "text", text: "opencode" }, { type: "text", text: "<env>inline: yes</env>" }],
    }
    AnthropicClaudeCode.shapeRequestBody(body, (message) => warnings.push(message))
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("extra usage")
  })
})

describe("AnthropicClaudeCode.restoreToolNames", () => {
  test("maps canonical names back so opencode sees its own", () => {
    expect(AnthropicClaudeCode.restoreToolNames('{"name": "Bash"}')).toBe('{"name": "bash"}')
  })

  test("leaves unknown names untouched", () => {
    expect(AnthropicClaudeCode.restoreToolNames('{"name": "mcp_custom"}')).toBe('{"name": "mcp_custom"}')
  })
})

describe("AnthropicClaudeCode.headers", () => {
  test("sends the Claude Code identity headers", () => {
    const result = AnthropicClaudeCode.headers()
    expect(result["user-agent"]).toBe(AnthropicClaudeCode.userAgent)
    expect(result["x-app"]).toBe("cli")
    expect(result["anthropic-beta"]).toContain("oauth-2025-04-20")
  })

  test("merges caller beta flags rather than replacing them", () => {
    const result = AnthropicClaudeCode.headers({ "anthropic-beta": "custom-flag-1" })
    expect(result["anthropic-beta"]).toContain("custom-flag-1")
    expect(result["anthropic-beta"]).toContain("claude-code-20250219")
  })

  test("matches the beta header case-insensitively", () => {
    expect(AnthropicClaudeCode.headers({ "Anthropic-Beta": "custom-flag-2" })["anthropic-beta"]).toContain(
      "custom-flag-2",
    )
  })
})

describe("AnthropicClaudeCode.transport", () => {
  const base = {
    id: "http-json",
    prepare: (input: any) => Effect.succeed({ seen: input.body }),
    execute: () => Effect.succeed({ frames: Stream.fromIterable(['{"name": "Bash"}', '{"name": "mcp_x"}']) }),
  }

  test("shapes the request body before the protocol encodes it", async () => {
    const wrapped = AnthropicClaudeCode.transport(base as any)
    const prepared: any = await Effect.runPromise(
      wrapped.prepare({ body: { tools: [{ name: "bash" }] } } as any) as any,
    )
    expect(prepared.seen.tools[0].name).toBe("Bash")
    expect(prepared.seen.system[0].text).toBe(AnthropicClaudeCode.systemIdentity)
  })

  test("restores opencode tool names on the response frames", async () => {
    const wrapped = AnthropicClaudeCode.transport(base as any)
    const execution: any = await Effect.runPromise(wrapped.execute({} as any, {} as any, {} as any) as any)
    const frames = await Effect.runPromise(Stream.runCollect(execution.frames) as any)
    expect(Array.from(frames as any)).toEqual(['{"name": "bash"}', '{"name": "mcp_x"}'])
  })

  test("tags its id so the wrapping is visible in traces", () => {
    expect(AnthropicClaudeCode.transport(base as any).id).toBe("http-json/claude-code")
  })
})
