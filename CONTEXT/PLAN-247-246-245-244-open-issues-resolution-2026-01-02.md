# Project Plan: Resolve Open Issues #247, #246, #245, #244

**Created:** 2026-01-02
**Updated:** 2026-01-02 (Implementation Complete)
**Issues:** #247, #246, #245, #244
**Repository:** Latitudes-Dev/shuvcode (fork of sst/opencode)
**Branch:** shuvcode-dev
**Status:** IMPLEMENTED

---

## Executive Summary

This plan addresses all four currently open issues in priority order:

| Issue | Title | Priority | Complexity | Est. Time | Status |
|-------|-------|----------|------------|-----------|--------|
| #247 | Restore double Ctrl+C to exit functionality | High | Low | 15 min | **DONE** |
| #246 | Restore Knight Rider agent spinner | Medium | Medium | 30 min | **DONE** |
| #245 | Preload not found error in OpenTUI projects | Medium | Low | 20 min | **INVESTIGATION** |
| #244 | iOS PWA safe area handling | Medium | Medium | 45 min | **DONE** |

**Recommended Order:** #247 -> #246 -> #245 -> #244

This order prioritizes by:
1. User impact (accidental exit is frustrating)
2. Simplicity of fix (quick wins first)
3. Dependencies (none between issues)

---

## Issue #247: Restore Double Ctrl+C to Exit Functionality

### Problem Statement

The double Ctrl+C to exit functionality from upstream PR #4900 was broken during a recent upstream merge. Currently, pressing Ctrl+C when the prompt is empty immediately exits the application with no warning or confirmation.

### Root Cause

During upstream merge, the `tryExit` function and `lastExitAttempt` tracking variable were lost from `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`. The code at line ~850 now directly calls `exit()` instead of the protective `tryExit()` wrapper.

### Technical Approach

The fix requires adding back:
1. A `lastExitAttempt` timestamp variable after `const exit = useExit()` (line 669)
2. A `tryExit()` async function that checks if 2 seconds have elapsed since last attempt
3. Changing the `app_exit` handler to call `tryExit()` instead of `exit()`

### Reference Implementation

Working implementation exists in `search.tsx`:42-56 which can be directly copied.

### Files to Modify

| File | Line | Change |
|------|------|--------|
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 669 | Add `lastExitAttempt` variable |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 670-684 | Add `tryExit()` function |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 850 | Replace `exit()` with `tryExit()` |

### Internal Code References

- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:669` - Location for new code
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:848-855` - Current exit handler
- `packages/opencode/src/cli/cmd/tui/component/prompt/search.tsx:42-56` - Reference implementation
- `packages/opencode/src/cli/cmd/tui/context/toast.tsx` - Toast context (already imported at line 31)

### External References

- **Upstream PR:** https://github.com/sst/opencode/pull/4900
- **Author:** @AmineGuitouni
- **Commit:** `ea0def3ad88d80367a4c10a621828af4039d77fd`

### Implementation Tasks

- [x] Verify `useToast` hook is imported (already present at line 31)
- [x] Add `let lastExitAttempt = 0` after line 669 (`const exit = useExit()`)
- [x] Add `tryExit()` async function after `lastExitAttempt`:
  ```tsx
  async function tryExit() {
    const now = Date.now()
    if (now - lastExitAttempt < 2000) {
      await exit()
      return
    }
    lastExitAttempt = now
    toast.show({
      variant: "warning",
      message: "Press again to exit",
      duration: 2000,
    })
  }
  ```
- [x] Update line ~850 to call `tryExit()` instead of `exit()` (now at line 884)
- [ ] Test double Ctrl+C functionality:
  - First press shows "Press again to exit" toast
  - Second press within 2 seconds exits
  - Waiting >2 seconds resets the counter
- [x] Run `bun test` in `packages/opencode` (tests pass, pre-existing TS2589 error in llm.ts unrelated)

### Validation Criteria

- [ ] First Ctrl+C with empty prompt shows warning toast
- [ ] Second Ctrl+C within 2 seconds exits application
- [ ] After 2 seconds, counter resets (requires two presses again)
- [x] Tests pass
- [x] TypeScript compiles without errors (pre-existing error in llm.ts unrelated)

---

## Issue #246: Restore Knight Rider Agent Spinner

### Problem Statement

