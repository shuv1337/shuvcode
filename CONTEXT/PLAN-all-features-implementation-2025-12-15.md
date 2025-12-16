# Implementation Plan: All Open Feature Issues

**Date**: 2025-12-15  
**Issues**: #132, #133, #134  
**Repository**: Latitudes-Dev/shuvcode

---

## Executive Summary

This document provides a detailed implementation plan for three feature requests:

| Issue | Feature                                    | Complexity | Status          | Effort    |
| ----- | ------------------------------------------ | ---------- | --------------- | --------- |
| #132  | Plugin Commands (upstream PR #4411)        | Medium     | **Implemented** | ~0 hrs    |
| #133  | Ask TUI Tool (upstream PR #5563)           | High       | **Implemented** | ~8-12 hrs |
| #134  | Granular Agent File Permissions Using Glob | High       | **Implemented** | ~6-10 hrs |

**Recommended Priority Order**: #132 (verification only) -> #134 -> #133

---

## Issue #132: Plugin Commands from Upstream PR #4411

### Status: IMPLEMENTED

The plugin commands feature has already been integrated into the fork. All code changes from upstream PR #4411 are present:

**Completed Tasks**:

- [x] `packages/plugin/src/index.ts` - `plugin.command` hook interface (lines 199-208)
- [x] `packages/opencode/src/plugin/index.ts` - `plugin.command` excluded from trigger, `client()` export added
- [x] `packages/opencode/src/command/index.ts` - Schema updated with `sessionOnly`/`aliases`, plugin command loading
- [x] `packages/opencode/src/session/prompt.ts` - Plugin command execution with error handling (lines 1237-1292)
- [x] `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` - `sessionOnly` filtering, aliases support
- [x] `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` - Alias resolution
- [x] `packages/sdk/js/src/gen/types.gen.ts` - `sessionOnly` added to Command type
- [x] `packages/sdk/js/src/v2/gen/types.gen.ts` - `sessionOnly` and `aliases` added to Command type

### Remaining Tasks

Only manual testing is required:

- [x] Start dev server: `cd packages/opencode && bun dev`
- [x] Create test plugin at `.opencode/plugin/test-commands.ts`:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const TestCommandsPlugin: Plugin = async (ctx) => {
  return {
    "plugin.command": {
      hello: {
        description: "Say hello from plugin",
        aliases: ["hi", "greet"],
        sessionOnly: true,
        async execute({ sessionID, client }) {
          console.log(`Hello command executed for session: ${sessionID}`)
        },
      },
    },
  }
}
```

- [x] Test plugin commands appear in autocomplete when typing `/`
- [x] Test `sessionOnly` filtering (command hidden when no session)
- [x] Test alias resolution (`/hi` -> `/hello`)
- [x] Test error handling

**Action**: Close issue #132 after manual verification confirms functionality.

---

## Issue #133: Ask TUI Tool (Upstream PR #5563)

### Status: IMPLEMENTED

### Overview

Introduce an "Ask" tool that lets agents collect clarifying input via the TUI. Supports **select**, **multi-select**, **confirm**, and **text** questions.

**Key repository reality**: the TUI already receives events via the server SSE stream (`/event`), and can send events back via `POST /tui/publish`. The Ask tool should reuse this transport instead of inventing a new channel.

### Technical Scope

**Lines of Code**: ~3,200 additions, ~50 deletions  
**Estimated Effort**: 8-12 hours

### Files to Create

| File                                                                                           | Purpose                                   | Lines |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------- | ----- |
| `packages/opencode/src/question/index.ts`                                                      | Question data types and schemas           | ~120  |
| `packages/opencode/src/tool/ask.ts`                                                            | Ask tool definition + request/await logic | ~200  |
| `packages/opencode/src/cli/cmd/tui/ui/dialog-multiselect.tsx`                                  | Multi-select dialog (no existing one)     | ~150  |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question.tsx`              | Main dialog component                     | ~150  |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-select.tsx`       | Select component                          | ~85   |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-multi-select.tsx` | Multi-select component                    | ~90   |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-confirm.tsx`      | Confirm component                         | ~85   |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-text.tsx`         | Text input component                      | ~40   |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-comment.tsx`      | Comment sub-dialog                        | ~30   |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/helpers.ts`                       | Helper functions                          | ~60   |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/types.ts`                         | TypeScript types                          | ~25   |
| `packages/opencode/src/cli/cmd/tui/component/dialog-question/index.ts`                         | Module exports                            | ~10   |

### Files to Modify

| File                                                         | Changes                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/cli/cmd/tui/event.ts`                 | Add events to `TuiEvent` object (required for `/tui/publish` validation)                                    |
| `packages/opencode/src/tool/registry.ts`                     | Register Ask tool in tool list                                                                              |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | Subscribe to `tui.question.request`, open dialog-question UI, and respond via `sdk.client.tui.publish(...)` |
| `packages/opencode/src/cli/cmd/tui/ui/dialog-select.tsx`     | Add optional `hideSearch`, `beforeFooter` (to reuse existing UI)                                            |
| `packages/sdk/js`                                            | Regenerate SDK so new TUI event types exist in the typed `tui.publish` union                                |

