# Plan: Fix Duplicate /new Slash Command Entry Causing Crash on PWA

**Issue:** [#192](https://github.com/Latitudes-Dev/shuvcode/issues/192)  
**Date:** 2025-12-22  
**Type:** Bug Fix  
**Priority:** High

## Summary

In the desktop app PWA layout, the `/` slash command list shows a duplicate entry for `/new`. Selecting either entry causes the application to crash. This is caused by command registration timing issues when components remount, combined with missing deduplication logic in the command options and slash command list generation.

## Root Cause Analysis

### The Registration Race Condition

1. **Keyed Show causes remounts**: In `packages/desktop/src/app.tsx`, the `<Show when={p.params.id || true} keyed>` pattern causes the entire `<Session />` component tree to be unmounted and remounted whenever `params.id` changes
2. **Commands registered in Session component**: The `/new` command is registered via `command.register()` inside the `Session` component
3. **New registration before old cleanup**: When navigating between sessions, the new `Session` component may call `register()` before the old component's `onCleanup()` fires
4. **No deduplication**: Neither `command.tsx` nor `prompt-input.tsx` deduplicate commands by ID

### Code Evidence

**Keyed Show Pattern (`packages/desktop/src/app.tsx:93-102`):**

```tsx
<Route
  path="/session/:id?"
  component={(p) => (
    <Show when={p.params.id || true} keyed>
      {" "}
      {/* <-- keyed causes remount */}
      <TerminalProvider>
        <PromptProvider>
          <Session />
        </PromptProvider>
      </TerminalProvider>
    </Show>
  )}
/>
```

**Command Registration (`session.tsx:222-231`):**

```tsx
command.register(() => [
  {
    id: "session.new",
    title: "New session",
    description: "Create a new session",
    category: "Session",
    keybind: "mod+shift+s",
    slash: "new", // <-- This appears twice
    onSelect: () => navigate(`/${params.dir}/session`),
  },
  // ...
])
```

**Options Memo - No Deduplication (`command.tsx:160-171`):**

```typescript
const options = createMemo(() => {
  const all = registrations().flatMap((x) => x()) // <-- Duplicates not filtered
  const suggested = all.filter((x) => x.suggested && !x.disabled)
  return [
    ...suggested.map((x) => ({
      ...x,
      id: "suggested." + x.id,
      category: "Suggested",
    })),
    ...all,
  ]
})
```

**Slash Commands - No Deduplication (`prompt-input.tsx:299-320`):**

```typescript
const slashCommands = createMemo<SlashCommand[]>(() => {
  const builtin = command.options
    .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
    .map((opt) => ({
      id: opt.id,
      trigger: opt.slash!,
      title: opt.title,
      description: opt.description,
      keybind: opt.keybind,
      type: "builtin" as const,
    }))

  const custom = sync.data.command.map((cmd) => ({
    id: `custom.${cmd.name}`,
    trigger: cmd.name,
    title: cmd.name,
    description: cmd.description,
    type: "custom" as const,
  }))

  return [...custom, ...builtin] // <-- No deduplication!
})
```

### Why the Crash Occurs

When selecting a duplicate command entry:

1. `handleSlashSelect` calls `command.trigger(cmd.id, "slash")`
2. The command system may find multiple matching handlers
3. The stale handler may reference unmounted component state
4. DOM manipulation or navigation on stale refs causes crash

### Plan Review Notes (Repo Alignment)

- `command.trigger` returns on the first matching ID; duplicates are more likely to cause UX confusion than a crash. Capture the actual error stack to confirm the failure mode.
- The slash list uses `useFilteredList` keyed by `id`; duplicate IDs can destabilize list state. Deduplicating at the command options layer should eliminate most duplicates.
- Also consider collisions by `trigger` (e.g., custom `/new` vs built-in `/new`) since IDs differ but the UI presents only the trigger.
- If adding defensive error handling, place it in `command.trigger` so palette/keybind/slash share the same guard.

## Technical Specifications

### Affected Files

| File                                               | Lines   | Issue                                       |
| -------------------------------------------------- | ------- | ------------------------------------------- |
| `packages/desktop/src/app.tsx`                     | 93-104  | `keyed` Show causes unnecessary remounts    |
| `packages/desktop/src/pages/session.tsx`           | 222-231 | Commands registered in remounting component |
| `packages/desktop/src/context/command.tsx`         | 160-171 | `options` memo doesn't deduplicate by ID    |
| `packages/desktop/src/components/prompt-input.tsx` | 299-320 | `slashCommands` memo doesn't deduplicate    |

### Command Registration/Deregistration Flow

```typescript
// packages/desktop/src/context/command.tsx:212-218
return {
  register(cb: () => CommandOption[]) {
    const results = createMemo(cb)
    setRegistrations((arr) => [results, ...arr])
    onCleanup(() => {
      setRegistrations((arr) => arr.filter((x) => x !== results))
    })
  },
}
```

**Issue:** New component's `register()` can execute before old component's `onCleanup()`.

## Implementation Options

### Option A: Add Deduplication in Command Options Memo (Recommended)

**Location:** `packages/desktop/src/context/command.tsx`  
**Approach:** Deduplicate by `id` when building the options array

```typescript
const options = createMemo(() => {
  const all = registrations().flatMap((x) => x())

  // Deduplicate by id (keep last registered, which is first in array due to prepend)
  const seen = new Set<string>()
  const unique = all.filter((x) => {
    if (seen.has(x.id)) return false
    seen.add(x.id)
    return true
  })

  const suggested = unique.filter((x) => x.suggested && !x.disabled)
  return [
    ...suggested.map((x) => ({
      ...x,
      id: "suggested." + x.id,
      category: "Suggested",
    })),
    ...unique,
  ]
})
```

### Option B: Add Deduplication in Slash Commands Memo

**Location:** `packages/desktop/src/components/prompt-input.tsx`  
**Approach:** Deduplicate by `trigger` (user-visible) with a clear precedence rule

```typescript
const slashCommands = createMemo<SlashCommand[]>(() => {
  const builtin = command.options
    .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
    .map((opt) => ({
      id: opt.id,
      trigger: opt.slash!,
      title: opt.title,
      description: opt.description,
      keybind: opt.keybind,
      type: "builtin" as const,
    }))

  const custom = sync.data.command.map((cmd) => ({
    id: `custom.${cmd.name}`,
    trigger: cmd.name,
    title: cmd.name,
    description: cmd.description,
    type: "custom" as const,
  }))

  // Deduplicate by trigger (custom wins due to order)
  const all = [...custom, ...builtin]
  const seen = new Set<string>()
  return all.filter((cmd) => {
    if (seen.has(cmd.trigger)) return false
    seen.add(cmd.trigger)
    return true
  })
})
```

### Option C: Fix the Keyed Show Pattern

**Location:** `packages/desktop/src/app.tsx`  
**Approach:** Remove `keyed` or restructure to avoid unnecessary remounts

```tsx
// Before
<Show when={p.params.id || true} keyed>
  <Session />
</Show>

// After - Option 1: Remove keyed
<Show when={p.params.id || true}>
  <Session />
</Show>

// After - Option 2: Always render (no Show)
<TerminalProvider>
  <PromptProvider>
    <Session />
  </PromptProvider>
</TerminalProvider>
```

**Caution:** This may change state persistence behavior between sessions.

### Option D: Move Command Registration to Non-Remounting Component

**Location:** Create separate component or move to `app.tsx`  
**Approach:** Register session commands at app level, pass session ID as reactive prop

### Recommended Approach: Option A + Option B (Defense in Depth)

Implement deduplication at both the command system level AND the slash command list level for robust protection.

## Implementation Tasks

### Phase 0: Confirm Crash Stack (Required)

- [ ] **Reproduce crash and capture stack trace**
  - Steps: Navigate between sessions until duplicate `/new` appears, then select it
  - Validation: Stack trace confirms whether the crash originates in `command.trigger`, a handler, or list state

### Phase 1: Add Deduplication (Required)

- [x] **Add deduplication in command options memo**
  - File: `packages/desktop/src/context/command.tsx`
  - Line: ~160
  - Change: Filter duplicates by `id` before creating options array
  - Validation: `command.options` contains unique IDs
  - Note: Already implemented - deduplication by `id` at lines 162-167

- [x] **Add deduplication in slashCommands memo**
  - File: `packages/desktop/src/components/prompt-input.tsx`
  - Line: ~299
  - Change: Deduplicate combined array by `trigger` before returning
  - Validation: Slash command popover shows unique entries
  - Note: Already implemented - deduplication by `trigger` at lines 319-325

### Phase 2: Add Defensive Checks

- [x] **Add error handling in handleSlashSelect**
  - File: `packages/desktop/src/components/prompt-input.tsx`
  - Function: `handleSlashSelect`
  - Change: Wrap command trigger in try-catch, handle stale refs gracefully
  - Validation: Selecting command doesn't crash even if handler is stale

### Phase 3: Testing

- [ ] **Test slash command list on PWA**
  - Steps:
    1. Install PWA from desktop app
    2. Open a session
    3. Type `/` to open slash command list
    4. Count `/new` entries
  - Expected: Exactly one `/new` entry

- [ ] **Test selecting /new command**
  - Steps:
    1. Type `/new` or select from list
    2. Press Enter
  - Expected: New session created without crash

- [ ] **Test navigation between sessions**
  - Steps:
    1. Open session A
    2. Navigate to session B
    3. Type `/` to open slash command list
  - Expected: No duplicate commands

- [ ] **Test all slash commands (regression)**
  - Steps:
    1. Test `/new`, `/open`, `/model`, `/share`, `/rename` etc.
  - Expected: All commands work correctly

### Phase 4: Optional Improvements

- [ ] **Consider removing keyed Show**
  - File: `packages/desktop/src/app.tsx`
  - Line: 96
  - Change: Remove `keyed` prop or restructure
  - Caution: Test state persistence behavior thoroughly

## Validation Criteria

| Criterion                              | Validation Method                     |
| -------------------------------------- | ------------------------------------- |
| Single `/new` entry in slash list      | Visual inspection of popover          |
| Selecting `/new` creates session       | Manual test on PWA                    |
| No duplicate commands after navigation | Navigate between sessions, check list |
| Other slash commands work              | Test each slash command               |
| No TypeScript errors                   | `bun run typecheck`                   |

## Code References

### Internal Files

- `packages/desktop/src/app.tsx:93-104` - Keyed Show pattern
- `packages/desktop/src/pages/session.tsx:222-231` - Command registration
- `packages/desktop/src/context/command.tsx:160-171` - Options memo
- `packages/desktop/src/context/command.tsx:212-218` - Register/cleanup
- `packages/desktop/src/components/prompt-input.tsx:299-320` - Slash command list
- `packages/ui/src/hooks/use-filtered-list.tsx` - List filtering (no dedup)

### Utility Pattern for Deduplication

```typescript
// Simple deduplication helper
function uniqueBy<T>(array: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return array.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// Usage
const unique = uniqueBy(all, (x) => x.id)
```

## Notes

- The issue is more likely to manifest on PWA due to different lifecycle/timing compared to desktop app
- The `keyed` Show pattern is intentional for resetting state between sessions, but creates this side effect
- Deduplication is the safest fix as it doesn't change component lifecycle behavior
