import { expect, test } from "bun:test"
import { configuredAgentModelWarning, recentModels } from "../../src/context/local"

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

test("does not reject an agent model before the model catalog loads", () => {
  expect(
    configuredAgentModelWarning(
      {
        id: "build",
        model: {
          providerID: "anthropic",
          id: "claude-opus-4-8",
        },
      },
      undefined,
    ),
  ).toBeUndefined()
})
test("rejects an agent model missing from a loaded model catalog", () => {
  expect(
    configuredAgentModelWarning(
      {
        id: "build",
        model: {
          providerID: "anthropic",
          id: "claude-opus-4-8",
        },
      },
      [],
    ),
  ).toBe("Agent build's configured model anthropic/claude-opus-4-8 is not valid")
})
