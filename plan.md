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

### 2. Verify/Restore ANSI Bash Output (PR #4791)

**Problem:** Need to verify the ghostty-opentui integration is working for ANSI terminal emulation in bash output.

**Current State:**

- `ghostty-opentui` dependency exists in package.json (version 1.3.7) ✓
- Need to verify the integration code in session/index.tsx

**Check Required:**
The fork-features.json documents these markers that should exist:

- `packages/opencode/script/build.ts`: Should have `bun install --os="*" --cpu="*" ghostty-opentui`

**Verification Steps:**

1. Check if `packages/opencode/script/build.ts` has the ghostty install command
2. Check if bash tool output renders ANSI colors in TUI
3. If not working, may need to restore GhosttyTerminalRenderable integration

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

### 4. Add Fork-Specific Test for Double Ctrl+C

**Problem:** The double Ctrl+C feature was lost during merge and needs a regression test.

**Implementation Required:**
Create a test file at `packages/opencode/test/tui/double-ctrl-c.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"

describe("Double Ctrl+C to exit", () => {
  test("tryExit function exists and requires two presses within 2 seconds", async () => {
    // This test verifies the implementation exists in prompt/index.tsx
    // The actual behavior is:
    // 1. First Ctrl+C shows toast "Press again to exit" (2 second duration)
    // 2. Second Ctrl+C within 2 seconds exits the application
    // 3. If more than 2 seconds pass, the first press is "forgotten"

    const promptSource = await Bun.file("src/cli/cmd/tui/component/prompt/index.tsx").text()

    // Verify tryExit function exists
    expect(promptSource).toContain("async function tryExit()")

    // Verify lastExitAttempt tracking
    expect(promptSource).toContain("let lastExitAttempt = 0")

    // Verify 2-second window check
    expect(promptSource).toContain("now - lastExitAttempt < 2000")

    // Verify toast message
    expect(promptSource).toContain('message: "Press again to exit"')

    // Verify tryExit is called on app_exit keybind
    expect(promptSource).toContain("await tryExit()")
    expect(promptSource).toContain('keybind.match("app_exit"')
  })
})
```

**Files to create:**

- `packages/opencode/test/tui/double-ctrl-c.test.ts`

---

### 5. Update fork-features.json

**Changes Required:**

#### 5.1 Remove entries for features no longer maintained:

- Remove AskQuestion tool entry (PR #5958) - lost in v1.1.26 sync, not being restored
- Remove Search in messages entry (PR #4898) - lost in v1.1.26 sync, not being restored

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

2. **Add double Ctrl+C test**
   - Create `packages/opencode/test/tui/double-ctrl-c.test.ts`
   - Run test to verify it passes

3. **Update fork-features.json**
   - Remove AskQuestion entry (PR #5958)
   - Remove Search in messages entry (PR #4898)
   - Enhance Double Ctrl+C entry with criticalCode
   - Add shuvcode logo entry

4. **Verify ANSI bash output**
   - Check build.ts for ghostty install
   - Manual test in TUI if needed

5. **Commit and push**
   - Stage all changes
   - Commit with message: `fix: restore shuvcode branding and add fork feature tests`

---

## Verification Commands

```bash
# Run double Ctrl+C test
bun test test/tui/double-ctrl-c.test.ts

# Typecheck
bun turbo typecheck --filter=opencode

# Verify logo change
grep -n "shuvcode\|█▀▀▀ █▀▀█ █  █" packages/opencode/src/cli/logo.ts

# Verify ghostty in build
grep -n "ghostty-opentui" packages/opencode/script/build.ts
```

---

## Reference: Pre-merge Commit

The last known good state before the v1.1.41 merge:

- Commit: `96e1a43c6`
- Can be used to check any file's pre-merge state with: `git show 96e1a43c6:<filepath>`
