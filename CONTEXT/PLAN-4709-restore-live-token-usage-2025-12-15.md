## Context

- Upstream PR sst/opencode#4709 ("feat: show live token usage during streaming") added real-time token estimates, IN/OUT accounting, and a command-palette toggle to surface token details while a session streams. After an upstream merge the fork lost this functionality; the command palette no longer exposes the toggle and token counts aren't visible.
- User expectation: restore the PR's behavior in our fork so token usage is visible live during streaming and accurately accounts for inputs, reasoning, outputs, tool results, and context window usage.
- Upstream PR scope (from patch):
  - Add command palette option to toggle token display in TUI session view.
  - Display user token estimates (~tok) and assistant streaming estimates (~tok, ~think), IN/OUT totals, and context %.
  - Track sentEstimate/contextEstimate on user and assistant messages; accumulate tool result tokens sent back to the API.
  - Stream output/reasoning estimates across steps with change detection; reset estimates when real counts arrive.
  - Count synthetic/noReply correctly, avoid double-counting tool results, use CHARS_PER_TOKEN=4 helpers.

## Critical Discovery: Feature Was Previously Implemented

**The live token tracking feature was fully implemented in this fork and then lost during an upstream sync.**

- **Implementation commit**: `7faa5e2cbcbce73c86cc1e245bde52cb53bb4795` ("feat: real-time token tracking in TUI")
- **Lost during**: Merge `e39e2bab5` (sync: merge upstream v1.0.161 into integration)
- **Files affected**: Primarily `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- **Implication**: Much of the backend plumbing is still intact; only the UI code and some finishing touches were lost

The recommended approach is to **restore the UI code from the previous commit** rather than reimplementing from scratch.

## Current State (fork) - Verified

### Already Complete (no changes needed):

- `packages/opencode/src/util/token.ts`: All helpers present - `CHARS_PER_TOKEN=4`, `toCharCount`, `toTokenEstimate`, `calculateToolResultTokens` with null checks. **Matches upstream.**
- `packages/opencode/src/session/compaction.ts:124-127`: **Already propagates** all estimate fields from `lastFinished`:
  ```typescript
  outputEstimate: lastFinished?.outputEstimate,
  reasoningEstimate: lastFinished?.reasoningEstimate,
  contextEstimate: lastFinished?.contextEstimate,
  sentEstimate: lastFinished?.sentEstimate,
  ```
- `packages/opencode/src/session/message-v2.ts`: Schema fields present (`sentEstimate`, `contextEstimate` on User:308-309; `outputEstimate`, `reasoningEstimate`, `contextEstimate`, `sentEstimate` on Assistant:373-376).
- `packages/sdk/js/src/v2/gen/types.gen.ts`: SDK types generated with all estimate fields (lines 93-94, 168-171).

### Partially Complete:

- `packages/opencode/src/session/processor.ts`:
  - **Working**: Streaming accumulation using `Token.toTokenEstimate` (lines 86, 315)
  - **Working**: `reasoningEstimate` updated during reasoning-delta (line 86)
  - **Working**: `outputEstimate` updated during text-delta (line 315)
  - **Missing**: `outputEstimate` not cleared when real tokens arrive (after finish-step)
  - **Missing**: `contextEstimate` not set on finish (should be `tokens.input + tokens.cache.read`)

### Missing (needs implementation):

- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`:
  - No `showTokens` state in context (was deleted in merge)
  - No `Token` import (was deleted in merge)
  - No command palette entry "Toggle tokens"
  - No token display in `UserMessage` component
  - No token display in `AssistantMessage` component
  - KV key `"tokens"` for persistence not referenced
- `packages/opencode/src/session/prompt.ts`:
  - `createUserMessage` does not set `sentEstimate` or `contextEstimate`
  - No calculation of tool result tokens for outbound context

## Goals

