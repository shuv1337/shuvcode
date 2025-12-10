# Plan: Restore Subagent Sidebar Navigation Feature (PR #4865)

**Date:** 2025-12-09  
**Related PR:** https://github.com/sst/opencode/pull/4865  
**Status:** IMPLEMENTED - Fix completed 2025-12-10

## Overview

This plan documents the restoration of the "Subagents Sidebar with Clickable Navigation" feature that was originally added in PR #4865. The feature provides:

- Sidebar display of active and past subagents grouped by type
- Click navigation to subagent sessions
- `<leader>+Up` keybind to return to parent session
- Collapsible subagents section

## Current State Analysis

### What's Working

| Component                      | File          | Status    |
| ------------------------------ | ------------- | --------- |
| Subagent grouping              | `sidebar.tsx` | **WORKS** |
| ASCII spinners                 | `sidebar.tsx` | **WORKS** |
| Active/error status display    | `sidebar.tsx` | **WORKS** |
| Expand/collapse UI             | `sidebar.tsx` | **WORKS** |
| "Go to parent session" command | `index.tsx`   | **WORKS** |
| `session_parent` keybind       | `config.ts`   | **WORKS** |
| Header "Parent" indicator      | `header.tsx`  | **WORKS** |
| Child session cycling          | `index.tsx`   | **WORKS** |

### What's Broken

| Component                    | File                  | Status                             |
| ---------------------------- | --------------------- | ---------------------------------- |
| Click navigation to subagent | `sidebar.tsx:244-252` | **BROKEN** - uses wrong session ID |

## Root Cause Analysis

The bug is in `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` at lines 244-252:

```typescript
const sessionId = part.sessionID  // BUG: This is the PARENT session ID!
return (
  <box
    // ...
    onMouseDown={() => {
      route.navigate({ type: "session", sessionID: sessionId })
    }}
  >
```

**The Problem**: `part.sessionID` refers to the session that _contains_ the tool part (the parent session), NOT the subagent session that was created by the task tool.

**The Solution**: The subagent's session ID is stored in the tool's **metadata**:

From `packages/opencode/src/tool/task.ts`:

```typescript
// Line 49-54: During execution
ctx.metadata({
  title: params.description,
  metadata: {
    sessionId: session.id, // <-- This is the subagent session ID
  },
})

// Line 127-132: In final output
return {
  title: params.description,
  metadata: {
    summary,
    sessionId: session.id, // <-- Also here
  },
  output,
}
```

## Implementation Tasks

### Phase 1: Fix Click Navigation

- [x] Update `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` lines 244-252
- [x] Extract `sessionId` from part metadata instead of `part.sessionID`:
  ```typescript
  const metadata =
    part.state.status === "completed"
      ? part.state.metadata
      : ((part.state as { metadata?: Record<string, unknown> }).metadata ?? {})
  const subagentSessionId = (metadata?.sessionId as string) ?? undefined
  ```
- [x] Update click handler to use the correct session ID:
  ```typescript
  onMouseDown={() => {
    if (subagentSessionId) {
      route.navigate({ type: "session", sessionID: subagentSessionId })
    }
  }}
  ```
- [x] Add visual feedback when subagent session ID is not available (e.g., disabled state or tooltip)

### Phase 2: (Optional) Improve Error Handling

- [x] Handle case where subagent session ID is missing (task still running, metadata not yet populated)
- [ ] Consider showing cursor style change on hover to indicate clickability
- [ ] Add console warning if session navigation fails

## Code References

### Internal Files

- `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:244-252` - **BUG LOCATION**
- `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:40-48` - taskToolParts extraction
- `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:50-60` - subagentGroups memo
- `packages/opencode/src/tool/task.ts:49-54` - metadata with sessionId during execution
- `packages/opencode/src/tool/task.ts:127-132` - metadata with sessionId in return

### External References

- Original PR: https://github.com/sst/opencode/pull/4865

## Detailed Code Change

### Current Code (Broken)

```typescript
// sidebar.tsx lines 238-261
<For each={parts}>
  {(part) => {
    const isActive = () => part.state.status === "running" || part.state.status === "pending"
    const isError = () => part.state.status === "error"
    const input = part.state.input as Record<string, unknown>
    const description = (input?.description as string) ?? ""
    const sessionId = part.sessionID  // WRONG: This is the parent session ID
    return (
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={2}
        onMouseDown={() => {
          route.navigate({ type: "session", sessionID: sessionId })
        }}
      >
        {/* ... */}
      </box>
    )
  }}
</For>
```

### Fixed Code

```typescript
// sidebar.tsx lines 238-261
<For each={parts}>
  {(part) => {
    const isActive = () => part.state.status === "running" || part.state.status === "pending"
    const isError = () => part.state.status === "error"
    const input = part.state.input as Record<string, unknown>
    const description = (input?.description as string) ?? ""

    // Get subagent session ID from metadata, not part.sessionID
    const metadata = part.state.status === "completed"
      ? part.state.metadata
      : (part.state as { metadata?: Record<string, unknown> }).metadata ?? {}
    const subagentSessionId = (metadata?.sessionId as string) ?? undefined

    return (
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={2}
        onMouseDown={() => {
          if (subagentSessionId) {
            route.navigate({ type: "session", sessionID: subagentSessionId })
          }
        }}
      >
        {/* ... */}
      </box>
    )
  }}
</For>
```

## Estimated Changes

| File          | Lines Added | Lines Modified |
| ------------- | ----------- | -------------- |
| `sidebar.tsx` | 5           | 3              |
| **Total**     | 5           | 3              |

## Validation Criteria

- [x] Subagents appear in sidebar grouped by type (already works)
- [x] ASCII spinners animate for active tasks (already works)
- [x] Clicking on a completed subagent navigates to the subagent's session
- [x] Clicking on a running subagent navigates to the subagent's session (if metadata is available)
- [x] `<leader>+Up` returns to parent session from subagent view (already works)
- [x] Child session cycling with `<leader>+Left/Right` works (already works)
- [x] Header shows "Parent" indicator when viewing subagent (already works)

## Dependencies

None - this is a simple bug fix.

## Risks & Considerations

1. **Timing Issue**: For tasks that are still running, the metadata may not be populated yet. The `ctx.metadata()` call happens early in task execution (line 49-54 in task.ts), so this should be available even for running tasks.

2. **Type Safety**: The metadata extraction requires type casting. Consider adding proper type definitions if this pattern is used elsewhere.

3. **Backward Compatibility**: Old sessions created before the metadata field was added may not have `sessionId` in metadata. Handle this gracefully by doing nothing on click.
