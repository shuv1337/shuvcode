import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { configure } from "../../src/providers/openai-compatible-responses"
import { OpenAICompatibleResponses } from "../../src/protocols/openai-compatible-responses"
import { OpenAIResponses } from "../../src/protocols/openai-responses"
import { LLMClient } from "../../src/route"
import { it } from "../lib/effect"

describe("OpenAI-compatible Responses route", () => {
  it.effect("reuses the OpenAI Responses protocol for a configured deployment", () =>
    Effect.gen(function* () {
      expect(OpenAICompatibleResponses.route.body).toBe(OpenAIResponses.protocol.body)
      expect(OpenAICompatibleResponses.route.transport).toBe(OpenAIResponses.httpTransport)

      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model,
          system: "You are concise.",
          prompt: "Say hello.",
        }),
      )

      expect(prepared.route).toBe("openai-compatible-responses")
      expect(prepared.protocol).toBe("openai-responses")
      expect(prepared.model).toMatchObject({
        id: "example-model",
        provider: "example",
        route: {
          id: "openai-compatible-responses",
          endpoint: {
            baseURL: "https://responses.example.test/v1",
            path: "/responses",
          },
        },
      })
      expect(prepared.body).toEqual({
        model: "example-model",
        input: [
          { role: "system", content: "You are concise." },
          { role: "user", content: [{ type: "input_text", text: "Say hello." }] },
        ],
        store: false,
        stream: true,
      })
    }),
  )
})
