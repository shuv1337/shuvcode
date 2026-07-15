import { describe, expect, test } from "bun:test"
import { homeFooterLayout, homePromptMaxWidth, promptMetadata, showHomeLogo } from "../src/util/responsive"

describe("responsive TUI layout", () => {
  test("clamps the home prompt to the terminal content width", () => {
    expect(homePromptMaxWidth(60, undefined)).toBe(56)
    expect(homePromptMaxWidth(120, undefined)).toBe(75)
    expect(homePromptMaxWidth(100, "auto")).toBe(70)
    expect(homePromptMaxWidth(30, "auto")).toBe(26)
  })

  test("hides the home logo when either terminal dimension is constrained", () => {
    expect(showHomeLogo(80, 24)).toBe(true)
    expect(showHomeLogo(79, 24)).toBe(false)
    expect(showHomeLogo(80, 23)).toBe(false)
  })

  test("hides MCP status and budgets the footer directory on narrow terminals", () => {
    expect(homeFooterLayout(60, 12, 18)).toEqual({ directoryWidth: 40, gap: 1, showMcp: false })
    expect(homeFooterLayout(100, 12, 18)).toEqual({ directoryWidth: 62, gap: 2, showMcp: true })
  })

  test("compacts long model metadata below 70 columns", () => {
    expect(promptMetadata(69, "anthropic/claude-opus-4-very-long-model-name")).toEqual({
      compact: true,
      model: "anthropic/claude-opus-4-very-long-model-\u2026",
    })
    expect(promptMetadata(70, "anthropic/claude-opus-4-very-long-model-name")).toEqual({
      compact: false,
      model: "anthropic/claude-opus-4-very-long-model-name",
    })
  })
})
