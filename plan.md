# Fork Feature Restoration Plan - v1.1.41 Sync Fixes

## Overview

During the v1.1.41 upstream merge, several fork features were lost due to incorrect rerere auto-resolution. This plan documents the fixes needed and provides implementation details for another agent.

## Issues to Fix

### 1. CRITICAL: Restore Shuvcode ASCII Logo on Home Screen

**Problem:** The logo.tsx component was updated by upstream to import from `@/cli/logo.ts` which contains "open code" ASCII art instead of "shuvcode".

**Current State:**

- `packages/opencode/src/cli/logo.ts` contains upstream's "open code" logo
- `packages/opencode/src/cli/cmd/tui/component/logo.tsx` imports from `@/cli/logo`
- Home screen shows "open code" instead of "shuvcode"

**Pre-merge State (96e1a43c6):**

- `logo.tsx` had inline "shuvcode" ASCII art:

```tsx
const LOGO_LEFT = [`     ▄             `, `█▀▀▀ █▀▀█ █  █ █  █`, `▀▀▀█ █░░█ █░░█ █░░█`, `▀▀▀▀ ▀  ▀ ▀▀▀▀  ▀▀ `]
const LOGO_RIGHT = [`             ▄     `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]
```

**Fix Required:**
Update `packages/opencode/src/cli/logo.ts` to contain shuvcode logo:

```typescript
export const logo = {
  left: [`     ▄             `, `█▀▀▀ █▀▀█ █  █ █  █`, `▀▀▀█ █░░█ █░░█ █░░█`, `▀▀▀▀ ▀  ▀ ▀▀▀▀  ▀▀ `],
  right: [`             ▄     `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`],
}

export const marks = "_^~"
```

Note: The upstream version uses shadow markers (`_^~`) for visual effects. If these don't render correctly with the shuvcode logo, we may need to use the simpler version without markers (replacing `_` with space, removing `^` and `~`).

**Files to modify:**

- `packages/opencode/src/cli/logo.ts`

---

### 2. Restore ANSI Bash Output Rendering with ghostty-opentui (PR #4791)

**Problem:** ANSI output is not rendered in the TUI because the Bash tool output is stripped of ANSI codes before display.

**Current State:**

- `ghostty-opentui` dependency exists and `ptyToText` is used in `packages/opencode/src/tool/bash.ts` ✓
- Build step installs native bindings in `packages/opencode/script/build.ts` ✓
- TUI renders bash output as plain text with `stripAnsi` in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`, so colors are removed

**Fix Required:**
Implement ANSI-aware rendering for bash tool output in the TUI using `ghostty-opentui` (as in the prior fork behavior) instead of stripping ANSI.

**Implementation Notes:**

1. Replace `stripAnsi` usage in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (Bash tool block) with a `ghostty-opentui` render path (e.g., GhosttyTerminalRenderable) that parses ANSI/VT sequences.
2. Preserve colors/styles in the TUI while keeping the existing expanded/collapsed view behavior.
3. Keep a safe fallback for non-ANSI output (render plain text when no ANSI sequences are present).
4. Ensure copy-to-clipboard and transcript export remain readable (plain text is fine).

**Verification Steps:**

1. Confirm `packages/opencode/script/build.ts` still installs ghostty-opentui
2. Run a bash tool command that emits ANSI (e.g., `ls --color=always` or `printf '\\x1b[31mred\\x1b[0m'`)
3. Verify colors render in the TUI without being stripped

**Files to check:**