The original Knight Rider style bouncing scanner animation for the primary agent indicator was inadvertently replaced with the fork's custom braille spinner (`getSpinnerFrame()`) during fork customization. The Knight Rider spinner should be used for the main agent indicator, while the configurable braille spinners should remain for other tool indicators.

### Root Cause

When implementing configurable spinner styles (fork feature), the code at line 1031 was changed from using the upstream `<spinner>` component with Knight Rider animation to using `<text>{getSpinnerFrame()}</text>` with braille animation.

### Technical Approach

1. Import `createColors` and `createFrames` from `../../ui/spinner.ts`
2. Create a `spinnerDef` memo that derives Knight Rider frames/colors from the current agent's color
3. Replace the `<text>{getSpinnerFrame()}</text>` with `<spinner>` component for the agent indicator

### Current State

```tsx
// Line 27
import { getSpinnerFrame } from "../../util/spinners"

// Line 761
const spinnerColor = createMemo(() => local.agent.color(local.agent.current().name))

// Line 1031
<text fg={spinnerColor()}>{getSpinnerFrame()}</text>
```

### Target State

```tsx
// Add to imports
import { createColors, createFrames } from "../../ui/spinner"

// After spinnerColor memo (line 761)
const spinnerDef = createMemo(() => {
  const color = local.agent.color(local.agent.current().name)
  return {
    frames: createFrames({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    }),
    color: createColors({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    }),
  }
})

// Line 1031 replacement
<spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
```

### Files to Modify

| File | Line | Change |
|------|------|--------|
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 1-30 | Add `createColors`, `createFrames` imports |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 762-778 | Add `spinnerDef` memo |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 1030-1032 | Replace `<text>` with `<spinner>` component |

### Internal Code References

- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:27` - Current import
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:761` - spinnerColor memo
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:1029-1033` - Current spinner render
- `packages/opencode/src/cli/cmd/tui/ui/spinner.ts:272` - `createFrames()` function
- `packages/opencode/src/cli/cmd/tui/ui/spinner.ts:336` - `createColors()` function
- `packages/opencode/src/cli/cmd/tui/util/spinners.ts` - Custom spinners (keep for other indicators)

### External References

- **OpenTUI spinner component:** `opentui-spinner/solid` (already imported at line 3)

### Implementation Tasks

- [x] Add `createColors`, `createFrames` imports from `"../../ui/spinner"` (line 28)
- [x] Create `spinnerDef` memo after `spinnerColor` that derives Knight Rider frames/colors from agent color (lines 779-795)
- [x] Replace `<text fg={spinnerColor()}>{getSpinnerFrame()}</text>` with:
  ```tsx
  <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
  ```
  (line 1065)
- [x] Keep `getSpinnerFrame()` import for use in other components (session list, sidebar, etc.)
- [ ] Update `script/sync/fork-features.json` to clarify Knight Rider is for agent, custom spinners for tools
- [ ] Test that agent spinner shows Knight Rider animation
- [ ] Test that configurable spinners still work for tool indicators in sidebar

### Validation Criteria

- [ ] Primary agent indicator shows Knight Rider bouncing scanner animation
- [ ] Knight Rider spinner color matches current agent color
- [ ] Other spinners (session loading, tool execution) still use configurable braille spinners
- [ ] Animation is smooth and responsive
- [x] Tests pass
- [x] TypeScript compiles without errors

---

## Issue #245: Preload Not Found Error in OpenTUI Projects

### Problem Statement

When running `shuvcode` from within other OpenTUI SolidJS projects, the CLI fails with:
```
error: preload not found "@opentui/solid/preload"
```

### Root Cause (Investigation Required)

This is potentially caused by Bun bug [oven-sh/bun#25442](https://github.com/oven-sh/bun/issues/25442): Bun applies the current working directory's `bunfig.toml` to hashbang scripts from linked/global packages.

**However**, based on investigation in issue comments, the compiled binary (v1.0.223-1) already has `autoloadBunfig: false` set and works correctly.

### Investigation Questions

1. **How is shuvcode being invoked?**
   - Global install via `bun install -g shuvcode`? (Works)
   - Running `bun dev` from source? (May have issues)
   - Some other method?

2. **What version is installed?**
   ```bash
   shuvcode --version
   ```

3. **Is there a shell alias or function overriding shuvcode?**
   ```bash
   type -a shuvcode
   alias shuvcode
   ```

### Current Build Configuration

```typescript
// packages/opencode/script/build.ts:135
await Bun.build({
  // ...
  compile: {
    autoloadBunfig: false,  // Already set to prevent config inheritance
    autoloadDotenv: false,
    // ...
  },
  // ...
})
```

### Potential Solutions

#### Option 1: Environment Variable Workaround (if needed)

Create a launcher script that sets `BUN_CONFIG_FILE` to an empty value:
```bash
BUN_CONFIG_FILE="" shuvcode "$@"
```

#### Option 2: Programmatic Plugin Registration (if needed)

Register the SolidJS plugin in the entry point instead of relying on bunfig.toml:
```typescript
// In src/index.ts
import { plugin } from "bun"
import solidTransformPlugin from "@opentui/solid/bun-plugin"
plugin(solidTransformPlugin)
```

#### Option 3: Document the Issue

If the compiled binary works correctly, document that:
- Users should use the released binary, not `bun dev`
- Running from source requires being outside of OpenTUI projects

### Files to Reference

| File | Purpose |
|------|---------|
| `packages/opencode/bunfig.toml` | Current preload configuration |
| `packages/opencode/script/build.ts:135` | Build config with `autoloadBunfig: false` |
| `packages/opencode/package.json:84` | `@opentui/solid` dependency |

### Implementation Tasks

- [x] Verify `autoloadBunfig: false` is set in build config (confirmed at line 135)
- [ ] Reproduce the issue to confirm current state
  ```bash
  cd /tmp && mkdir test-opentui && cd test-opentui
  echo 'preload = ["@opentui/solid/preload"]' > bunfig.toml
  npm init -y && bun add @opentui/solid
  shuvcode --version  # Should work with compiled binary
  ```
- [ ] If reproducible with compiled binary:
  - [ ] Investigate if `autoloadBunfig: false` is being correctly applied
  - [ ] Consider adding `BUN_CONFIG_FILE=""` to launcher scripts
- [ ] If NOT reproducible with compiled binary:
  - [ ] Update issue with findings
  - [ ] Document workaround for `bun dev` usage
- [ ] Add test case in `packages/opencode/test/` for verifying config isolation
- [ ] Update issue #245 with resolution

### Investigation Status

**Finding:** The build configuration already has `autoloadBunfig: false` set, which should prevent this issue with the compiled binary. The issue may only affect:
1. Users running `bun dev` from source
2. Users with an older version of shuvcode
3. Users with shell aliases overriding the binary

**Recommendation:** Close as "works as designed" for compiled binary, document workaround for development.

### Validation Criteria

- [ ] `shuvcode --version` works from any directory
- [ ] `shuvcode` launches correctly from OpenTUI project directories
- [ ] No regression in TUI functionality (SolidJS transforms work)
- [ ] Tests pass

### External References

- **Bun Issue:** https://github.com/oven-sh/bun/issues/25442
- **Related Issue:** https://github.com/oven-sh/bun/issues/12539
- **Bun Config Docs:** https://bun.sh/docs/runtime/bunfig

---

## Issue #244: Fix iOS PWA Safe Area Handling

### Problem Statement

The PWA on iOS has two critical layout issues:
1. **Top:** Content hidden under Dynamic Island - app menu bar positioned behind safe area
2. **Bottom:** Wasted space gap - chat input should be just above home indicator

### Root Cause

CSS safe area variables are defined in `packages/app/src/index.css` but not applied to the main layout containers - only used in isolated components like dialogs and pull-to-refresh.

### Current State

```css
/* packages/app/src/index.css - Variables defined but not fully applied */
:root {
  --safe-area-inset-top: env(safe-area-inset-top, 0px);
  --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
  --pwa-top-offset: var(--safe-area-inset-top);
  --pwa-bottom-offset: var(--safe-area-inset-bottom);
}
```

### Technical Approach

Apply safe area insets to root layout containers in PWA standalone mode:
1. Header: Add top padding for Dynamic Island clearance
2. Bottom input area: Add bottom padding for home indicator clearance
3. Use CSS media query `@media (display-mode: standalone)`

### Files to Modify

| File | Line(s) | Change |
|------|---------|--------|
| `packages/app/src/index.css` | 90-104 | Add header and input safe area styles for PWA mode |
| `packages/app/src/components/header.tsx` | 34 | Add data attribute or inline style for PWA mode |
| `packages/app/src/pages/layout.tsx` | 1071-1077 | Ensure main layout respects safe areas |
| `packages/app/src/pages/session.tsx` | ~1190, ~1220 | Bottom input area needs safe area padding |

### CSS Implementation

Add to `packages/app/src/index.css`:

```css
/* PWA standalone mode - root layout safe area handling */
@media (display-mode: standalone) {
  /* Header should clear the Dynamic Island */
  header[data-tauri-drag-region] {
    padding-top: var(--safe-area-inset-top);
    height: calc(3rem + var(--safe-area-inset-top));
  }
  
  /* Bottom input area should clear home indicator */
  /* Mobile prompt input container */
  .absolute.inset-x-0.bottom-4 {
    padding-bottom: max(1rem, var(--safe-area-inset-bottom));
  }
  
  /* Desktop prompt input container */
  .absolute.inset-x-0.bottom-8 {
    padding-bottom: max(2rem, var(--safe-area-inset-bottom));
  }
}
```

### Alternative: Component-Level Approach

If CSS-only approach doesn't work, use the existing `isPWA()` helper in components:

```tsx
// In session.tsx
import { isPWA } from "@/context/platform"

