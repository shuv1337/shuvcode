# Plan: TUI Bash Spinner Stops on Completion

**Issue:** [#270 - Fix TUI tool spinner never stops after command completion](https://github.com/Latitudes-Dev/shuvcode/issues/270)

**Created:** 2026-01-06

**Revised:** 2026-01-06 - Critical correction: Original hypothesis about metadata overwrites is incorrect. The guard already exists at `prompt.ts:664`. Investigation should focus on TUI reactivity chain, not metadata updates.

**Status:** REVISED - INCORPORATES CODEBASE FINDINGS

## Overview
The TUI Bash tool spinner continues animating after a command completes. The UI hides the spinner only when the tool part status is no longer `running`, so the plan focuses on ensuring the Bash tool part transitions to `completed` or `error` and that the TUI properly reacts to state changes.

## Requirements (from issue)
- [ ] Spinner disappears when tool part status transitions to `completed` or `error`.
- [ ] Bash tool parts move out of `running` state once the command exits.
- [ ] No lingering spinner in transcript/history after completion.

## Current Code Context
### Observations
- The Bash spinner uses a non-reactive constant `isRunning = props.part.state.status === "running"` in the session view; this can stay stale after updates.
- The Bash tool streams output via `ctx.metadata` asynchronously while the process is running.
- `SessionProcessor` updates tool parts to `completed` or `error` on tool-result/tool-error events.
- `ctx.metadata` in the prompt pipeline rewrites state with `status: "running"` and `time.start`. The guard checks in-memory toolcalls, but late metadata can still race with persisted updates if the entry has not been cleared yet.

### Internal References
| Area | File | Notes |
| --- | --- | --- |
| Bash spinner state | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:2088-2152` | `isRunning` is a non-reactive const; `Show when={isRunning}`. |
| Tool status transitions | `packages/opencode/src/session/processor.ts:171-209` | Sets tool part to `completed` on tool-result, `error` on tool-error. |
| Metadata guard + overwrite risk | `packages/opencode/src/session/prompt.ts:662-676` | Guard checks toolcalls entry; `ctx.metadata` rewrites status to `running`. |
| Bash tool execution | `packages/opencode/src/tool/bash.ts:201-217` | Streams output via `ctx.metadata` (fire-and-forget). |
| Bash tool return | `packages/opencode/src/tool/bash.ts:293-300` | Returns `{ title, metadata, output }` triggering tool-result. |
| Event definition | `packages/opencode/src/session/message-v2.ts:419-425` | Event name is `message.part.updated`. |
| Session updatePart publish | `packages/opencode/src/session/index.ts:391-399` | Publishes `MessageV2.Event.PartUpdated`. |
| TUI sync context | `packages/opencode/src/cli/cmd/tui/context/sync.tsx:112-249` | Handles `message.part.updated` events into store. |
| Spinner frames | `packages/opencode/src/cli/cmd/tui/util/spinners.ts` | Provides `getSpinnerFrame()` used by TUI. |

## Technical Approach and Decisions
### Hypotheses to Validate

**Hypothesis 1: tool-result not emitted** (Unlikely)
- The tool-result event is not emitted for Bash tool executions, so status never reaches `completed`.
- **Assessment:** Bash tool returns via `return { title, metadata, output }` at `bash.ts:293-300`, which should trigger tool-result in the AI SDK.

**Hypothesis 2: non-reactive spinner state** (Likely)
- `isRunning` is a non-reactive const in the Bash component; it can remain `true` after status updates.

**Hypothesis 3: metadata overwrites** (Possible - guard not sufficient)
- `ctx.metadata` rewrites status to `running`. The guard only checks the in-memory toolcalls entry; late metadata can still race with persisted `completed` updates.

**Hypothesis 4: TUI reactivity gap / event delivery** (Possible)
- The completion update is emitted but not reflected in the TUI due to sync or rendering issues.
- Solid.js reactivity chain: `sync.data.part[messageID]` → component props → `isRunning` derivation
- Event name is `message.part.updated`; confirm the stream delivers it.

**Hypothesis 5: Part lookup mismatch** (Possible)
- The TUI looks up parts by `messageID` but the spinner component receives the wrong part reference.
- Need to verify TUI part lookup matches the part being updated.

### Decision (Revised)
Prioritize the **non-reactive spinner state** and validate ordering/race conditions:
1. Confirm `isRunning` is non-reactive in the Bash component and fix it if so.
2. Verify tool-result fires and `Session.updatePart` is called with `status: "completed"`.
3. Validate whether late `ctx.metadata` calls can regress the persisted status.
4. Verify the event stream (`message.part.updated`) reaches the TUI sync store.

### Option Comparison (Revised)
| Option | Summary | Pros | Cons | Decision |
| --- | --- | --- | --- | --- |
| Fix Bash spinner reactivity | Make `isRunning` reactive (memo or inline check) | Directly addresses likely root cause | Requires UI change only | **Primary fix** |
| Guard against status regression | Prevent `completed`/`error` -> `running` writes | Eliminates race risk | Needs careful invariants | Secondary if race confirmed |
| Verify event delivery | Confirm `message.part.updated` events reach sync store | Confirms data path | Diagnostic only | Diagnostic step |
| Fix part lookup mismatch | Ensure spinner uses updated part instance | Resolves mismatched references | Less likely | Triage if needed |
| Add timeout-based spinner hide | Hide spinner after N seconds regardless of status | Simple workaround | Masks underlying bug | Rejected |

## Technical Specifications
### Tool Part Status Flow
- Initial tool part state: `running`.
- Completion: `completed` with `time.end`, `metadata`, `output`.
- Failure: `error` with `time.end` and error message.

### Bash Tool Metadata Schema
- `metadata.output`: raw output (possibly truncated).
- `metadata.description`: user-provided description.
- `metadata.exit`: process exit code (final result).

### UI Behavior
- Spinner visible only when `props.part.state.status === "running"`.

## Implementation Plan

### Milestone 1: Reproduce and Trace State Transitions
- [ ] Reproduce in TUI and confirm the Bash part status after command completion (server-side).
- [ ] Inspect `Bash` component `isRunning` for reactivity; convert to `createMemo` or inline reactive check if stale.
- [ ] Add logging to `processor.ts:171-191` (tool-result case) to verify it fires for Bash tool.
- [ ] Add logging to `Session.updatePart` to confirm it's called with `status: "completed"`.
- [ ] Log when `ctx.metadata` attempts to write after completion (guarded and unguarded cases).

### Milestone 2: Trace Event Delivery and Store Updates
- [ ] Add logging to TUI sync handler when `message.part.updated` is received.
- [ ] Add logging when `sync.data.part[messageID]` is updated in the store.
- [ ] Identify the TUI component that renders the Bash spinner and trace its props/derivations.
- [ ] Confirm the component re-renders on part status change (post `isRunning` fix).

### Milestone 3: Fix Based on Findings
Based on investigation, the fix will be one or more of:
- [ ] Fix Bash spinner reactivity (`isRunning` as memo or inline check).
- [ ] **If metadata regression confirmed:** Prevent `completed`/`error` → `running` writes (guard in `Session.updatePart` or `ctx.metadata`).
- [ ] **If event not delivering:** Fix event stream subscription or reconnection logic.
- [ ] **If store not updating:** Fix Solid.js store update (ensure `produce` or proper setter is used).
- [ ] **If part lookup wrong:** Fix the part ID/callID matching between processor and TUI.

### Milestone 4: Tests
- [ ] Add a session-level test to verify tool-result → part status `completed` transition.
- [ ] **If regression guard added:** Add a test that prevents `completed`/`error` → `running` status downgrade.
- [ ] Document TUI spinner verification as manual (no TUI harness today).

### Milestone 5: Manual Validation
- [ ] Run a Bash command via the TUI and confirm the spinner stops.
- [ ] Verify at least one other tool (Write or Task) still updates correctly.
- [ ] **NEW:** Test with both short (<1s) and long (>5s) running commands.
- [ ] **NEW:** Test spinner behavior when command errors (non-zero exit).

## Validation Criteria
### Automated
- [ ] `bun test` in `packages/opencode` passes.
- [ ] New tests cover status transitions and any regression guard (if added).

### Manual
- [ ] Bash tool spinner disappears after command completion.
- [ ] Bash tool parts show `completed` or `error` statuses in transcript/history.
- [ ] No regressions in other tool spinners.

### Suggested Commands
```bash
cd /home/shuv/repos/worktrees/shuvcode/shuvcode-dev/packages/opencode
bun test
```

## Current Findings

Based on codebase review:

1. **`ctx.metadata` guard exists but is not conclusive**
   - Guard checks the in-memory toolcalls entry; late metadata can still race if the entry has not been cleared yet.
2. **Bash tool metadata calls are fire-and-forget**
   - Streaming metadata updates (`bash.ts:201-217`) are not awaited and can arrive after completion.
3. **tool-result handler updates status when invoked**
   - `processor.ts:171-188` sets status to `completed`; still verify it fires for Bash tool.

## External References (Git URLs)
- https://github.com/sindresorhus/ora
- https://github.com/typesense/typesense/blob/e44a57004c981c8d7be7459d792a0fc971fdb05d/benchmark/src/services/typesense-process.ts
- https://github.com/vadimdemedes/pronto/blob/5e5ea6a8e38eec315542021010efd5d1efcb9e72/cli.js

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Non-reactive `isRunning` is the root cause | High | Fix to reactive memo/inline check; re-test spinner behavior. |
| Metadata race causes status regression | Medium | Add regression guard and test; log ordering for confirmation. |
| Root cause is in Solid.js reactivity beyond Bash component | Medium | Use Solid.js DevTools or targeted logging to trace updates. |
| SSE disconnection causes missed updates | Medium | Check SSE reconnection logic; consider adding heartbeat verification. |
| Logging overwhelms output | Low | Gate logs behind debug flag or sample output. |
| Fix breaks other tool spinners | Medium | Add regression test for Write or Task tool and verify manually. |
| Investigation takes longer than fix | Low | Time-box investigation to 2 hours; document findings even if incomplete. |