- Restore live token visibility parity with upstream PR #4709 in TUI session view and data pipeline.
- Ensure command palette exposes a toggle for token display and persists preference via KV.
- Ensure token estimates (output, reasoning) stream in real time across steps; IN/OUT and context estimates are correct and reset on completion.
- Accurately count tokens sent to the API, including tool results and ignored/synthetic/noReply handling, without double-counting.

## Plan & Tasks (ordered)

### 1) Restore UI toggle and displays from previous commit

**Primary approach**: Restore code from commit `7faa5e2cb` to `session/index.tsx`

- [x] Re-add `Token` import: `import { Token } from "@/util/token"`
- [x] Re-add `showTokens` to context type definition (around line 84):
  ```typescript
  showTokens: () => boolean
  ```
- [x] Re-add `showTokens` signal with KV persistence (around line 182):
  ```typescript
  const [showTokens, setShowTokens] = createSignal(kv.get("tokens", "hide") === "show")
  ```
- [x] Re-add `showTokens` to context.Provider value
- [x] Register command palette entry "Toggle tokens" that flips `showTokens` and updates KV:
  ```typescript
  {
    title: showTokens() ? "Hide tokens" : "Show tokens",
    value: "session.toggle.tokens",
    category: "Session",
    onSelect: (dialog) => {
      setShowTokens((prev) => {
        const next = !prev
        kv.set("tokens", next ? "show" : "hide")
        return next
      })
      dialog.clear()
    },
  }
  ```
- [x] Restore token display in `UserMessage` component:
  - Calculate `individualTokens` from user message parts
  - Show `~{tokens} tok` when `showTokens()` is true and not queued
- [x] Restore token display in `AssistantMessage` component:
  - Show `IN{input}/OUT{output}` with estimates falling back to actual tokens
  - Show `~think` for reasoning estimates
  - Show context % based on model limit
- [x] Ensure displays respect existing flags (conceal, timestamps, thinking visibility, etc.)