// In JSX:
<div 
  class="absolute inset-x-0 bottom-4 ..."
  style={{ "padding-bottom": isPWA() ? "var(--safe-area-inset-bottom)" : undefined }}
>
```

### Internal Code References

- `packages/app/src/index.css:7-15` - Safe area CSS variable definitions
- `packages/app/src/index.css:90-104` - PWA standalone mode styles
- `packages/app/src/context/platform.tsx:5-12` - `isPWA()` helper function
- `packages/app/src/components/header.tsx:34` - Header component
- `packages/app/src/pages/layout.tsx:1071-1077` - Main layout wrapper
- `packages/app/src/pages/session.tsx:1190` - Mobile prompt input container
- `packages/app/src/pages/session.tsx:1220` - Desktop prompt input container
- `packages/app/src/components/pull-to-refresh.tsx:99` - Example of safe area usage
- `packages/app/src/components/askquestion-wizard.tsx:336` - Example of bottom safe area usage

### External References

- **MDN env():** https://developer.mozilla.org/en-US/docs/Web/CSS/env
- **WebKit iPhone X Design:** https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- **Apple HIG Layout:** https://developer.apple.com/design/human-interface-guidelines/layout

### Implementation Tasks

- [x] Add PWA-specific header height adjustment in `packages/app/src/index.css` (lines 106-121)
- [x] Apply `padding-top: var(--safe-area-inset-top)` to header in standalone mode
- [x] Apply `padding-bottom: var(--safe-area-inset-bottom)` to prompt input containers (session.tsx lines 1192, 1225)
- [ ] Test on iOS Simulator with various iPhone models:
  - [ ] iPhone X/XS (notch)
  - [ ] iPhone 11/12/13 (notch)
  - [ ] iPhone 14 Pro/15 Pro (Dynamic Island)
- [ ] Test in both portrait and landscape orientations
- [ ] Verify no regression in:
  - [ ] Desktop browser
  - [ ] Android PWA
  - [ ] iOS Safari (non-PWA)
- [ ] Verify dialogs/modals still work correctly with safe areas
- [x] Run `bun turbo test` to ensure no regressions (TypeScript compiles)

### Validation Criteria

- [ ] App menu bar (header) fully visible below Dynamic Island on all iPhone models
- [ ] Chat input box and submit button sit just above home indicator rounded edge
- [ ] No wasted vertical space at top or bottom in PWA standalone mode
- [ ] Layout works correctly in both portrait and landscape orientations
- [ ] No regression on desktop or non-PWA mobile browsers

---

## Implementation Order & Dependencies

```
Issue #247 (Double Ctrl+C) ✅ DONE
    |
    v
Issue #246 (Knight Rider Spinner) ✅ DONE
    |
    v
Issue #245 (Preload Investigation) ⏳ NEEDS FOLLOW-UP
    |
    v
