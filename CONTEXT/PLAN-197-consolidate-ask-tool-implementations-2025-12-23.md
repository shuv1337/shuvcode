# PLAN-197: Consolidate Ask Tool Implementations

**Issue:** [#197 - Review and consolidate 'ask' tool implementations - response handler mismatch causes spinner hang](https://github.com/Latitudes-Dev/shuvcode/issues/197)

**Created:** 2025-12-23

**Status:** Implementation Complete (pending manual TUI verification)

---

## Problem Summary

When using the `ask` tool with a freeform text prompt, submitting a response does not complete the tool - the active spinner continues indefinitely until the user aborts.

This is caused by having **two separate `ask` tool implementations** with different response mechanisms:

1. **`ask` tool** - Uses Bus events (`TuiEvent.QuestionRequest/QuestionResponse`)
2. **`askquestion` tool** - Uses HTTP endpoints (`AskQuestion.register/respond`)

The TUI has handlers for both systems, but they use different UI components and response flows, causing the mismatch.

---

## Decision

**Keep `askquestion` and remove the `ask` tool entirely.**

Rationale:

- `askquestion` is the upstream implementation (PR #5958) and is actively maintained
- `askquestion` uses a more reliable HTTP-based response mechanism
- The `ask` tool's Bus event approach appears to suffer from a scoping/routing mismatch (suspected: Instance state scoping prevents events from reaching the tool's subscription). This is a contributing factor but is not required to be fully proven before removal.
- Removing `ask` eliminates the duplicate code and confusion

**Note:** We are NOT merging features from `ask` into `askquestion`. The existing `askquestion` functionality (select, multi-select with custom text option) is sufficient. The `confirm` and `text` question types from `ask` will be removed along with the tool.

---

## Compatibility & Migration Strategy

- **Breaking change:** The `ask` tool will no longer be registered, and external callers using `ask` will receive "unknown tool" errors.
- **Schema migration:** `askquestion` is not a drop-in replacement. Update call sites to use `{ id, label, question, options, multiSelect? }` with 1-6 questions and 2-8 options; remove `message`, `title`, `timeout`, `defaultValue`, `min/max`, `placeholder`, and `validate`. Use explicit Yes/No options or the custom text option to emulate confirm/text flows.
- **Output/metadata migration:** `askquestion` answers are shaped as `{ questionId, values, customText? }` and omit `type`/`value(s)` fields used by `ask`; update any consumers that parse tool output/metadata.
- **Prompt/doc migration:** Update any internal prompts/docs/configs that refer to `ask` to use `askquestion` and the new schema (for example `packages/opencode/src/session/prompt/plan.txt`).
- **User-facing behavior:** `/tools` and any tool listing will no longer include `ask` after removal.

---

## Current Architecture Analysis

### Tool 1: `ask` (TO BE REMOVED)

**File:** `packages/opencode/src/tool/ask.ts`

**Purpose:** Fork-specific implementation for collecting user input via dialogs.

**Question Types Supported:**

- `select` - Single choice from options
- `multi-select` - Multiple choices from options
- `confirm` - Yes/no boolean
- `text` - Free-form text input

**Response Flow (BROKEN):**

```
Tool execute()
  └─> Bus.publish(TuiEvent.QuestionRequest)
        └─> TUI app.tsx handler receives event
              └─> Opens DialogQuestion component (overlay dialog)
                    └─> User submits response
                          └─> sdk.client.tui.publish() sends TuiEvent.QuestionResponse
                                └─> Server /tui/publish endpoint
                                      └─> Bus.publish(TuiEvent.QuestionResponse)
                                            └─> Tool's Bus.subscribe() never receives response
                                                (suspected: Instance.state() scoping issue)
```

**Key Files (TO BE DELETED):**

- `packages/opencode/src/tool/ask.ts` - Tool implementation
- `packages/opencode/src/question/index.ts` - Question/Answer schemas
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/` - UI components

### Tool 2: `askquestion` (TO KEEP)

**File:** `packages/opencode/src/tool/askquestion.ts`

**Purpose:** Upstream implementation for wizard-style multi-question flows.

**Question Types Supported:**

- Single-select with custom text option
- Multi-select with custom text option
- All questions displayed as tabs in wizard UI

**Response Flow (WORKING):**

```
Tool execute()
  └─> AskQuestion.register() creates pending promise
        └─> ctx.metadata() updates tool state to "waiting"
              └─> TUI detects pending via pendingAskQuestionFromSync()
                    └─> Opens DialogAskQuestion component (inline in session)
                          └─> User submits response
                                └─> HTTP POST to /askquestion/respond
                                      └─> AskQuestion.respond() resolves promise
                                            └─> Tool returns result
```

**Key Files (TO KEEP):**

- `packages/opencode/src/tool/askquestion.ts` - Tool implementation
- `packages/opencode/src/tool/askquestion.txt` - Description
- `packages/opencode/src/askquestion/index.ts` - AskQuestion namespace
- `packages/opencode/src/server/server.ts:1538-1605` - HTTP endpoints
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:395-426,1426-1461` - Sync detection + UI
- `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx` - Wizard UI component

---

## Implementation Plan

### Phase 0: Pre-Removal Audit (New)

- [x] **Task 0.1:** Search for `ask` references in prompts/docs/configs
  - Verify no internal docs, prompts, or scripts reference `ask`
  - Update any found references to `askquestion` with the new schema

- [x] **Task 0.2:** Update plan-mode prompt to avoid `ask`
  - File: `packages/opencode/src/session/prompt/plan.txt`
  - Replace the "prefer using `ask`" guidance with `askquestion`

- [x] **Task 0.3:** Audit any `ask` tool call sites in code/tests/fixtures
  - Migrate calls to the `askquestion` schema (label/question/options, 1-6 questions, 2-8 options)
  - Update any consumers of `ask` output/metadata to the `askquestion` answer shape
  - Confirm no remaining `ask` tool invocations exist

### Phase 1: Remove `ask` Tool Registration

- [x] **Task 1.1:** Remove `AskTool` import and registration from registry
  - File: `packages/opencode/src/tool/registry.ts`
  - Remove line 1: `import { AskTool } from "./ask"`
  - Remove line 96: `AskTool,` from the tools array

### Phase 2: Remove `ask` Tool Event Handlers from TUI

- [x] **Task 2.1:** Remove QuestionRequest event handler from app.tsx
  - File: `packages/opencode/src/cli/cmd/tui/app.tsx`
  - Remove lines 550-597 (the `sdk.event.on(TuiEvent.QuestionRequest.type, ...)` handler)
  - Remove line 34: `import { DialogQuestion } from "@tui/component/dialog-question"`
  - Remove line 35: `import type { Question } from "@/question"`

- [x] **Task 2.2:** Remove Question events from TuiEvent
  - File: `packages/opencode/src/cli/cmd/tui/event.ts`
  - Remove line 3: `import { Question } from "@/question"`
  - Remove lines 40-41: `QuestionRequest` and `QuestionResponse` definitions

### Phase 3: Delete `ask` Tool Files

- [x] **Task 3.1:** Delete the ask tool implementation
  - Delete: `packages/opencode/src/tool/ask.ts`

- [x] **Task 3.2:** Delete the Question namespace
  - Delete: `packages/opencode/src/question/index.ts`

- [x] **Task 3.3:** Delete the DialogQuestion component directory
  - Delete: `packages/opencode/src/cli/cmd/tui/component/dialog-question/` (entire directory)
    - `dialog-question.tsx`
    - `dialog-question-select.tsx`
    - `dialog-question-multi-select.tsx`
    - `dialog-question-confirm.tsx`
    - `dialog-question-text.tsx`
    - `types.ts`
    - `index.ts`

### Phase 4: Update/Remove Tests

- [x] **Task 4.1:** Decide and execute test strategy
  - Option A (executed): Delete `packages/opencode/test/tool/ask.test.ts` and explicitly accept reduced coverage
  - Option B (preferred): Replace with a minimal `askquestion` schema test to keep some coverage

### Phase 5: Verification

- [x] **Task 5.1:** Build verification

  ```bash
  cd packages/opencode && bun run build
  ```

  - Ensure no TypeScript errors
  - Ensure no missing imports

- [x] **Task 5.2:** Test verification

  ```bash
  cd packages/opencode && bun test
  ```

  - Ensure all remaining tests pass (340 pass, 1 skip, 0 fail)

- [ ] **Task 5.3:** Manual TUI testing
  - Start the TUI: `bun dev`
  - Verify `askquestion` tool still works correctly
  - Verify no errors related to missing `ask` tool
  - Verify `/tools` (or any tool listing) no longer includes `ask`

---

## Files to Modify

| File                                            | Action | Changes                                                             |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------- |
| `packages/opencode/src/tool/registry.ts`        | Modify | Remove AskTool import and registration                              |
| `packages/opencode/src/cli/cmd/tui/app.tsx`     | Modify | Remove QuestionRequest handler, DialogQuestion, and Question import |
| `packages/opencode/src/cli/cmd/tui/event.ts`    | Modify | Remove Question import and event definitions                        |
| `packages/opencode/src/session/prompt/plan.txt` | Modify | Replace `ask` guidance with `askquestion` usage                     |

## Files to Delete

| File/Directory                                                 | Reason                                      |
| -------------------------------------------------------------- | ------------------------------------------- |
| `packages/opencode/src/tool/ask.ts`                            | Deprecated tool implementation              |
| `packages/opencode/src/question/index.ts`                      | Only used by ask tool                       |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/` | UI for deprecated ask tool                  |
| `packages/opencode/test/tool/ask.test.ts`                      | Tests for deprecated tool (unless replaced) |

## Files to Keep (No Changes)

| File                                                          | Reason                     |
| ------------------------------------------------------------- | -------------------------- |
| `packages/opencode/src/tool/askquestion.ts`                   | Working implementation     |
| `packages/opencode/src/tool/askquestion.txt`                  | Tool description           |
| `packages/opencode/src/askquestion/index.ts`                  | AskQuestion namespace      |
| `packages/opencode/src/server/server.ts`                      | HTTP endpoints (unchanged) |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`  | Sync detection (unchanged) |
| `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx` | Wizard UI (unchanged)      |

---

## Validation Criteria

### Implementation Complete When:

- [x] `AskTool` is not registered in `registry.ts`
- [x] No imports of `@/question` or `../question` exist in the codebase
- [x] No `TuiEvent.QuestionRequest` or `TuiEvent.QuestionResponse` references exist
- [x] `packages/opencode/src/tool/ask.ts` is deleted
- [x] `packages/opencode/src/question/` directory is deleted
- [x] `packages/opencode/src/cli/cmd/tui/component/dialog-question/` directory is deleted
- [x] `ask` references in docs/prompts/configs are migrated to `askquestion`
- [x] Any migrated call sites use the `askquestion` schema (label/question/options, 1-6 questions, 2-8 options)
- [x] Build passes with no TypeScript errors
- [x] All tests pass
- [ ] `askquestion` tool works correctly in TUI (pending manual verification)
- [ ] Tool listings no longer show `ask` (pending manual verification)

---

## Risk Assessment

| Risk                                          | Likelihood | Impact | Mitigation                                                                                   |
| --------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------- |
| Breaking upstream sync                        | Low        | Medium | Only removing fork-specific code; askquestion is upstream                                    |
| LLM still tries to use `ask` tool             | Low        | Low    | Remove internal references; external callers will need migration note                        |
| Schema mismatch for existing `ask` call sites | Medium     | Medium | Audit/migrate call sites to askquestion schema; consider explicit adapter or migration notes |
| Missing functionality                         | Low        | Low    | askquestion covers main use cases; confirm/text can be added later if needed                 |

---

## Appendix: Files Using `@/question` Import

These files import from `@/question` and need the import removed:

1. `packages/opencode/src/tool/ask.ts` - TO BE DELETED
2. `packages/opencode/src/cli/cmd/tui/event.ts` - MODIFY
3. `packages/opencode/src/cli/cmd/tui/app.tsx` - MODIFY
4. `packages/opencode/src/cli/cmd/tui/component/dialog-question/types.ts` - TO BE DELETED
5. `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-multi-select.tsx` - TO BE DELETED
6. `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question.tsx` - TO BE DELETED
7. `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-confirm.tsx` - TO BE DELETED
8. `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-text.tsx` - TO BE DELETED
9. `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-select.tsx` - TO BE DELETED

---

## Appendix: Git History

```
a1c9fec1c feat: merge upstream PR #5958 askquestion tool (replaces #5563)
19ad1ee52 fix(askquestion): fix memory leaks, race conditions, and TUI UX bugs
3a23fec31 feat(askquestion): fix race condition and improve TUI UX
7ff537213 fix: ask tool schema validation and bash carriage return handling
36a1f210e feat: add Ask tool for collecting user input via dialogs
```

The commit message "replaces #5563" explicitly indicates `askquestion` was intended to supersede the original `ask` tool implementation.