### Architecture & Execution Model

#### Transport (Server <-> TUI)

- **Tool -> TUI**: publish `tui.question.request` on the server bus so it arrives over SSE.
- **TUI -> Tool**: TUI posts `tui.question.response` back to the server using `sdk.client.tui.publish({ body: { type, properties } })`.
- **Explicit non-goal**: do not use the existing `/tui/control` request/response queue for Ask; Ask uses the same event stream + publish path as other TUI events.

#### Event Payloads

- `tui.question.request` properties should include (at minimum):
  - `questionID` (unique ID for correlating responses)
  - `sessionID`, `messageID`, `callID` (for UI routing + tool correlation)
  - `questions[]` (typed items: select/multi/confirm/text, plus optional metadata like default, placeholder, help text)
- `tui.question.response` properties should include:
  - `questionID`
  - `status`: `"ok" | "cancel" | "timeout"`
  - `answers` (typed output per question)
  - optional `comment`

#### TuiEvent Integration (Critical)

Events **must** be added to the `TuiEvent` object in `event.ts`, not just as type definitions. The `/tui/publish` endpoint validates using `Object.values(TuiEvent)`:

```typescript
// packages/opencode/src/cli/cmd/tui/event.ts
export const TuiEvent = {
  // existing events...
  QuestionRequest: BusEvent.define("tui.question.request", QuestionRequestSchema),
  QuestionResponse: BusEvent.define("tui.question.response", QuestionResponseSchema),
}
```

This is required because `/tui/publish` builds its validator from `Object.values(TuiEvent)` (see `packages/opencode/src/server/server.ts:2368-2377`).

#### Tool Execution

- `ask` tool emits `tui.question.request` and awaits the matching `tui.question.response`.
- Await logic must:
  - have a timeout (configurable default, e.g., 5 minutes)
  - enforce at most one outstanding ask per session (reject or queue additional requests)

#### Abort/Cleanup Handling (Critical)

The current `Tool.Context` does not have an `abort` property. Follow the existing `Permission.ask()` pattern instead:

```typescript
// packages/opencode/src/permission/index.ts - existing pattern to follow
const state = Instance.state(
  () => ({ pending: {}, approved: {} }),
  async (state) => {
    // On instance disposal, reject all pending promises
    for (const pending of Object.values(state.pending)) {
      for (const item of Object.values(pending)) {
        item.reject(new RejectedError(...))
      }
    }
  },
)
```

Implementation approach:

1. Store pending question promises in `Instance.state()` with a disposal callback
2. On instance disposal, reject all pending questions with `Permission.RejectedError`
3. On session switch/close, TUI should call `sdk.client.tui.publish()` with `status: "cancel"`
4. Implement timeout via `Promise.race()` with a timer that rejects after configured duration

### Implementation Phases

#### Phase 1: Question Data Model (~1 hour)

- Create `packages/opencode/src/question/index.ts` with zod schemas for questions + answers.

#### Phase 2: Events + Transport (~2-3 hours)

- Add `tui.question.request` and `tui.question.response` to `packages/opencode/src/cli/cmd/tui/event.ts`.
- Implement server-side await logic in `packages/opencode/src/tool/ask.ts` by subscribing to bus events and resolving the matching `questionID`.