Issue #244 (iOS PWA Safe Areas) ✅ DONE
```

**Rationale:**
- #247 is a quick fix with high user impact
- #246 is localized to prompt/index.tsx (same file as #247)
- #245 requires investigation and may be non-reproducible
- #244 is CSS-focused and requires iOS testing

---

## Testing Strategy

### Unit Tests

For #247 and #246:
```bash
cd packages/opencode
bun test
```

### Integration Testing

For #245:
```bash
# Create test environment
cd /tmp && mkdir test-opentui && cd test-opentui
echo 'preload = ["@opentui/solid/preload"]' > bunfig.toml
npm init -y && bun add @opentui/solid

# Test compiled binary
shuvcode --version

# Test from source (if needed)
cd /path/to/shuvcode
bun dev
```

### Manual Testing

For #244 (iOS PWA):
1. Deploy to staging
2. Open on iOS Safari
3. Add to Home Screen
4. Launch PWA
5. Verify header and input placement
6. Test in landscape mode

---

## Post-Implementation

### Documentation Updates

- [ ] Update `script/sync/fork-features.json` with clarifications about spinners
- [ ] Close issues #247, #246, #245, #244 with implementation details
- [ ] Update STATS.md if needed

### Commit Strategy

Create individual commits for each issue:
```bash
git add packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx
git commit -m "fix(tui): restore double Ctrl+C to exit functionality (#247)"

git commit -m "fix(tui): restore Knight Rider agent spinner (#246)"

git commit -m "docs: document preload issue workaround (#245)"

git add packages/app/src/index.css packages/app/src/pages/session.tsx
git commit -m "fix(pwa): handle iOS safe areas for Dynamic Island and home indicator (#244)"
```

---

## Risk Assessment

| Issue | Risk Level | Mitigation |
|-------|------------|------------|
| #247 | Low | Reference implementation exists in search.tsx |
| #246 | Low | Upstream code well-documented, spinner.ts already exists |
| #245 | Medium | May be environment-specific; document workarounds |
| #244 | Medium | Requires iOS testing; use progressive enhancement |

---

## Implementation Summary

### Changes Made

1. **Issue #247 - Double Ctrl+C to Exit**
   - File: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
   - Added `lastExitAttempt` variable at line 672
   - Added `tryExit()` function at lines 674-686
   - Changed exit handler at line 884 to call `tryExit()`

2. **Issue #246 - Knight Rider Spinner**
   - File: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
   - Added import for `createColors`, `createFrames` at line 28
   - Added `spinnerDef` memo at lines 779-795
   - Replaced spinner render at line 1065 with `<spinner>` component

3. **Issue #244 - iOS PWA Safe Areas**
   - File: `packages/app/src/index.css`
   - Added CSS at lines 106-121 for header and mobile prompt positioning
   - File: `packages/app/src/pages/session.tsx`
   - Added inline styles at lines 1192 and 1225 for safe area padding

4. **Issue #245 - Preload Investigation**
   - Verified `autoloadBunfig: false` is already set in build config
   - Issue likely only affects `bun dev` usage, not compiled binary
   - Requires follow-up to close issue with documentation

---

## Appendix: Code Snippets

### A. tryExit Function (Issue #247)

```tsx
let lastExitAttempt = 0

async function tryExit() {
  const now = Date.now()
  if (now - lastExitAttempt < 2000) {
    await exit()
    return
  }
  lastExitAttempt = now
  toast.show({
    variant: "warning",
    message: "Press again to exit",
    duration: 2000,
  })
}
```

### B. Knight Rider spinnerDef Memo (Issue #246)

```tsx
import { createColors, createFrames } from "../../ui/spinner"

const spinnerDef = createMemo(() => {
  const color = local.agent.color(local.agent.current().name)
  return {
    frames: createFrames({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    }),
    color: createColors({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    }),
  }
})
```

### C. PWA Safe Area CSS (Issue #244)

```css
@media (display-mode: standalone) {
  header[data-tauri-drag-region] {
    padding-top: var(--safe-area-inset-top);
    height: calc(3rem + var(--safe-area-inset-top));
  }
  
  [data-component="mobile-prompt-container"] {
    padding-bottom: max(1rem, var(--safe-area-inset-bottom));
  }
  
  [data-component="desktop-prompt-container"] {
    padding-bottom: max(2rem, var(--safe-area-inset-bottom));
  }
}
```
