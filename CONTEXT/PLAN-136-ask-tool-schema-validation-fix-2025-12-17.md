# Plan: Fix Ask Tool Schema Validation Error (Broad/Permissive)

**Issue:** [#136 - [BUG] Ask Tool](https://github.com/Latitudes-Dev/shuvcode/issues/136)  
**Created:** 2025-12-17  
**Status:** Implementation Complete (Milestones 2, 3.1-3.2, 5.1 done)

## Goals & Scope

### Primary Goal

Make the `ask` tool work reliably across models/providers by preventing schema-validation failures from blocking the TUI modal.

### Specifically, we must fix

- `ask` tool calls where select/multi-select `options` are provided as strings instead of `{ value, label }` objects.
- `ask` tool calls where `message` (required question text) is missing but may exist under common alias keys.

### Non-goals

- Do not redesign the Ask dialog UX (already addressed elsewhere).
- Do not change user-facing TUI behavior beyond making `ask` reliably open.
- Do not introduce provider-specific logic unless broad, provider-agnostic fixes are insufficient.

## Planning Context Capture (Repo Reality)

### Where the failure occurs

Tool argument validation happens before the tool’s `execute` body:

- `packages/opencode/src/tool/tool.ts:48-59` validates `toolInfo.parameters.parse(args)`.

If this validation fails, `AskTool.execute()` never runs, and the modal never appears.

### Canonical “question” contract is strict and used by the TUI

The TUI expects canonical `Question.Item` shapes:

- `packages/opencode/src/question/index.ts:51-52` defines `Question.Item` as a `z.discriminatedUnion("type", ...)`.
- The dialog components assume `select`/`multi-select` options are objects with `value` and `label`:
  - `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-select.tsx:126-142`
  - `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-multi-select.tsx:165-190`

### AskTool currently publishes to the TUI with a cast (no secondary validation)

- `packages/opencode/src/tool/ask.ts:125-133` publishes `questions: params.questions as Question.Item[]`.

This makes it critical that any “permissive input” is normalized back into canonical `Question.Item[]` before publishing.

### Tool schema sent to models

The schema passed to models is generated in-session:

- `packages/opencode/src/session/prompt.ts:68-75` uses `z.toJSONSchema(item.parameters)` and `ProviderTransform.schema(...)`.

Note: the server endpoint that lists tools uses a different converter:

- `packages/opencode/src/server/server.ts:491-500` uses `zodToJsonSchema(...)`.

Do not assume the server endpoint schema exactly matches what the model receives at runtime.

### Existing Ask tool operational context (must be considered)

`ASK_TOOL_UPDATES.md` documents prior Ask integration and UX work and is relevant context for maintaining compatibility:

- `ASK_TOOL_UPDATES.md:5-60`

## Problem Summary

### Observed error

When a model calls `ask`, the TUI modal does not appear; instead the user sees a Zod error like:

- missing required `questions[n].message`
- `questions[n].options[m]` is a string, but schema expects an object

### Key insight

This is not primarily a TUI rendering issue. It’s a tool input validation mismatch that prevents the question request event from ever being published.

## Failure Mode Taxonomy (So We Fix The Right Thing)

### A) Invalid tool name / invalid JSON tool call

Handled in the model layer via tool call repair fallback:

- `packages/opencode/src/session/llm.ts:120-139` (`experimental_repairToolCall` routes unrepaired calls to the `invalid` tool).

### B) Valid JSON tool call, but schema-invalid args (this bug)

- Validation happens inside `Tool.define` before tool execute.
- Current plugin hooks like `tool.execute.before` won’t run if parsing fails.

### C) Schema-valid args, but non-canonical shape breaks TUI

This can happen if we loosen the Zod schema but fail to normalize. The TUI will then break because it assumes canonical `Question.Item`.

## Design Principles

1. **Model-facing schema should remain simple and strict** to guide correct output.
2. **Runtime parsing should be permissive and normalize** common deviations into canonical internal types.
3. **Always publish only canonical `Question.Item[]`** to the TUI.
4. **Be provider-agnostic by default**; avoid provider-specific hacks unless proven necessary.
5. **Add observability at the actual failure point** (tool validation), with privacy safeguards.

## Proposed Approach (Preferred: Permissive Input + Canonical Normalization)

### Summary

Implement _permissive parsing via preprocessing_ (so models can still see a strict JSON schema), then _normalize_ into canonical `Question.Item[]` before publishing.

In practice, this means:

- Keep the model-visible JSON schema close to the current expected structure (objects for `options`, required `message`).
- Add Zod `preprocess` / transformation layers so that when a model sends slightly wrong shapes (like string options), the tool still accepts them.
- After preprocessing, validate against the canonical `Question.Item` schema and only then publish to TUI.

### Why this fits the codebase

- Prevents schema-validation failures from blocking the modal (`packages/opencode/src/tool/tool.ts:48-59`).
- Preserves canonical invariants expected by the dialog UI (`packages/opencode/src/cli/cmd/tui/component/dialog-question/*`).
- Avoids adding new complexity to provider schema transforms (`packages/opencode/src/provider/transform.ts:383-441`) unless needed.

## Normalization Specification

### Supported input variations (compatibility targets)

These are common model/tool-call deviations we will accept and normalize.

| Field                       | Canonical                                   | Accept also                            | Normalization rule                                                 |
| --------------------------- | ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `question.message`          | `string` (required)                         | `text`, `prompt`, `question` (strings) | Map first present alias to `message`                               |
| `question.type`             | `select`, `multi-select`, `confirm`, `text` | `multiselect`, `multi_select`, `multi` | Map to `multi-select` if unambiguous                               |
| `select.options[]`          | `{ value, label, hint? }[]`                 | `string[]`                             | Convert `"A"` -> `{ value: "A", label: "A" }`                      |
| `select.options[]`          | `{ value, label }`                          | `{ label }` or `{ value }`             | Fill missing field with the other (`value=label` or `label=value`) |
| `multi-select.defaultValue` | `string[]`                                  | `string`                               | Wrap into `[string]`                                               |
| `timeout`                   | `number`                                    | `string` containing digits             | Parse to number if safe                                            |

### Canonical validation

After normalization, enforce canonical types by parsing with:

- `Question.Item` / `Question.Request` schemas (`packages/opencode/src/question/index.ts`).

If canonical validation fails, the tool must:

- Not publish the request
- Return an error message designed to trigger a correct retry

## Tool Error Handling & Observability

### Validation errors must be actionable for models

Implement `formatValidationError` (supported by `Tool.define`) to provide:

- a brief explanation of what’s wrong
- a minimal example tool call input
- explicit guidance: “`options` must be objects with `value` and `label`”

Relevant hook point:

- `packages/opencode/src/tool/tool.ts:52-58`

### Capture invalid args at the correct point

Because validation fails before `tool.execute.before` runs (`packages/opencode/src/session/prompt.ts:75-87`), logging must be done inside tool validation failure handling.

**Privacy requirement:** never log full user text/options by default.

Proposed logging policy:

- log only:
  - tool name (`ask`)
  - providerID/modelID from `ctx.extra.model` (if present)
  - Zod issue paths and codes
  - counts/shape metadata (e.g., `questions.length`, option item types), not raw strings
- optionally enable verbose logging only behind an explicit debug flag

## Implementation Plan (Sequenced by Dependencies)

### Milestone 1 — Reproduce, Measure, and Confirm Failure Class

- [ ] 1.1 Reproduce issue locally using the exact provider/model configuration reported in the issue (record `providerID` and `model.api.id` values from runtime logs)
- [ ] 1.2 Confirm whether failure is case (B) schema-invalid args vs (A) invalid tool call
- [ ] 1.3 Capture the tool-call args that failed validation (redacted) at `Tool.define` validation boundary (`packages/opencode/src/tool/tool.ts:48-59`)
- [ ] 1.4 Confirm the exact tool schema sent to the model is coming from `packages/opencode/src/session/prompt.ts:68-75` (not `/experimental/tool`)

### Milestone 2 — Add Permissive Parsing Without Weakening Model Schema

- [x] 2.1 Update `packages/opencode/src/tool/ask.ts` to accept common input deviations using preprocessing (string options, alias keys for `message`, etc.)
- [x] 2.2 Add explicit normalization functions that convert inputs into canonical `Question.Item[]`
- [x] 2.3 Validate normalized output using `Question.Item` / `Question.Request` schemas (`packages/opencode/src/question/index.ts`)
- [x] 2.4 Ensure `AskTool.execute` publishes only canonical `Question.Request` fields to `TuiEvent.QuestionRequest` (`packages/opencode/src/cli/cmd/tui/event.ts:40-42`)

### Milestone 3 — Improve Retry Behavior for Unfixable Inputs

Some invalid inputs cannot be safely inferred (e.g., truly missing question text).

- [x] 3.1 Implement `formatValidationError` for AskTool to produce a minimal, copy-pastable example payload
- [x] 3.2 Include specific guidance for the observed failure (strings in `options`, missing `message`)
- [ ] 3.3 Optionally add a narrow "ask tool repair" path in `packages/opencode/src/session/llm.ts:120-139`:
  - [ ] 3.3.1 If tool name is `ask` and error indicates string options, attempt to wrap them into `{value,label}` and retry once
  - [ ] 3.3.2 Never invent missing `message`; instead rely on `formatValidationError` to trigger a corrected retry

### Milestone 4 — Provider-Specific Handling (Only If Still Needed)

This is explicitly a fallback path.

- [ ] 4.1 If failures persist only for certain `providerID`/`model.api.id` pairs, document those identifiers
- [ ] 4.2 Consider provider schema sanitization in `packages/opencode/src/provider/transform.ts:383-441` only if we can prove schema incompatibility is the root cause
- [ ] 4.3 Add a regression test demonstrating the provider-specific need

### Milestone 5 — Tests, Validation, and Documentation

- [x] 5.1 Add unit tests covering normalization rules (string options, alias message keys, etc.)
- [ ] 5.2 Add tests that assert published `Question.Request` always matches `Question.Request` schema
- [ ] 5.3 Add/update a short internal note describing accepted "compatibility inputs" and why
- [ ] 5.4 Manual QA checklist with at least:
  - [ ] select with object options
  - [ ] select with string options
  - [ ] multi-select with string defaultValue vs array
  - [ ] confirm/text question types
  - [ ] multi-question dialog

## Validation Criteria

### Functional acceptance

- [ ] Ask modal appears and is usable for valid canonical inputs
- [ ] Ask modal appears for string-options inputs after normalization
- [ ] If truly missing question text, the error message clearly explains required format and prompts model retry

### Compatibility

- [ ] Works across multiple providers/models without provider-specific logic
- [ ] Does not break existing Ask dialog behavior (UX/components)

### Safety & privacy

- [ ] No sensitive question content is logged by default when validation fails

## Risk Assessment (Updated)

| Risk                                                        | Likelihood | Impact | Mitigation                                                                         |
| ----------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------- |
| Loosening schema causes non-canonical payloads to reach TUI | Medium     | High   | Mandatory post-normalization validation against `Question.Item`/`Question.Request` |
| Overly permissive parsing causes more “bad” model calls     | Medium     | Medium | Keep model-visible schema strict; normalize only known-safe deviations             |
| Logging leaks user content                                  | Medium     | High   | Redaction + debug-only verbose logs                                                |
| Provider-specific hacks proliferate                         | Medium     | Medium | Make provider-specific a gated fallback milestone                                  |

## Code References

### Internal

- `packages/opencode/src/tool/ask.ts`
- `packages/opencode/src/tool/tool.ts`
- `packages/opencode/src/question/index.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/provider/transform.ts`
- `packages/opencode/src/cli/cmd/tui/event.ts`
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-select.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-multi-select.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-text.tsx`
- `ASK_TOOL_UPDATES.md`

### External

- https://v4.zod.dev/json-schema
- https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema
- https://github.com/vercel/ai/issues/9351 (thinking mode + structured/tool constraints context)

## Open Questions (Answer During Milestone 1)

- [ ] What are the exact runtime `providerID` and `model.api.id` values for the failing setup?
- [ ] Does the failing model send `message` under an alias key (e.g., `text`/`prompt`), or is it truly missing?
- [ ] Is the tool schema actually being delivered to the model as expected (verify via runtime introspection / logging)?