**Reference**: `git show 7faa5e2cb:packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

### 2) Complete streaming estimate handling in processor.ts

**Location**: `packages/opencode/src/session/processor.ts`

- [x] Clear `outputEstimate` after real tokens arrive. Add after line 269 (after `await Session.updateMessage`):
  ```typescript
  // Clear streaming estimates now that real tokens are available
  input.assistantMessage.outputEstimate = undefined
  input.assistantMessage.reasoningEstimate = undefined
  ```
- [x] Set `contextEstimate` on finish. Add after line 258 (after setting `tokens`):
  ```typescript
  input.assistantMessage.contextEstimate = usage.tokens.input + usage.tokens.cache.read
  ```

**Already working (no changes needed)**:

- Reasoning accumulation via `reasoningTotal` (line 85-86)
- Output accumulation via `textTotal` (line 314-315)
- `Token.toTokenEstimate` helper usage

### 3) Accurate outbound token counting in prompt.ts

**Location**: `packages/opencode/src/session/prompt.ts`, function `createUserMessage` (around line 674)

- [x] Calculate `sentEstimate` for user messages - tokens in user's text parts:
  ```typescript
  const sentEstimate = parts
    .filter((p) => p.type === "text" && !p.ignored)
    .reduce((sum, p) => sum + Token.estimate(p.text), 0)
  ```
- [x] Calculate `contextEstimate` for user messages - includes prior context:
  ```typescript
  // Get last assistant's context usage as baseline
  const lastAssistant = /* find last assistant message */
  const priorContext = lastAssistant?.contextEstimate ?? lastAssistant?.tokens?.input ?? 0
  const toolResultTokens = Token.calculateToolResultTokens(/* prior tool parts */)
  const contextEstimate = priorContext + sentEstimate + toolResultTokens
  ```
- [x] Set estimates on user message info before saving:
  ```typescript
  info.sentEstimate = sentEstimate
  info.contextEstimate = contextEstimate
  ```
- [x] Add `Token` import if not present

### ~~4) Compaction and schema consistency~~ [COMPLETE - NO CHANGES NEEDED]

Verified complete in codebase review:

- [x] `compaction.ts:124-127` already propagates estimate fields from lastFinished
- [x] Schema alignment verified in `message-v2.ts` and SDK gen files

### 4) Validation

- [x] Run `bun test packages/opencode` to check for regressions
  - Tests pass (279 pass, 5 pre-existing failures unrelated to token tracking)
- [ ] **MANUAL** smoke test in TUI:
  - Start session, send prompt
  - Verify live IN/OUT/~think display during streaming
  - Toggle tokens via command palette (ctrl+p -> "Toggle tokens" / "Show tokens" / "Hide tokens")
  - Verify tool-call scenarios count correctly
  - Verify estimates transition to actual values on completion
- [ ] **MANUAL** Confirm no regressions to search (ctrl+/) or other command palette entries
- [ ] **MANUAL** Test KV persistence: enable tokens, restart TUI, verify still enabled

## Technical Notes

- Token estimation uses `CHARS_PER_TOKEN=4` (`packages/opencode/src/util/token.ts`)
- OUT tokens = user text + tool results sent to API
- IN tokens = assistant output tokens
- Context % = `(contextEstimate or tokens.input + tokens.cache.read) / model.limit.context * 100`
- Fields to maintain on messages: `sentEstimate`, `contextEstimate`, `outputEstimate`, `reasoningEstimate`, plus actual `tokens` object
- Avoid counting `ignored` text parts; include tool errors and compacted outputs via `Token.calculateToolResultTokens`
- KV persistence key: `"tokens"` with values `"show"` or `"hide"`

## Internal References

- TUI session UI: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Session processing: `packages/opencode/src/session/processor.ts`
- User message creation: `packages/opencode/src/session/prompt.ts` (function `createUserMessage`, ~line 674)
- Token utilities: `packages/opencode/src/util/token.ts`
- Compaction: `packages/opencode/src/session/compaction.ts` (already complete)
- Schemas: `packages/opencode/src/session/message-v2.ts`
- SDK types: `packages/sdk/js/src/v2/gen/types.gen.ts`

## External References

- Upstream PR for behavior/expectations: https://github.com/sst/opencode/pull/4709
- **Fork commit with full implementation**: `7faa5e2cbcbce73c86cc1e245bde52cb53bb4795`
- Upstream merge that caused loss: `e39e2bab5fc5f6140d837f15bea13df93828bdd9` (v1.0.161)

## Milestones

1. **UI restoration** (`session/index.tsx`) - restore from commit `7faa5e2cb`
2. **Processor completion** (`processor.ts`) - add clearing and contextEstimate
3. **Prompt estimates** (`prompt.ts`) - add sentEstimate/contextEstimate to user messages
4. **Validation** - tests + manual TUI smoke

## Estimated Effort

| Task                | Complexity | Notes                                                |
| ------------------- | ---------- | ---------------------------------------------------- |
| Task 1 (UI)         | Medium     | Restore from commit, adapt to current code structure |
| Task 2 (Processor)  | Low        | ~5 lines of code additions                           |
| Task 3 (Prompt)     | Medium     | New calculation logic needed                         |
| Task 4 (Validation) | Low        | Manual testing                                       |

**Total**: ~40% less effort than original plan due to existing backend plumbing

## Risks / Open Questions

- **Merge conflict risk**: When restoring UI code from `7faa5e2cb`, may need to adapt to changes made since (e.g., search functionality, keybind context)
- **Testing coverage**: No existing unit tests for token estimation logic; consider adding tests for `Token.calculateToolResultTokens` edge cases
- **Backward compatibility**: Estimate fields are optional in schema, so existing sessions will work (just won't display token info until new messages created)
- **Bus update frequency**: Streaming updates may be chatty; the existing implementation uses change-detection guards - preserve this pattern

## Rollback Strategy

- Feature can be disabled via KV: `kv.set("tokens", "hide")`
- Estimate fields are optional - old sessions continue to work
- No schema migration required
