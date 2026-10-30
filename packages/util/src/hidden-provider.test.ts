import { expect, test } from "bun:test"
import { isHiddenProvider } from "./hidden-provider.js"

test("hides the upstream Claude Agent ids and keeps Anthropic", () => {
  expect(isHiddenProvider("claude-agent")).toBe(true)
  expect(isHiddenProvider("opencode.provider.claude-agent")).toBe(true)
  expect(isHiddenProvider("anthropic")).toBe(false)
})
