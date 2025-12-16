## Context

- Upstream PR sst/opencode#4709 (“feat: show live token usage during streaming”) added real-time token estimates, IN↓/OUT↑ accounting, and a command-palette toggle to surface token details while a session streams. After an upstream merge the fork lost this functionality; the command palette no longer exposes the toggle and token counts aren’t visible.
- User expectation: restore the PR’s behavior in our fork so token usage is visible live during streaming and accurately accounts for inputs, reasoning, outputs, tool results, and context window usage.
- Upstream PR scope (from patch):
  - Add command palette option to toggle token display in TUI session view.
  - Display user token estimates (~tok) and assistant streaming estimates (~tok, ~think), IN↓/OUT↑ totals, and context %.
  - Track sentEstimate/contextEstimate on user and assistant messages; accumulate tool result tokens sent back to the API.
  - Stream output/reasoning estimates across steps with change detection; reset estimates when real counts arrive.
  - Count synthetic/noReply correctly, avoid double-counting tool results, use CHARS_PER_TOKEN=4 helpers.

## Current State (fork)

- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`: command palette lacks “Toggle tokens”; no token display in user/assistant message renders; no IN↓/OUT↑ or ~estimates visible; no showTokens flag in context.
- `packages/opencode/src/session/prompt.ts`: does not set sentEstimate/contextEstimate; does not include tool result tokens; does not persist estimates across steps; still filters synthetic instead of ignored for token calc; no noReply handling.
- `packages/opencode/src/session/processor.ts`: has basic output/reasoning estimates but no char<->token helpers, no accumulation across process() invocations, no contextEstimate on finish, outputEstimate not cleared on completion; estimation logic still per-block.
- `packages/opencode/src/session/compaction.ts`: carries no estimate fields forward into compaction requests.
- `packages/opencode/src/util/token.ts`: already includes CHARS_PER_TOKEN helpers and safe tool-result counting (with null checks) — this matches upstream patch.
- Schema fields present (`sentEstimate`, `contextEstimate`, `outputEstimate`, `reasoningEstimate` in `packages/opencode/src/session/message-v2.ts` and SDK gen files), so downstream display logic can rely on them.

## Goals

- Restore live token visibility parity with upstream PR #4709 in TUI session view and data pipeline.
- Ensure command palette exposes a toggle for token display and persists preference via KV.
- Ensure token estimates (output, reasoning) stream in real time across steps; IN↓/OUT↑ and context estimates are correct and reset on completion.
- Accurately count tokens sent to the API, including tool results and ignored/synthetic/noReply handling, without double-counting.

## Plan & Tasks (ordered)

### 1) Reintroduce UI toggle and displays

- [ ] Add `showTokens` state + KV persistence in session context (`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`).
- [ ] Register command palette entry “Toggle tokens” that flips `showTokens` and updates KV.
- [ ] Compute context limit from current model for token % display.
- [ ] Render user message token estimate (~tok) when enabled and queued state allows.
- [ ] Render assistant message token strings with live estimates: `IN↓/OUT↑` (estimates -> actual), `~think`, context %; guard for missing data.
- [ ] Ensure displays hide when estimates unavailable and respect existing flags (conceal, timestamps, thinking visibility, username visibility, etc.).

### 2) Streaming estimate plumbing

- [ ] In `session/processor.ts`, accumulate reasoning/output character totals across stream cycles using `Token.toCharCount`/`toTokenEstimate`; update message estimates only on change; clear outputEstimate on finish; set contextEstimate on finish.
- [ ] Maintain active reasoning map accumulation to avoid undercounting across multiple reasoning blocks.
- [ ] Preserve existing behavior for step parts and retries.

### 3) Accurate outbound token counting

- [ ] In `session/prompt.ts`, calculate `sentEstimate`/`contextEstimate` for user messages using `Token.estimate` on non-ignored text parts and include prior assistant tool results via `Token.calculateToolResultTokens` (avoid double-counting, use ignored instead of synthetic, include noReply).
- [ ] Carry forward assistant `sentEstimate`/`contextEstimate`/`outputEstimate`/`reasoningEstimate` into subsequent steps and compaction requests.
- [ ] When preparing assistant messages, include tokens for tool results being resent in the API call; avoid exponential growth.
- [ ] Ensure task tool execution metadata uses correct callIDs and preserves completion handling (per upstream bug note).

### 4) Compaction and schema consistency

- [ ] In `session/compaction.ts`, propagate estimate fields from last finished assistant into compaction assistant message seeds.
- [ ] Verify schema alignment already present (`message-v2`, SDK gens); no changes expected unless discrepancies appear during diff.

### 5) Validation

- [ ] Run targeted tests: `bun test packages/opencode` (or repo default) focusing on session/prompt/token logic if suites exist.
- [ ] Manual smoke in TUI: start session, send prompt, observe live IN↓/OUT↑/~think display during streaming; toggle tokens via command palette; verify tool-call scenarios and noReply/synthetic content still counted correctly.
- [ ] Confirm no regressions to search/browse keybinds or other command palette entries.

## Technical Notes

- Token estimation uses CHARS_PER_TOKEN=4 (`packages/opencode/src/util/token.ts`). Use `Token.toCharCount`/`toTokenEstimate` for accumulation.
- OUT tokens = user text + tool results sent to API; IN tokens = assistant output tokens. Context % uses input+cache tokens (or contextEstimate during streaming).
- Fields to maintain on messages: `sentEstimate`, `contextEstimate`, `outputEstimate`, `reasoningEstimate`, plus actual `tokens` object.
- Avoid counting ignored text parts; include tool errors and compacted outputs via `Token.calculateToolResultTokens`.

## Internal References

- TUI session UI: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`, `header.tsx`, `sidebar.tsx`.
- Session processing: `packages/opencode/src/session/processor.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/compaction.ts`, `packages/opencode/src/util/token.ts`.
- Schemas/SDK: `packages/opencode/src/session/message-v2.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts`, `packages/sdk/js/src/gen/types.gen.ts`.

## External References

- Upstream PR for behavior/expectations: https://github.com/sst/opencode/pull/4709
- Optional: cherry-pick source commits if needed (8c917d8, 9fabaf5, 09aaec4, 0f7d18a, d7aefec) from upstream repo.

## Milestones

1. UI toggle & display wired (`session/index.tsx`).
2. Streaming estimator correctness (`session/processor.ts`).
3. Accurate sent/context estimation + tool result counting (`session/prompt.ts` + compaction).
4. Validation (tests + manual TUI smoke).

## Risks / Open Questions

- Need to confirm existing task tool completion bug (comment on upstream thread) is already fixed elsewhere; verify during testing.
- Ensure estimate fields don’t regress serialization/backcompat in persisted session data; watch for migration needs if stored sessions exist.
- Streaming updates may be chatty; keep change-detection guards to avoid excessive bus updates.
