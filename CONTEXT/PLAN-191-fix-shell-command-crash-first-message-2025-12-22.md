# Plan: Fix Desktop App Crash When Running Shell Command as First Message

**Issue:** [#191](https://github.com/Latitudes-Dev/shuvcode/issues/191)  
**Date:** 2025-12-22  
**Type:** Bug Fix  
**Priority:** High

## Summary

The desktop app crashes when a user runs a shell command (prefixed with `!`) as the very first message in a new session. The shell command executes successfully (results are visible after reloading), but the UI crashes due to a race condition between fire-and-forget shell submission and reactive rendering of undefined message parts.

## Root Cause Analysis

### The Race Condition Flow

1. **Shell commands are fire-and-forget**: In `prompt-input.tsx`, `sdk.client.session.shell()` is called without `await` and **no optimistic message is added**
2. **Navigation triggers sync immediately**: After session creation, navigation triggers a session sync via `createEffect` in `session.tsx`
3. **Sync returns empty messages**: If sync runs before the server processes the shell command, it returns no messages
4. **Part component crashes on undefined**: `SessionTurn` renders `<Part part={assistantParts()[0]} ... />` where `assistantParts()[0]` is `undefined`, causing `props.part.type` access to crash

### Why Regular Messages Don't Crash

Regular prompts use `sync.session.addOptimisticMessage()` to add a local message immediately, preventing the empty state. Shell commands skip this step entirely.

### Code Flow Comparison

**Regular Prompt (works):**

```typescript
// packages/desktop/src/components/prompt-input.tsx:807-834
const messageID = Identifier.ascending("message")
sync.session.addOptimisticMessage({  // <-- Adds optimistic message
  sessionID: existing.id,
  messageID,
  parts: optimisticParts,
  agent,
  model,
})
sdk.client.session.prompt({...})
```

**Shell Command (crashes):**

```typescript
// packages/desktop/src/components/prompt-input.tsx:781-788
if (isShellMode) {
  sdk.client.session.shell({
    // <-- No optimistic message!
    sessionID: existing.id,
    agent,
    model,
    command: text,
  })
  return
}
```

## Technical Specifications

### Affected Files

| File                                               | Lines   | Issue                                                   |
| -------------------------------------------------- | ------- | ------------------------------------------------------- |
| `packages/desktop/src/components/prompt-input.tsx` | 781-788 | Shell command sent without await, no optimistic message |
| `packages/ui/src/components/session-turn.tsx`      | 427-428 | Accesses `assistantParts()[0]` without null check       |
| `packages/ui/src/components/message-part.tsx`      | 313-314 | Accesses `props.part.type` without guard                |

### Crash Location

```typescript
// packages/ui/src/components/session-turn.tsx:427-428
<Match when={isShellMode()}>
  <Part part={assistantParts()[0]} message={msg()} defaultOpen />  // CRASH: part is undefined
</Match>
```

```typescript
// packages/ui/src/components/message-part.tsx:313-314
export function Part(props: MessagePartProps) {
  const component = createMemo(() => PART_MAPPING[props.part.type]) // CRASH: props.part is undefined
  // ...
}
```

### isShellMode Detection Logic

```typescript
// packages/ui/src/components/session-turn.tsx:129-135
let isShellMode = false
if (parts.every((p) => p?.type === "text" && p?.synthetic) && assistantParts.length === 1) {
  const assistantPart = assistantParts[0]
  if (assistantPart?.type === "tool" && assistantPart?.tool === "bash") {
    isShellMode = true
  }
}
```

## Implementation Options

### Option 1: Add Null Guard in Part Component (Quick Fix)

**Pros:** Simple, defensive, prevents crash in any scenario  
**Cons:** Doesn't fix the UX issue (no loading indicator)

```typescript
// packages/ui/src/components/message-part.tsx:313
export function Part(props: MessagePartProps) {
  if (!props.part) return null // Add guard
  const component = createMemo(() => PART_MAPPING[props.part.type])
  // ...
}
```

### Option 2: Add Conditional Rendering in SessionTurn (Defensive)

**Pros:** Prevents crash specifically in shell mode  
**Cons:** Still no UX feedback during loading

```typescript
// packages/ui/src/components/session-turn.tsx:427
<Match when={isShellMode() && assistantParts()[0]}>
  <Part part={assistantParts()[0]!} message={msg()} defaultOpen />
</Match>
```

### Option 3: Add Optimistic Message for Shell Commands (Comprehensive)

**Pros:** Best UX with immediate feedback, consistent with regular prompts  
**Cons:** More code changes, must match existing message/part schema (no new part types)

```typescript
// packages/desktop/src/components/prompt-input.tsx:781
if (isShellMode) {
  const messageID = Identifier.ascending("message")
  sync.session.addOptimisticMessage({
    sessionID: existing.id,
    messageID,
    parts: [
      {
        id: Identifier.ascending("part"),
        type: "text",
        text,
        synthetic: true,
        sessionID: existing.id,
        messageID,
      },
    ],
    agent,
    model,
  })
  sdk.client.session.shell({ ... })
  return
}
```

**Note:** Validate the actual shell command payloads first (shell responses appear as tool parts with `tool: "bash"` in `SessionTurn`).

### Recommended Approach: Verify Crash Path + Option 1 (Guard) + Targeted Fix

- Confirm the stack trace aligns with `Part` receiving `undefined`; the current `isShellMode` gating only renders the shell `Part` when an assistant tool part exists.
- Add the `Part` guard as a safety net.
- If the crash persists, add a targeted guard in `SessionTurn` and/or ensure part arrays never contain `undefined`.
- Option 3 can be added later as a UX enhancement once the shell payload shape is confirmed.

## Implementation Tasks

### Phase 0: Confirm Crash Stack (Required)

- [ ] **Reproduce and capture stack trace**
  - Steps: New session → send `!ls` as first message
  - Validation: Stack trace points to the failing component and part payload shape

- [ ] **Confirm part arrays are non-empty/defined**
  - Inspect `data.store.part` for the user message and assistant tool response
  - Validation: Identify whether `undefined` parts exist or if a different component is failing

### Phase 1: Crash Prevention (Required)

- [ ] **Add null guard in Part component**
  - File: `packages/ui/src/components/message-part.tsx`
  - Line: 313
  - Change: Add `if (!props.part) return null` at start of function
  - Validation: Component returns null instead of crashing on undefined

- [ ] **Add conditional rendering in SessionTurn shell mode**
  - File: `packages/ui/src/components/session-turn.tsx`
  - Line: 427
  - Change: Add `&& assistantParts()[0]` to the `when` condition
  - Validation: Shell mode match only renders when part exists

### Phase 2: Testing

- [ ] **Test shell command as first message in new session**
  - Steps:
    1. Create a new session
    2. Type `!ls` or any shell command as first message
    3. Press Enter
  - Expected: Command executes without crash, results display after completion

- [ ] **Test regular shell commands (regression)**
  - Steps:
    1. Open existing session with messages
    2. Run shell command with `!` prefix
  - Expected: Command executes normally, results display

- [ ] **Test regular prompts (regression)**
  - Steps:
    1. Create new session
    2. Send regular text message
  - Expected: Message displays immediately, response follows

### Phase 3: UX Enhancement (Optional)

- [ ] **Add optimistic message for shell commands**
  - File: `packages/desktop/src/components/prompt-input.tsx`
  - Lines: 781-788
  - Change: Add optimistic message before calling shell API
  - Validation: Loading state appears immediately after submission

## Validation Criteria

| Criterion                                  | Validation Method                       |
| ------------------------------------------ | --------------------------------------- |
| No crash on shell command as first message | Manual test: new session + `!ls`        |
| Shell command results display correctly    | Visual inspection of command output     |
| Regular prompts work unchanged             | Manual test: new session + text message |
| Existing shell commands work               | Manual test: existing session + `!ls`   |
| No TypeScript errors                       | `bun run typecheck`                     |

## Code References

### Internal Files

- `packages/desktop/src/components/prompt-input.tsx:781-788` - Shell command submission
- `packages/ui/src/components/session-turn.tsx:427-428` - Shell mode rendering
- `packages/ui/src/components/message-part.tsx:313-314` - Part component
- `packages/ui/src/components/session-turn.tsx:129-135` - isShellMode detection

### Existing Defensive Patterns

Safe array access patterns already used in codebase:

```typescript
// session-turn.tsx:82
const lastUserMessage = userMessages.at(-1)

// session-turn.tsx:121-122
if (assistantParts[i]?.type === "text") { ... }
```

## Notes

- The TUI also doesn't add optimistic messages for shell commands but may not trigger the same race condition due to different rendering approach
- The `isShellMode` detection requires exactly 1 assistant tool part; if assistant parts are empty, shell mode won't render, so confirm the crash stack actually hits `Part` with an undefined input before implementing a fix.
