# Plan: TUI Transparency Toggle Fix

**Issue:** [#269 - Transparency toggle ignored; TUI background stays transparent across themes](https://github.com/Latitudes-Dev/shuvcode/issues/269)

**Created:** 2026-01-06

**Revised:** 2026-01-06 - Critical fix: Target `resolveColor` or post-resolution normalization, not just `resolveTheme`. Added fallback chain for themes with all-transparent backgrounds.

**Status:** NEEDS REVISION BEFORE IMPLEMENTATION

## Overview
The TUI transparency toggle currently does not restore opaque backgrounds. The fix must ensure `theme_transparent=false` renders opaque backgrounds for all built-in themes, while `theme_transparent=true` enforces transparent backgrounds. The toggle must update the runtime theme immediately, persist across restart, and keep selected list item contrast readable.

## Critical Issue Identified in Review

**Root Cause:** The plan's original approach is incorrect. The current `resolveTheme` at line 226-230 only forces transparency when `transparent=true`. It does NOT force opacity when `transparent=false`.

The real issue is that themes like `lucent-orng` use `"transparent"` as a literal color value in the JSON:
```json
"background": { "dark": "transparent", "light": "transparent" }
```

The `resolveColor` function at `theme.tsx:180` converts `"transparent"` to `RGBA(0,0,0,0)` **BEFORE** `resolveTheme` can apply any toggle override. By the time `resolveTheme` checks `if (transparent)`, the damage is done.

## Requirements (from issue)
- [ ] `theme_transparent=false` renders opaque backgrounds for all built-in themes.
- [ ] `theme_transparent=true` renders transparent backgrounds consistently.
- [ ] Toggling the command updates the runtime theme immediately and persists across restart.
- [ ] Selected list item contrast stays readable when transparency is off.

## Current Code Context
### Observations
- `resolveTheme` forces `background` alpha to 0 when `transparent` is true.
- `resolveColor` maps "transparent" or "none" to RGBA(0,0,0,0) regardless of toggle state.
- `selectedForeground` uses `theme.background.a === 0` to compute selected list item text color.
- Theme state is stored in KV using `theme_transparent` and read into `store.transparent` via `useKV`.
- Built-in theme `lucent-orng` contains "transparent" values, which can produce alpha 0 even when the toggle is off.

### Internal References
| Area | File | Notes |
| --- | --- | --- |
| Toggle command | `packages/opencode/src/cli/cmd/tui/app.tsx` | "Toggle transparency" invokes `setTransparent(!transparent())`. |
| Theme resolution | `packages/opencode/src/cli/cmd/tui/context/theme.tsx:175-238` | `resolveTheme` function - add normalization here. |
| Color resolution | `packages/opencode/src/cli/cmd/tui/context/theme.tsx:177-196` | `resolveColor` converts "transparent" to alpha=0 - DO NOT MODIFY. |
| Selected foreground | `packages/opencode/src/cli/cmd/tui/context/theme.tsx:106-121` | `selectedForeground` checks `background.a === 0` - will auto-correct after normalization. |
| Theme persistence | `packages/opencode/src/cli/cmd/tui/context/theme.tsx:294,396-398` | `kv.get("theme_transparent", false)` and `kv.set("theme_transparent", transparent)`. |
| Built-in theme | `packages/opencode/src/cli/cmd/tui/context/theme/lucent-orng.json:64-79` | Uses "transparent" values for all backgrounds except `backgroundMenu`. |

### Configuration Values
| Key | Location | Purpose | Type |
| --- | --- | --- | --- |
| `theme_transparent` | KV store | Persist transparency toggle | boolean |
| `theme` | KV store / sync config | Active theme name | string |
| `theme_mode` | KV store | Light/dark mode | "light" or "dark" |

## Technical Approach and Decisions
### Hypotheses to Validate
- `store.transparent` is stuck `true` due to persistence or rehydration issues.
- Theme JSON values set to "transparent" are overriding the toggle when `transparent=false`. **CONFIRMED**
- Theme recomputation is not re-running after toggling.

### Root Cause (Confirmed)
The `resolveColor` function at `theme.tsx:180` maps `"transparent"` or `"none"` strings to `RGBA(0,0,0,0)` **regardless of the toggle state**. This happens during color resolution, before `resolveTheme` can apply the `transparent` parameter.

### Decision (Revised)
Add a **post-resolution normalization step** that enforces opaque backgrounds when `transparent=false`:
- When `transparent=true`, backgrounds should be fully transparent (current behavior).
- When `transparent=false`, ANY background color with alpha=0 should be replaced with an opaque fallback.
- Fallback chain: `background` → `backgroundPanel` → `backgroundElement` → `backgroundMenu` → derive from `primary`.

Rationale: The acceptance criteria requires opaque backgrounds for all built-in themes when transparency is off. The normalization must happen AFTER `resolveColor` has processed all values.

### Option Comparison (Updated)
| Option | Summary | Pros | Cons | Decision |
| --- | --- | --- | --- | --- |
| Pass `transparent` to `resolveColor` | Make color resolution aware of toggle | Early fix | Requires threading parameter through all calls | Rejected (too invasive) |
| **Post-resolution normalization** | Add step after all colors resolved to enforce opacity | Central fix, doesn't modify resolveColor | Requires fallback color logic | **Selected** |
| Edit theme JSONs | Replace "transparent" values with opaque colors per theme | Simple to reason about per theme | Breaks custom themes and user overrides | Rejected |
| Add per-theme allowlist | Allow only specific themes to stay transparent | Fine-grained | Contradicts acceptance criteria | Rejected |

## Technical Specifications

### Opaque Fallback Rules
Add a normalization function called AFTER all colors are resolved but BEFORE returning the theme:

```ts
// In theme.tsx, after resolveTheme builds the resolved object

function normalizeBackgrounds(resolved: Partial<ThemeColors>, transparent: boolean): Partial<ThemeColors> {
  if (transparent) return resolved  // No normalization when transparency is on
  
  // Find first opaque background to use as fallback
  const findOpaqueFallback = (): RGBA => {
    // Fallback chain: backgroundMenu → backgroundElement → backgroundPanel → derive from primary
    const candidates = [
      resolved.backgroundMenu,
      resolved.backgroundElement,
      resolved.backgroundPanel,
      resolved.background,
    ]
    
    for (const color of candidates) {
      if (color && color.a > 0) return color
    }
    
    // Last resort: derive dark background from primary
    // Use primary at 10% luminance for dark themes, 95% for light
    const primary = resolved.primary!
    return RGBA.fromInts(
      Math.round(primary.r * 0.1 * 255),
      Math.round(primary.g * 0.1 * 255),
      Math.round(primary.b * 0.1 * 255),
      255  // Fully opaque
    )
  }
  
  const fallback = findOpaqueFallback()
  
  // Replace any transparent backgrounds with the fallback
  const backgroundFields: (keyof ThemeColors)[] = [
    'background', 'backgroundPanel', 'backgroundElement', 'backgroundMenu'
  ]
  
  for (const field of backgroundFields) {
    const color = resolved[field]
    if (color && color.a === 0) {
      resolved[field] = fallback
    }
  }
  
  return resolved
}
```

### Integration Point
In `resolveTheme` function (`theme.tsx:175`), call normalization AFTER resolution but BEFORE returning:

```ts
function resolveTheme(theme: ThemeJson, mode: "dark" | "light", transparent: boolean) {
  // ... existing resolution logic (lines 176-230) ...
  
  // NEW: Normalize backgrounds when transparency is off
  const normalized = normalizeBackgrounds(resolved, transparent)
  
  return {
    ...normalized,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
    transparent,
  } as Theme
}
```

### Impacted Colors
These fields are normalized when alpha is 0 and `transparent=false`:
- `background` - main app background
- `backgroundPanel` - panel/sidebar backgrounds
- `backgroundElement` - element backgrounds (inputs, buttons)
- `backgroundMenu` - menu/dropdown backgrounds

### Selected List Item Contrast
The `selectedForeground` function at `theme.tsx:106-121` checks `theme.background.a === 0` to determine contrast mode:
- After normalization, `background.a` will be `1` (opaque) when `transparent=false`
- This means selected list items will use `theme.background` as foreground (correct behavior)
- No changes needed to `selectedForeground` - it will automatically behave correctly after normalization

### lucent-orng Theme Analysis
This theme is the primary test case. Current values:
- `background`: `"transparent"` (dark/light) → alpha=0
- `backgroundPanel`: `"transparent"` → alpha=0  
- `backgroundElement`: `"transparent"` → alpha=0
- `backgroundMenu`: `"darkPanelBg"` / `"lightPanelBg"` → **opaque!** (`#2a1a1599` has alpha)

Wait, `#2a1a1599` is a hex color with alpha. Let me check:
- `#2a1a1599` = RGB(42, 26, 21) with alpha 0x99 = 153/255 ≈ 60% opacity

So `backgroundMenu` is semi-transparent, not fully opaque. The fallback chain must handle this:
- If ALL backgrounds have alpha < 1, derive from primary as last resort

## Implementation Plan

### Milestone 1: Reproduce and Inspect State
- [ ] Reproduce in TUI and log `transparent()` before and after toggling.
- [ ] Verify `kv.get("theme_transparent", false)` changes and persists across restart.
- [ ] Inspect `resolveTheme` output for `background.a` with multiple themes (Night Owl, Nord, lucent-orng).
- [ ] Confirm that the theme memo re-runs on `setTransparent` by logging `store.transparent` and `values().background.a`.
- [ ] **NEW:** Verify that `lucent-orng` theme resolves to alpha=0 even when toggle is off (confirms root cause).

### Milestone 2: Fix Theme Resolution
- [ ] Create `normalizeBackgrounds(resolved, transparent)` helper function in `theme.tsx`.
- [ ] Implement fallback chain: `backgroundMenu` → `backgroundElement` → `backgroundPanel` → derive from `primary`.
- [ ] Handle semi-transparent colors (e.g., `#2a1a1599` with alpha=0x99) - require full opacity (alpha=1) for fallback.
- [ ] Call `normalizeBackgrounds()` at the end of `resolveTheme()` before returning.
- [ ] Ensure the `theme.transparent` flag reflects the toggle state correctly.

### Milestone 3: Contrast and Theme UX
- [ ] Re-validate `selectedForeground` behavior with opaque backgrounds.
- [ ] Verify that selected list item contrast remains readable for Night Owl, Nord, opencode, and lucent-orng themes.
- [ ] **NEW:** Test with light mode themes to ensure derived fallback works for both dark and light modes.

### Milestone 4: Tests
- [ ] Add unit tests in `packages/opencode/test/theme.test.ts` for:
  - `normalizeBackgrounds` with fully transparent theme
  - `normalizeBackgrounds` with semi-transparent `backgroundMenu`
  - `normalizeBackgrounds` fallback derivation from `primary`
  - Full `resolveTheme` with `transparent=false` and lucent-orng fixture
- [ ] Add test for `selectedForeground` to verify readable contrast when transparency is off.

### Milestone 5: Manual Validation
- [ ] Toggle transparency on/off in TUI and verify immediate updates.
- [ ] Switch themes (Night Owl, Nord, lucent-orng) and verify backgrounds are opaque when toggle is off.
- [ ] Restart TUI and confirm the last toggle state is restored.
- [ ] **NEW:** Test lucent-orng specifically in both dark and light modes with transparency off.

## Validation Criteria
### Automated
- [ ] `bun test` in `packages/opencode` passes.
- [ ] Theme transparency tests cover both on and off cases.

### Manual
- [ ] With `theme_transparent=false`, background is opaque for all built-in themes.
- [ ] With `theme_transparent=true`, background is fully transparent.
- [ ] Selected list item text remains readable when transparency is off.
- [ ] Toggle state persists after restart.

### Suggested Commands
```bash
cd /home/shuv/repos/worktrees/shuvcode/shuvcode-dev/packages/opencode
bun test
```

## External References (Git URLs)
- https://github.com/tauri-apps/wry/blob/dev/examples/transparent.rs
- https://github.com/tauri-apps/tao/blob/dev/examples/transparent.rs
- https://raw.githubusercontent.com/electron/electron/main/docs/api/browser-window.md

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Opaque fallback picks a poor color for transparent themes | Medium | Use fallback chain to find best available opaque color; derive from primary as last resort. |
| Derived primary fallback looks bad | Medium | Use 10% luminance of primary for dark mode, 95% for light mode to ensure sufficient contrast. |
| Fix changes behavior for custom themes | Medium | Gate fallback only when `transparent=false` and alpha is 0. Custom themes with explicit opaque colors are unaffected. |
| Contrast regressions on selected items | Medium | Add tests for `selectedForeground` and manual spot checks. The function auto-corrects based on final `background.a`. |
| Semi-transparent backgrounds (e.g., 60% alpha) not handled | Low | Require full opacity (alpha=1) for fallback eligibility; semi-transparent stays as-is or falls through to derived. |
