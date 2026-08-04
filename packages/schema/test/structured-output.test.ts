import { expect, test } from "bun:test"
import { Schema } from "effect"
import { PromptInput } from "../src/prompt-input.js"
import { SessionEvent } from "../src/session-event.js"
import { SessionMessage } from "../src/session-message.js"

test("structured output contracts survive prompt and result decoding", () => {
  const prompt = Schema.decodeUnknownSync(PromptInput.Prompt)({
    text: "Summarize",
    output: {
      schema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      name: "summary",
    },
  })
  const result = Schema.decodeUnknownSync(SessionMessage.AssistantStructured)({
    type: "structured",
    value: { summary: "Ready" },
  })

  expect(prompt.output?.name).toBe("summary")
  expect(result.value).toEqual({ summary: "Ready" })
  expect(SessionEvent.Structured.Completed.type).toBe("session.structured.completed")
  expect(SessionEvent.Structured.Failed.type).toBe("session.structured.failed")
})