- `packages/opencode/script/build.ts`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/opencode/src/tool/bash.ts`

---

### 3. Verify Spinner Customization

**Problem:** Spinner customization should work via command palette.

**Current State:**

- Spinner utility exists at `packages/opencode/src/cli/cmd/tui/util/spinners.ts` ✓
- Dialog components exist at `packages/opencode/src/cli/cmd/tui/component/dialog-spinner.tsx` ✓
- Command palette integration in `app.tsx` exists ✓
- Sidebar uses `getSpinnerFrame()` ✓

**Verification:**
The spinner feature appears intact. Verify by:

1. Running shuvcode TUI
2. Opening command palette (Ctrl+X Ctrl+X)
3. Searching for "spinner" - should see "Change spinner style" and "Change spinner speed"

---

### 4. Add Regression Test for Double Ctrl+C

**Problem:** The double Ctrl+C feature exists but needs a regression test to prevent regressions.

**Implementation Required:**
Avoid testing Solid `.tsx` directly. Extract the exit timing logic into a small `.ts` helper and test that helper.

Suggested structure:

1. Add helper `packages/opencode/src/cli/cmd/tui/component/prompt/exit.ts` that encapsulates:
   - last attempt timestamp tracking
   - 2 second window logic
   - return value indicating whether to exit or show toast
2. Update `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` to use the helper.
3. Create test at `packages/opencode/test/cli/tui/double-ctrl-c.test.ts` that verifies:
   - first call returns "warn"
   - second call within 2 seconds returns "exit"
   - calls after 2 seconds reset behavior

**Files to modify/create:**

- `packages/opencode/src/cli/cmd/tui/component/prompt/exit.ts`
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- `packages/opencode/test/cli/tui/double-ctrl-c.test.ts`

---

### 5. Remove legacy AskQuestion tool (fork)

**Problem:** The fork still contains a legacy AskQuestion tool, but we should rely exclusively on the upstream-native `question` tool.

**Fix Required:**
Remove legacy AskQuestion code and any remaining references.

**Files to remove/modify:**

- `packages/opencode/src/askquestion/index.ts`
- `packages/opencode/src/tool/askquestion.ts`
- `packages/opencode/src/tool/askquestion.txt`
- `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx`
- `packages/opencode/src/session/index.ts` (remove AskQuestion import + cleanup call)
- `packages/app/src/components/askquestion-wizard.tsx`

---

### 6. Update fork-features.json

**Changes Required:**

#### 6.1 Remove entries for features no longer maintained

- Remove AskQuestion tool entry (PR #5958) - fork should use upstream native `question` tool only
- Keep Search in messages entry (PR #4898) if code still exists

#### 5.2 Enhance Double Ctrl+C entry with criticalCode markers:

```json
{
  "pr": 4900,
  "title": "Double Ctrl+C to exit",
  "author": "AmineGuitouni",
  "status": "open",
  "description": "Require double Ctrl+C within 2 seconds to prevent accidental exits",
  "files": ["packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx"],
  "criticalCode": [
    {
      "file": "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
      "description": "Exit attempt tracking and tryExit function",
      "markers": ["let lastExitAttempt = 0", "async function tryExit()", "now - lastExitAttempt < 2000"]
    },
    {
      "file": "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
      "description": "Toast warning on first Ctrl+C",
      "markers": ["message: \"Press again to exit\"", "duration: 2000"]
    },
    {
      "file": "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
      "description": "Keybind handler calls tryExit instead of exit",
      "markers": ["await tryExit()", "keybind.match(\"app_exit\""]
    }
  ],
  "testFile": "packages/opencode/test/tui/double-ctrl-c.test.ts"
}
```

#### 5.3 Add/update shuvcode logo entry:

```json
{
  "pr": 0,
  "title": "Shuvcode ASCII logo branding",
  "author": "fork",
  "status": "fork-only",
  "description": "Fork uses 'shuvcode' ASCII art logo on home screen instead of upstream 'opencode' branding",
  "files": ["packages/opencode/src/cli/logo.ts", "packages/opencode/src/cli/cmd/tui/component/logo.tsx"],
  "criticalCode": [
    {
      "file": "packages/opencode/src/cli/logo.ts",
      "description": "Shuvcode ASCII art - left side shows 'shuv', right side shows 'code'",
      "markers": ["█▀▀▀ █▀▀█ █  █ █  █", "▀▀▀█ █░░█ █░░█ █░░█"]
    }
  ]
}
```

**Files to modify:**

- `script/sync/fork-features.json`

---

## Implementation Order

1. **Fix shuvcode logo** (CRITICAL - user-visible branding)
   - Edit `packages/opencode/src/cli/logo.ts`

2. **Add double Ctrl+C regression test**
   - Create `packages/opencode/src/cli/cmd/tui/component/prompt/exit.ts`
   - Wire helper in `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
   - Create `packages/opencode/test/cli/tui/double-ctrl-c.test.ts`
   - Run the test

3. **Remove legacy AskQuestion tool**
   - Delete `packages/opencode/src/askquestion/index.ts`
   - Delete `packages/opencode/src/tool/askquestion.ts`
   - Delete `packages/opencode/src/tool/askquestion.txt`
   - Delete `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx`
   - Remove AskQuestion cleanup from `packages/opencode/src/session/index.ts`
   - Delete `packages/app/src/components/askquestion-wizard.tsx`

4. **Update fork-features.json**
   - Enhance Double Ctrl+C entry with criticalCode
   - Add shuvcode logo entry
   - Remove AskQuestion entry
   - Keep Search in messages entry if code still exists

5. **Restore ANSI bash output rendering**
   - Replace `stripAnsi` rendering in the Bash tool block
   - Add ANSI-capable rendering path
   - Manual TUI verification with a colored command

6. **Commit and push**
   - Stage all changes
   - Commit with message: `fix: restore shuvcode branding and add fork feature tests`

---

## Verification Commands

```bash
# Run double Ctrl+C test
bun test test/cli/tui/double-ctrl-c.test.ts

# Typecheck
bun turbo typecheck --filter=opencode

# Verify logo change
grep -n "shuvcode\|█▀▀▀ █▀▀█ █  █" packages/opencode/src/cli/logo.ts

# Verify ghostty in build
grep -n "ghostty-opentui" packages/opencode/script/build.ts

# Verify ANSI render path (stripAnsi removed from Bash output)
grep -n "stripAnsi" packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
```

---

## Reference: Pre-merge Commit

The last known good state before the v1.1.41 merge:

- Commit: `96e1a43c6`
- Can be used to check any file's pre-merge state with: `git show 96e1a43c6:<filepath>`
