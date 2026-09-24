# Rich tool failures

A failed tool call can carry the same canonical content as a success: ordered text and file blocks on `Tool.Error.content`. The engine keeps the call failed, normalizes images once, truncates text with successful output, stores the blocks on `session.tool.failed`, and replays them into later model requests.

Plain text failures are unchanged. When `content` is absent, history still lowers `{ type: "error", value: { error, content: [] } }` and protocols still stringify that value.

## Capability

Plugins detect support from the activation context, not the engine version. Both `@opencode/plugin` and `@opencode/plugin/effect` contexts include:

```ts
context.features.richFailures === true
```

`features` is `{ readonly richFailures: true }`, exported from `@opencode/plugin/features` and set by the engine host. A companion that bundles its own `@opencode/plugin` copy probes the runtime object:

```ts
const richFailures =
  typeof context.features === "object" &&
  context.features !== null &&
  context.features.richFailures === true
```

A foreign `Tool.Error` is recognized by `_tag: "Tool.Error"` in `packages/core/src/tool/runtime.ts`, then reconstructed as the engine class so `catchTag` still settles the call. `content` is copied only when it decodes as a string or an array of canonical text/file blocks.

## Out of scope

- MCP `isError` content is not forwarded. MCP failures stay message-only.
- Native session UI does not render failure media. Failed status is unchanged (`currentToolFailed` still keys off `status === "error"`).

## Per-protocol fidelity

Cells below are request-body assertions against deterministic fake providers. They do not claim that a live provider accepts the body. Anthropic `is_error` with an image and Bedrock `status: "error"` with an image are request-shaped here and still unverified against the live APIs.

Error text is the historical JSON value (`{ error, content: [] }` or the protocol's existing string form). Media from `content` is never placed in that text. Each listed test asserts the failed tool's text slots do not contain a `data:` URI.

| Protocol | Error marker | Media | Ordering | Test |
| --- | --- | --- | --- | --- |
| Anthropic Messages | `is_error: true` | base64 image block inside `tool_result.content` | error text, then content blocks in order | `packages/ai/test/provider/anthropic-messages.test.ts` |
| OpenAI Responses and Open Responses | no native status field; error text is the first `input_text` | `input_image` in the same `function_call_output.output` array | error text, then content blocks in order | `packages/ai/test/provider/openai-responses.test.ts`, `packages/ai/test/provider/open-responses-replay.test.ts` |
| OpenAI Chat | no native status field; error text is the tool message string | following user message `image_url`, same split as success | text in the tool message, media after; interleaved text/image order is not preserved, matching success | `packages/ai/test/provider/openai-chat.test.ts` |
| Gemini 2.5 | no native status field; error text is `functionResponse.response.content` | trailing user turn `Attached media from tool result:` plus `inlineData`, same split as success | text in the function response, media after | `packages/ai/test/provider/gemini.test.ts` |
| Gemini 3 | same error text | `inlineData` on `functionResponse.parts`, same nest as success | text in the response, media in `parts` | `packages/ai/test/provider/gemini.test.ts` |
| Bedrock Converse | `toolResult.status: "error"` | image block inside `toolResult.content` | error text, then content blocks in order | `packages/ai/test/provider/bedrock-converse.test.ts` |
| Mistral Chat | no native status field; error text is the first text block | `image_url` in the same tool `content` array | error text, then content blocks in order | `packages/ai/test/provider/mistral-chat.test.ts` |
| AI SDK | `error-text`, not `text` | following user message file part, same attachment label as success | error text in the tool result, media after | `packages/core/test/aisdk.test.ts` |

`packages/ai/test/provider/open-responses-errors.test.ts` decodes provider stream failures. It is not an outbound tool-result lowering site, so it has no cell in this matrix.

## Other checks

- Structural `_tag: "Tool.Error"` keeps message, metadata, and content: `packages/core/test/tool-execute.test.ts`.
- Failure images are normalized once; undecodable and oversized images become the same omission notes as success: `packages/core/test/tool-registry.test.ts`.
- Oversized failure text is truncated before the failed event: `packages/core/test/session-runner.test.ts`.
- Failed events keep content, and hosted error results forward sibling content without stringifying it into the error message: `packages/core/test/session-runner-tool-events.test.ts`.
- History replay puts media on the error result's `content` sibling, not inside `value`: `packages/core/test/session-runner-message.test.ts`. The session runner reads that projected state back after the call.
- Compaction recent text includes the error message, failure text, and an attachment marker, and does not embed `data:` URIs: `packages/core/test/session-compaction.test.ts`.
- Request image budget and unsupported-modality substitution apply to failure images: `packages/core/test/session-model-request.test.ts`.
- Engine UI state stays failed: the runner assertion matches `status: "error"`.