#### Phase 3: Dialog Components (~4-6 hours)

- Build dialog-question components using existing dialog/provider patterns.
- Reuse existing `DialogSelect` UX; extend `packages/opencode/src/cli/cmd/tui/ui/dialog-select.tsx` only as needed.

#### Phase 4: TUI Integration + SDK Regen (~2-3 hours)

- In `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`, listen for `tui.question.request`, render the dialog, then call `sdk.client.tui.publish(...)` with `tui.question.response`.
- Regenerate SDK types so `sdk.client.tui.publish` accepts the new question events.

### Risk Assessment

| Risk                                                | Impact   | Mitigation                                                                                      |
| --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Response transport not wired through `/tui/publish` | Blocking | Define events in `TuiEvent` object and regenerate SDK before implementing UI                    |
| Complex TUI state (routing + session switching)     | High     | Handle in session route; cancel dialog on session change, send cancel response                  |
| Hanging tool call on disconnect                     | High     | Use `Instance.state()` disposal callback to reject pending promises (follow Permission pattern) |
| Timeout not implemented                             | Medium   | Use `Promise.race()` with configurable timer; reject with clear timeout error                   |

### Testing Strategy

1. End-to-end: tool call -> `tui.question.request` -> TUI dialog -> `tui.question.response` (success, cancel, timeout).
2. Keyboard navigation parity with existing dialogs.
3. Session switch/close while dialog open cancels cleanly and unblocks the tool.
4. Regression: command autocomplete and submission behavior unchanged.

---

## Issue #134: Granular Agent File Permissions Using Glob

### Status: IMPLEMENTED

### Overview

Add **glob pattern support for agent file _write_ permissions** to allow fine-grained control (e.g., restrict the `plan` agent to only edit `**/*.md`).

**Key repository reality**:

- `permission.bash` is already a _command-pattern_ allow/ask/deny system (not file permissions). It must remain command-based.
- Per-file access control cannot be implemented via “tool gating” because tool enable/disable happens before tool arguments (like `filePath`) exist.

### Source

