import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, Message, ToolCallPart } from "../../src/index.js"
import { OpenAI } from "../../src/providers.js"
import { configure } from "../../src/providers/openai-compatible-responses.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

for (const model of [
  OpenAI.configure({ apiKey: "test-key" }).responses("example-model"),
  configure({ apiKey: "test-key", baseURL: "https://responses.example.test/v1" }).model("example-model"),
]) {
  describe(`${model.route.protocol} message replay`, () => {
    it.effect("lowers rich tool failures without putting data URIs in the error text", () =>
      Effect.gen(function* () {
        const uri = "data:image/png;base64,AAECAw=="
        const value = { error: { type: "tool.execution", message: "snapshot failed" }, content: [] }
        const prepared = yield* compileRequest(
          LLM.request({
            model,
            messages: [
              Message.assistant([ToolCallPart.make({ id: "call_1", name: "snapshot", input: {} })]),
              Message.tool({
                id: "call_1",
                name: "snapshot",
                result: {
                  type: "error",
                  value,
                  content: [
                    { type: "text", text: "could not capture" },
                    { type: "file", uri, mime: "image/png", name: "shot.png" },
                  ],
                },
              }),
            ],
          }),
        )
        const output = prepared.body.input.find((item) => item.type === "function_call_output")
        expect(output).toMatchObject({
          type: "function_call_output",
          call_id: "call_1",
          output: [
            { type: "input_text", text: JSON.stringify(value) },
            { type: "input_text", text: "could not capture" },
            { type: "input_image", image_url: uri },
          ],
        })
        const text = Array.isArray(output && "output" in output ? output.output : undefined)
          ? output.output.flatMap((item) => (typeof item === "object" && item.type === "input_text" ? [item.text] : []))
          : []
        expect(text.join("\n")).not.toContain("data:")
      }),
    )
    const key = model.route.providerMetadataKey ?? "openresponses"

    it.effect("marks assistant text completed regardless of stored status", () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          LLM.request({
            model,
            messages: [
              ...[undefined, "in_progress", "incomplete", "completed"].map((status, index) =>
                Message.make({
                  role: "assistant",
                  providerMetadata: { [key]: { status } },
                  content: [
                    {
                      type: "text",
                      text: `Saved ${index}`,
                      providerMetadata: { [key]: { itemId: `msg_${index}`, phase: "commentary", status } },
                    },
                    {
                      type: "text",
                      text: `Final ${index}`,
                      providerMetadata: { [key]: { itemId: `msg_final_${index}`, phase: "final_answer", status } },
                    },
                  ],
                }),
              ),
              Message.make({
                role: "user",
                content: [{ type: "text", text: "Continue" }],
                providerMetadata: { [key]: { status: "incomplete" } },
              }),
            ],
          }),
        )
        expect(prepared.body.input).toEqual([
          ...[0, 1, 2, 3].flatMap((index) => [
            {
              type: "message",
              role: "assistant",
              id: `msg_${index}`,
              phase: "commentary",
              status: "completed",
              content: [{ type: "output_text", text: `Saved ${index}` }],
            },
            {
              type: "message",
              role: "assistant",
              id: `msg_final_${index}`,
              phase: "final_answer",
              status: "completed",
              content: [{ type: "output_text", text: `Final ${index}` }],
            },
          ]),
          { type: "message", role: "user", status: "incomplete", content: [{ type: "input_text", text: "Continue" }] },
        ])
      }),
    )

    it.effect("replays truncated text as completed while retaining the response finish reason", () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Respond" })).pipe(
          Effect.provide(
            fixedResponse(
              sseEvents(
                {
                  type: "response.output_item.added",
                  item: { type: "message", id: "msg_partial", status: "in_progress" },
                },
                { type: "response.output_text.delta", item_id: "msg_partial", delta: "The next step is" },
                {
                  type: "response.output_item.done",
                  item: {
                    type: "message",
                    id: "msg_partial",
                    status: "incomplete",
                    content: [{ type: "output_text", text: "The next step is" }],
                  },
                },
                {
                  type: "response.incomplete",
                  response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
                },
              ),
            ),
          ),
        )
        expect(response.finishReason.normalized).toBe("length")
        expect(response.events.filter(LLMEvent.is.textEnd)).toHaveLength(1)
        const prepared = yield* compileRequest(
          LLM.request({ model, messages: [response.message, Message.user("Continue")] }),
        )
        expect(prepared.body.input).toEqual([
          {
            type: "message",
            role: "assistant",
            id: "msg_partial",
            status: "completed",
            content: [{ type: "output_text", text: "The next step is" }],
          },
          { type: "message", role: "user", content: [{ type: "input_text", text: "Continue" }] },
        ])
      }),
    )
  })
}
