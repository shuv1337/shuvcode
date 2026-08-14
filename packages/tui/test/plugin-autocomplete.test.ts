import { expect, test } from "bun:test"
import type { PromptAutocompleteProvider } from "@opencode-ai/plugin/tui/context"
import { pluginTriggerOptions } from "../src/component/prompt/autocomplete"
import { promptTriggerError } from "../src/plugin/api"

const free = () => false
const provider = (trigger: string, options: PromptAutocompleteProvider["options"]) => ({
  provider: { trigger, options } satisfies PromptAutocompleteProvider,
})
const request = { query: "" }

test("rejects triggers the prompt already owns", () => {
  expect(promptTriggerError("@", free)).toBe("Prompt autocomplete trigger is reserved by the prompt: @")
  expect(promptTriggerError("/", free)).toBe("Prompt autocomplete trigger is reserved by the prompt: /")
  expect(promptTriggerError("$", free)).toBeUndefined()
})

test("rejects triggers that are not one non-whitespace character", () => {
  const message = "Prompt autocomplete trigger must be one non-whitespace character"
  expect(promptTriggerError("", free)).toBe(message)
  expect(promptTriggerError("$$", free)).toBe(message)
  expect(promptTriggerError(" ", free)).toBe(message)
})

test("rejects a trigger another plugin already claimed", () => {
  expect(promptTriggerError("$", (trigger) => trigger === "$")).toBe(
    "Prompt autocomplete trigger already registered: $",
  )
})

test("completes a plain option's value into the prompt", () => {
  const inserted: string[] = []
  const options = pluginTriggerOptions([provider("$", () => [{ value: "effect" }])], "$", request, {
    skill: () => expect.unreachable("plain option must not attach a skill"),
    text: (trigger, value) => inserted.push(trigger + value),
  })

  expect(options).toHaveLength(1)
  expect(options[0]?.display).toBe("$effect")
  // Regression: an option with no handler selected to a silent no-op.
  expect(options[0]?.onSelect).toBeDefined()
  options[0]?.onSelect?.()
  expect(inserted).toEqual(["$effect"])
})

test("attaches the skill when an option declares one", () => {
  const attached: string[] = []
  const options = pluginTriggerOptions(
    [provider("$", () => [{ value: "review", display: "review code", skill: "code-review" }])],
    "$",
    request,
    {
      skill: (trigger, value, skill) => attached.push(`${trigger}${value}:${skill}`),
      text: () => expect.unreachable("skill option must not insert plain text"),
    },
  )

  expect(options[0]?.display).toBe("review code")
  options[0]?.onSelect?.()
  expect(attached).toEqual(["$review:code-review"])
})

test("ignores providers registered for a different trigger", () => {
  const options = pluginTriggerOptions(
    [provider("$", () => [{ value: "one" }]), provider("!", () => [{ value: "two" }])],
    "$",
    request,
    { skill: () => {}, text: () => {} },
  )

  expect(options.map((option) => option.value)).toEqual(["one"])
})

test("passes the query through so a provider filters its own options", () => {
  const seen: string[] = []
  pluginTriggerOptions(
    [
      provider("$", (input) => {
        seen.push(input.query)
        return []
      }),
    ],
    "$",
    { query: "eff", sessionID: "ses_1" },
    { skill: () => {}, text: () => {} },
  )

  expect(seen).toEqual(["eff"])
})