- **Branch**: [ariane-emory/opencode/feat/glob-permissions](https://github.com/ariane-emory/opencode/tree/feat/glob-permissions)
- **Key Commits**:
  - `f490ca40e` - Initial glob patterns implementation
  - `d7b3d27f6` - Refactor: keep only glob patterns on edit/bash
  - `eb1f6e5da` - Fix: glob-based denials behavior

### Technical Scope

**Estimated Effort**: 6-10 hours

### Design Decision: Union Pattern for `permission.edit` (Consistent with `bash`)

**Key insight**: The codebase already has a pattern for permissions that support both single values AND pattern maps:

```typescript
// packages/opencode/src/config/config.ts:751 - existing bash pattern
bash: z.union([Permission, z.record(z.string(), Permission)]).optional(),
```

**Decision**: Apply the **same union pattern** to `permission.edit` instead of adding new fields:

```typescript
// BEFORE (current)
edit: Permission.optional(),

// AFTER (proposed)
edit: z.union([Permission, z.record(z.string(), Permission)]).optional(),
```

**Why this is better than adding `*_files` fields**:

- Consistent with existing `bash` pattern
- Simpler schema (no new field names to remember)
- Backward compatible (single string value still works)
- Follows established codebase conventions

**Fallback rule** (backwards compatibility):

- If `edit` is a single string (e.g., `"allow"`), apply it to all files (current behavior)
- If `edit` is a pattern map, resolve per-file using glob matching
- `*` pattern acts as the default when no other pattern matches

### Schema & Merge Changes

- `packages/opencode/src/config/config.ts`: change `edit` from `Permission.optional()` to `z.union([Permission, z.record(z.string(), Permission)]).optional()`
- `packages/opencode/src/agent/agent.ts`: update `Agent.Info.permission.edit` to support the union type; update merge logic to handle both string and map formats
- Ensure SDK types regenerate after schema updates

### New Function: `Agent.resolveFilePermission`

Add to `packages/opencode/src/agent/agent.ts`:

```typescript
export function resolveFilePermission(input: {
  // permission value - either a string or a pattern map
  permission: Config.Permission | Record<string, Config.Permission>
  // absolute file path
  filePath: string
  // base directory to match relative paths against (use Instance.directory)
  baseDir: string
}): Config.Permission {
  // 1) If permission is a string, return it directly (backward compatible)
  // 2) Normalize filePath to relative path under baseDir using path.resolve()
  // 3) Convert to POSIX separators for minimatch (replace \\ with /)
  // 4) Evaluate patterns with deterministic precedence
  // 5) Fall back to patterns["*"] then to "allow" (default)
}
```

#### Path Normalization (Critical for Cross-Platform)

1. **Canonicalize path**: Use `path.resolve()` to handle `..` segments
2. **Security boundary first**: Always check `Filesystem.contains(Instance.directory, filePath)` before pattern matching (already done in tools)
3. **Convert to relative**: `path.relative(baseDir, filePath)`
4. **POSIX separators**: Replace `\\` with `/` for minimatch compatibility
5. **Case sensitivity**: Use `minimatch` with `nocase: true` on macOS/Windows

#### Precedence Rules (Deterministic)

The existing `bash` permission uses `Wildcard.allStructured` with head/tail matching. For file globs, use this explicit precedence:

1. **Exact match wins** - `README.md` beats `*.md`
2. **More path segments wins** - `docs/api/*.md` beats `**/*.md`
3. **Longer pattern wins** (among same segment count) - `src/**/*.test.ts` beats `**/*.ts`
4. **Last-defined wins** (if still tied) - order in config object
5. **`*` is always fallback** - only used when no other pattern matches

```typescript
// Example precedence evaluation for file "docs/api/reference.md"
// Patterns: { "docs/api/*.md": "deny", "**/*.md": "allow", "*": "ask" }
// Result: "deny" (more specific path wins)
```

**Dependencies**:

- Use existing `minimatch` dependency (v10.0.3 already in package.json)
- Do NOT use `packages/opencode/src/util/wildcard.ts` (limited, no `**` support)

### Enforcement Location (Critical)

Per-file rules must be enforced **inside tools**, not in `ToolRegistry.enabled`.

### Files to Modify

| File                                     | Changes                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/config/config.ts` | Change `edit` from `Permission.optional()` to `z.union([Permission, z.record(...)])` (lines 748)   |
| `packages/opencode/src/agent/agent.ts`   | Add `resolveFilePermission()`, update merge logic to handle union type (lines 26-32, 52-60)        |
| `packages/opencode/src/tool/edit.ts`     | Call `resolveFilePermission()` before permission check; enforce `deny`/`ask`/`allow` (lines 83-95) |
| `packages/opencode/src/tool/write.ts`    | Call `resolveFilePermission()` before permission check; enforce `deny`/`ask`/`allow` (lines 60-72) |
| `packages/opencode/src/tool/patch.ts`    | Resolve per-file permission per touched file; if any `deny`, reject entire patch (lines 155-166)   |
| `packages/opencode/src/tool/registry.ts` | Add `patch` to denial list when `edit === "deny"` (currently missing - lines 139-142)              |

**Critical fix for registry.ts**: The current code only disables `edit` and `write` when `permission.edit === "deny"`, but `patch` is missing:

```typescript
// packages/opencode/src/tool/registry.ts:139-142 - CURRENT (incomplete)
if (agent.permission.edit === "deny") {
  result["edit"] = false
  result["write"] = false
  // BUG: patch should also be disabled here!
}

// AFTER (fixed)
if (agent.permission.edit === "deny") {
  result["edit"] = false
  result["write"] = false
  result["patch"] = false // Add this line
}
```

### Implementation Phases

#### Phase 1: Schema Updates (~1-2 hours)

- Change `permission.edit` in config schema to union type (matching `bash` pattern)
- Update `Agent.Info.permission.edit` runtime type to match
- Update merge logic to handle:
  - string + string -> string (current behavior)
  - map + map -> merged map
  - string + map -> map (more specific wins)
  - map + string -> map with string as `*` fallback

#### Phase 2: Permission Resolution (~2 hours)

- Implement `resolveFilePermission()` with:
  - Path canonicalization via `path.resolve()`
  - POSIX separator normalization
  - Precedence rules (exact > segments > length > order > `*`)
  - Case-insensitive matching option for macOS/Windows
- Add unit tests covering:
  - Backward compatibility (string value behaves as today)
  - Precedence evaluation with overlapping patterns
  - Cross-platform path handling

#### Phase 3: Tool Integration (~2-4 hours)

- `edit` / `write`:
  - If resolved permission is `deny`, throw a structured rejection (use `Permission.RejectedError` with a clear reason).
  - If `ask`, call `Permission.ask` (include meaningful `pattern` keys so “always” approvals are useful).
- `patch`:
  - If any file is `deny`, reject the entire patch.
  - If any file is `ask`, prompt once with an aggregated pattern list.

#### Phase 4: SDK Types (~30 minutes)

- Regenerate SDK types: `cd packages/sdk/js && bun run script/build.ts`.
- Verify type changes propagate correctly.

### Example Configurations

**Restrict plan agent to markdown files only** (primary use case):

```json
{
  "agent": {
    "plan": {
      "permission": {
        "edit": {
          "**/*.md": "allow",
          "CONTEXT/**": "allow",
          "*": "deny"
        }
      }
    }
  }
}
```

**Backward compatible** (existing configs work unchanged):

```json
{
  "agent": {
    "default": {
      "permission": {
        "edit": "allow"
      }
    }
  }
}
```

**Mixed permissions with ask** (prompt for sensitive files):

```json
{
  "agent": {
    "coder": {
      "permission": {
        "edit": {
          "**/*.lock": "deny",
          "node_modules/**": "deny",
          "**/package.json": "ask",
          "**": "allow"
        }
      }
    }
  }
}
```

### Testing Strategy

1. **Backward compatibility**: Configs with `"edit": "allow"` (string) behave exactly as today
2. **Glob matching**: `**/*.md` matches `README.md`, `docs/guide.md`, `CONTEXT/PLAN.md`
3. **Precedence**: `docs/api/*.md` beats `**/*.md` for `docs/api/reference.md`
4. **Cross-platform**: Paths with backslashes (Windows) match patterns with forward slashes
5. **Tool enforcement**: edit/write/patch correctly deny/ask/allow per file
6. **Registry gating**: `patch` disabled when global `edit === "deny"`

### Risk Assessment

| Risk                                       | Impact | Mitigation                                                                    |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| Breaking existing `permission.bash` rules  | High   | Do not change bash semantics; keep it command-pattern based                   |
| Backwards compatibility regressions        | High   | String value for `edit` behaves exactly as today                              |
| Path mismatch on globs (Windows/CI)        | Medium | Normalize to POSIX separators before minimatch; use `nocase` option           |
| Patch touches mixed files                  | Medium | Define clear aggregation/rejection rules (deny blocks, ask aggregates)        |
| Interaction with `external_directory` perm | Low    | Document: `external_directory` check happens first, glob patterns apply after |

---

## Implementation Timeline

### Recommended Order

1. **Issue #132** (Day 1, ~1 hour)
   - Manual testing only
   - Create test plugin
   - Verify functionality
   - Close issue

2. **Issue #134** (Day 1-2, ~6-10 hours)
   - Lower complexity
   - Independent of #133
   - Enables Plan agent restriction use case

3. **Issue #133** (Day 3-5, ~8-12 hours)
   - Highest complexity
   - Many new components
   - Full TUI integration required

### Gantt Chart

```
Day 1:  [=== #132 Test ===][======== #134 Phase 1-2 ========]
Day 2:  [======== #134 Phase 3-4 ========][== Test ==]
Day 3:  [=============== #133 Phase 1-2 ===============]
Day 4:  [=============== #133 Phase 3 =================]
Day 5:  [========= #133 Phase 4 =========][== Test ==]
```

---

## Acceptance Criteria Summary

### Issue #132: Plugin Commands

- [x] Plugin commands appear in `/` autocomplete
- [x] `sessionOnly` commands hidden without active session
- [x] Command aliases resolve correctly
- [x] Plugin command execution works with error handling

### Issue #133: Ask TUI Tool

- [x] Ask tool registered and callable by agent
- [x] Events added to `TuiEvent` object (not just type definitions)
- [x] TUI receives `tui.question.request` over SSE and responds via `sdk.client.tui.publish(...)`
- [x] Select dialog displays and returns selection
- [x] MultiSelect dialog created and working (new component)
- [x] Confirm dialog displays and returns boolean
- [x] Text dialog displays and returns string
- [ ] Comments can be added to answers (TODO: Add comment input to dialog)
- [x] Instance disposal rejects pending questions via `Instance.state()` cleanup
- [x] Session switch/close sends cancel response and clears dialog
- [x] Timeout implemented via `Promise.race()` with configurable duration
- [x] SDK regenerated so new TUI event types are available

### Issue #134: Glob Permissions

- [x] `permission.edit` supports union type: `Permission | Record<string, Permission>`
- [x] Schema follows same pattern as existing `permission.bash`
- [x] `Agent.resolveFilePermission()` correctly matches patterns with deterministic precedence
- [x] Precedence rules: exact > segments > length > order > `*` fallback
- [x] Path normalization: canonicalized, POSIX separators, case-insensitive option
- [x] Edit/Write/Patch tools enforce allow/ask/deny per file (deny blocks, ask prompts)
- [x] `patch` added to registry denial list when `edit === "deny"`
- [x] Backward compatible: `"edit": "allow"` (string) behaves exactly as today
- [x] `permission.bash` behavior remains command-pattern based (unchanged)
- [x] Plan agent can be restricted to `.md` files only

---

## References

### Upstream PRs

- Plugin Commands: [sst/opencode#4411](https://github.com/sst/opencode/pull/4411)
- Ask TUI Tool: [sst/opencode#5563](https://github.com/sst/opencode/pull/5563)

### External Branches

- Glob Permissions: [ariane-emory/opencode/feat/glob-permissions](https://github.com/ariane-emory/opencode/tree/feat/glob-permissions)

### Get PR Diffs

```bash
# Plugin Commands
gh pr diff 4411 --repo sst/opencode

# Ask TUI Tool
gh pr diff 5563 --repo sst/opencode
```

---

## Plan Review Status

**Reviewed**: 2025-12-15  
**Reviewer**: Automated plan review

### Issue #132: Plugin Commands

**Status**: READY TO IMPLEMENT (testing only)

All implementation claims verified against codebase:

- `packages/plugin/src/index.ts:198-208` - Hook interface confirmed
- `packages/opencode/src/command/index.ts:32-33,73-87,92-99` - Schema and loading confirmed
- `packages/opencode/src/session/prompt.ts:1237-1280` - Execution confirmed
- `packages/sdk/js/src/v2/gen/types.gen.ts:1630-1631` - SDK types confirmed

### Issue #133: Ask TUI Tool

**Status**: READY TO IMPLEMENT

Plan updated with:

- Clarified abort/cleanup handling using `Instance.state()` disposal pattern
- Fixed file table (moved `dialog-multiselect.tsx` to "Files to Create")
- Added `TuiEvent` integration requirements (must add to object, not just types)
- Specified timeout implementation via `Promise.race()`

### Issue #134: Glob Permissions

**Status**: READY TO IMPLEMENT

Plan revised with:

- Changed from `*_files` fields to union pattern (consistent with `bash`)
- Added `patch` to registry denial list
- Specified precise precedence rules (exact > segments > length > order > `*`)
- Added path normalization details (canonicalize, POSIX separators, case-insensitive)
- Updated example configurations to use new schema

### Codebase Alignment Verified

| Component                | File Location                                      | Status   |
| ------------------------ | -------------------------------------------------- | -------- |
| Permission pattern       | `packages/opencode/src/config/config.ts:747-755`   | Analyzed |
| Agent merge logic        | `packages/opencode/src/agent/agent.ts:52-60`       | Analyzed |
| Tool permission checks   | `packages/opencode/src/tool/{edit,write,patch}.ts` | Analyzed |
| Registry gating          | `packages/opencode/src/tool/registry.ts:136-153`   | Analyzed |
| TUI event system         | `packages/opencode/src/cli/cmd/tui/event.ts`       | Analyzed |
| Permission.ask() pattern | `packages/opencode/src/permission/index.ts`        | Analyzed |
| minimatch dependency     | `package.json:93` (v10.0.3)                        | Verified |
