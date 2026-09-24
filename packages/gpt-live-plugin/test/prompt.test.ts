import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { builtInPrompt, loadPrompt, readPromptSource, renderPrompt, resolvePromptPath } from "../src/server/prompt"

const BUILT_IN_PROMPTS = path.join(import.meta.dir, "../src/server/prompts")

const variables = { project: "demo", directory: "/work/demo" }
const scratch = () => mkdtempSync(path.join(os.tmpdir(), "gpt-live-prompt-"))

describe("built-in prompts", () => {
  test("fill in the project", () => {
    const { text, notices } = loadPrompt("gpt-live", { directory: "/", variables })
    expect(text).toContain('"demo" (/work/demo)')
    expect(text).not.toContain("{{")
    expect(notices).toEqual([])
  })

  test("the voice agent prompt only names tools the server plugin registers", () => {
    const prompt = loadPrompt("voice-agent", { directory: "/", variables }).text
    const server = readFileSync(path.join(import.meta.dir, "../src/server/index.ts"), "utf8")
    const named = new Set(prompt.match(/gptlive_[a-z_]+/g))
    expect(named.size).toBeGreaterThan(0)
    for (const tool of named) expect(server).toContain(`"${tool.replace(/^gptlive_/, "")}"`)
  })

  test("sections are joined in file-name order", () => {
    const first = readFileSync(path.join(BUILT_IN_PROMPTS, "gpt-live", "01-identity.md"), "utf8").trim()
    expect(readPromptSource(path.join(BUILT_IN_PROMPTS, "gpt-live")).startsWith(first)).toBe(true)
  })

  test("the embedded prompts match every section on disk", () => {
    for (const name of ["gpt-live", "voice-agent"] as const)
      expect(builtInPrompt(name)).toBe(readPromptSource(path.join(BUILT_IN_PROMPTS, name)))
  })
})

describe("custom prompts", () => {
  test("a file replaces the built-in prompt", () => {
    const directory = scratch()
    writeFileSync(path.join(directory, "live.md"), "You are a pirate helping with {{project}}.")
    const { text } = loadPrompt("gpt-live", { override: "live.md", directory, variables })
    expect(text).toBe("You are a pirate helping with demo.")
  })

  test("a folder is read like the built-in one, without author comments", () => {
    const directory = scratch()
    mkdirSync(path.join(directory, "agent"))
    writeFileSync(path.join(directory, "agent", "02-b.md"), "Second.")
    writeFileSync(path.join(directory, "agent", "01-a.md"), "<!-- why this exists -->\nFirst.")
    writeFileSync(path.join(directory, "agent", "notes.txt"), "ignored")
    expect(loadPrompt("voice-agent", { override: "agent", directory, variables }).text).toBe("First.\n\nSecond.")
  })

  test("extra instructions are appended", () => {
    const { text } = loadPrompt("voice-agent", { directory: "/", variables, extra: "  Be brief.  " })
    expect(text.endsWith("\n\nAdditional instructions from the user:\nBe brief.")).toBe(true)
  })

  test("a missing or empty override falls back to the built-in prompt with a notice", () => {
    const directory = scratch()
    writeFileSync(path.join(directory, "empty.md"), "<!-- nothing yet -->")
    const builtIn = loadPrompt("gpt-live", { directory, variables }).text
    for (const override of ["nope.md", "empty.md"]) {
      const { text, notices } = loadPrompt("gpt-live", { override, directory, variables })
      expect(text).toBe(builtIn)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toContain("using the built-in one")
    }
  })
})

describe("helpers", () => {
  test("paths expand ~ and resolve against the project", () => {
    expect(resolvePromptPath("~/p.md", "/work")).toBe(path.join(os.homedir(), "p.md"))
    expect(resolvePromptPath("voice/p.md", "/work")).toBe(path.resolve("/work", "voice/p.md"))
    expect(resolvePromptPath("/abs/p.md", "/work")).toBe(path.resolve("/abs/p.md"))
  })

  test("unknown placeholders stay as written", () => {
    expect(renderPrompt("{{ project }} {{unknown}}", variables)).toBe("demo {{unknown}}")
  })
})
