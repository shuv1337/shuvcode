# Plan: Fix PWA Safe-Area Insets on Main Session/Chat Page for iOS Dynamic Island

**Issue:** [#181](https://github.com/Latitudes-Dev/shuvcode/issues/181)
**Date:** 2025-12-21
**Status:** Planning

---

## Problem Summary

The PWA has inconsistent safe-area handling across different views on iOS devices with Dynamic Island (iPhone 14 Pro and later):

- **Working correctly**: Mobile menu overlay and file review popup properly respect `safe-area-inset-*` with full background color extending behind the Dynamic Island
- **Not working**: Main session/chat page does not fill the background behind the Dynamic Island and the menu bar can get buried behind it until screen orientation is changed

This creates a jarring visual inconsistency and usability issue on modern iPhones when using the app as a PWA.

---

## Root Cause Analysis

### Current Architecture (as implemented today)

The current implementation applies safe-area padding at the **layout wrapper level** (`packages/desktop/src/pages/layout.tsx:686-693`). This ensures the header and routed content are inset away from the Dynamic Island/notch/home indicator.

```tsx
// Current approach - layout.tsx:686-693
<div
  class="relative flex-1 min-h-0 flex flex-col bg-background-base"
  style={{
    "padding-top": "var(--safe-area-inset-top)",
    "padding-bottom": "var(--safe-area-inset-bottom)",
    "padding-left": "var(--safe-area-inset-left)",
    "padding-right": "var(--safe-area-inset-right)",
  }}
>
```

Important nuance: this wrapper also paints `bg-background-base`, so padding alone should not inherently produce an “unpainted gap” within the wrapper box. If a visible gap occurs, it more likely indicates that **safe-area values are incorrect/late-updating** (padding too small/zero) or that **the viewport height/positioning differs** in standalone mode.

### Existing PWA Standalone Background Handling (already present)

The repo already includes a standalone-mode background fill rule:

- `html, body { background-color: var(--background-base); }` in `packages/desktop/src/index.css:73-77`
- Standalone `#root` min-height rules in `packages/desktop/src/index.css:80-84`
- `#root` also has `bg-background-base` and `h-screen` in markup (`packages/desktop/index.html:43`)

This means Phase 1 work must start from “verify and adjust” rather than assuming the background fill is missing entirely.

### Why Overlays Appear To Work

The mobile overlays (menu at `packages/desktop/src/pages/layout.tsx:1084-1091`, mobile tabs at `packages/desktop/src/pages/session.tsx:922-929`) work correctly because they:

1. Use `position: fixed; inset: 0` to cover the entire screen including safe areas
2. Apply their own `bg-background-base` which extends behind the Dynamic Island
3. Apply safe-area padding **inside** the overlay, so content is pushed down but background fills

Crucially: overlays are opened **after** initial load/user interaction. If iOS reports `env(safe-area-inset-*)` as `0` on cold launch and then corrects after a lifecycle event (rotation, resume, first interaction), overlays would “look correct” even if the base view is wrong.

### Primary Hypotheses (to validate before refactoring)

1. **Late/incorrect safe-area values on cold launch**: `env(safe-area-inset-top)` and friends may initially be `0` in iOS PWA standalone, then update after rotation/resume.
2. **Viewport sizing mismatch**: `#root` uses `h-screen` (`packages/desktop/index.html:43`), while standalone CSS uses `min-height: 100dvh` (`packages/desktop/src/index.css:80-84`). Depending on iOS behavior, `h-screen` may cause the app to size incorrectly on first render.
3. **Layout shell coupling**: The layout wrapper currently provides global safe-area protection. If the session page has absolute-positioned elements (e.g., prompt input container at `packages/desktop/src/pages/session.tsx:666`), it may depend on the wrapper’s inset-adjusted box to avoid being under the Dynamic Island/home indicator.

### Technical Stack

| Component          | Purpose                  | File                                                  |
| ------------------ | ------------------------ | ----------------------------------------------------- |
| Viewport meta      | Enables safe area access | `packages/desktop/index.html:5-8`                     |
| CSS variables      | Store safe area values   | `packages/desktop/src/index.css:7-11`                 |
| PWA styles         | Standalone mode handling | `packages/desktop/src/index.css:66-85`                |
| Layout wrapper     | Main app container       | `packages/desktop/src/pages/layout.tsx:686-693`       |
| Session page       | Chat/session view        | `packages/desktop/src/pages/session.tsx:599`          |
| Tailwind utilities | Safe area helper classes | `packages/ui/src/styles/tailwind/utilities.css:11-41` |

---

## Current State Snapshot

A prior change in the repo attempted to address iOS Dynamic Island background fill in PWA mode (standalone `html, body` background rules exist today in `packages/desktop/src/index.css:73-77`). However, the issue persists on the main session/chat view, indicating the prior fix **did not apply to the root app properly** in the affected scenario (notably: iOS PWA standalone cold launch). This plan treats the existing rules as a baseline and focuses on why the root app still renders incorrectly (safe-area value timing, `#root` sizing, or layout-shell coupling).

## Proposed Solution

### Strategy: Verify Existing Full-Bleed Background + Fix First-Render Safe-Area Reliability

Use the overlay pattern as a reference, but prioritize **minimal changes** that align with how the app shell works today.

1. **Verify existing full-bleed background rules** in PWA standalone mode (already present in `packages/desktop/src/index.css:66-85` and `packages/desktop/index.html:43`).
2. **Validate safe-area values and viewport sizing on cold launch** (Phase 0). If the safe-area inset values are late-updating or `#root` sizing is wrong, fix those first.
3. **Avoid moving/removing the layout wrapper padding** unless Phase 2 cannot resolve the issue; the wrapper padding currently protects all routes (`packages/desktop/src/pages/layout.tsx:686-693`) and removing it requires re-plumbing safe-area logic for multiple surfaces.

### Key Insight from Research (and how it applies here)

The general best practice remains:

```css
/* Background should extend to edges */
html,
body {
  background-color: var(--background-base);
}

/* Content should respect safe areas */
.content-wrapper {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
```

But in this codebase, the immediate question is not “should we add these rules?” (they already exist), it’s “why do we still see incorrect behavior on the main session view in iOS standalone?”

---

## Implementation Tasks

### Phase 0: Confirm Reality + Gather Evidence (before changing architecture)

- [x] **0.1** Reproduce in iOS PWA standalone with a cold start
- [x] **0.2** Validate safe-area values on cold launch vs after a lifecycle event
- [x] **0.3** Validate viewport sizing assumptions

### Phase 1: CSS Foundation Fixes (verify what already exists, then adjust)

- [x] **1.1** Confirm standalone background rules are effective
- [x] **1.2** Decide how #root should size in iOS standalone
- [x] **1.3** iOS 11 `constant()` fallback

### Phase 2: Minimal-Change Fix (prefer this over refactoring the whole layout)

- [x] **2.1** Fix “first render” safe-area correctness without moving padding everywhere
- [x] **2.2** Address header visibility specifically

### Phase 3: Layout Wrapper Refactoring (only if Phase 2 cannot solve it)

- [x] **3.1** Explicitly map all dependencies before removing wrapper padding
- [x] **3.2** If removing wrapper padding, specify exactly where padding moves

### Phase 4: Cross-Component Consistency

- [x] **4.1** Audit all fixed-position overlays for consistency
- [x] **4.2** Only add a reusable abstraction if it reduces real duplication

### Phase 5: Testing & Validation

- [ ] **5.1** Test on iOS Simulator
  - iPhone 14 Pro (Dynamic Island)
  - iPhone 13 (notch)
  - iPhone SE (no notch)
  - iPad (home indicator)

- [ ] **5.2** Test on physical device with Dynamic Island
  - Portrait mode
  - Landscape mode (both orientations)
  - Rotation between modes

- [ ] **5.3** Verify specific scenarios
  - Cold launch of installed PWA (no prior interaction)
  - App resume from background
  - Screen rotation while app is active
  - Keyboard open/close while typing in prompt input
  - Scroll behavior in chat view (including near top safe area)

---

## Affected Files

### Primary Files to Modify

| File                                     | Changes                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `packages/desktop/src/index.css`         | PWA standalone verification/adjustments (background, sizing, safe-area) |
| `packages/desktop/index.html`            | Potential `#root` sizing adjustments (currently `h-screen`)             |
| `packages/desktop/src/pages/layout.tsx`  | Header/shell safe-area strategy (minimize scope of refactor)            |
| `packages/desktop/src/pages/session.tsx` | Session prompt/footer positioning if layout strategy changes            |

### Files for Reference (no changes expected)

| File                                            | Purpose                      |
| ----------------------------------------------- | ---------------------------- |
| `packages/desktop/index.html`                   | Viewport meta, PWA meta tags |
| `packages/desktop/public/site.webmanifest`      | PWA manifest configuration   |
| `packages/ui/src/styles/tailwind/utilities.css` | Safe area utility classes    |

---

## Technical Reference

### Current Meta Tag Configuration (index.html)

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
/>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

The `viewport-fit=cover` and `black-translucent` status bar are correctly configured.

### Current CSS Variables (index.css)

```css
:root {
  --safe-area-inset-top: env(safe-area-inset-top, 0px);
  --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-inset-left: env(safe-area-inset-left, 0px);
  --safe-area-inset-right: env(safe-area-inset-right, 0px);
}
```

### Available Tailwind Utilities (utilities.css)

- `pt-safe-top` - padding-top with safe area
- `pb-safe-bottom` - padding-bottom with safe area
- `pl-safe-left` - padding-left with safe area
- `pr-safe-right` - padding-right with safe area
- `p-safe` - all safe area padding
- `mt-safe-top` - margin-top with safe area
- `mb-safe-bottom` - margin-bottom with safe area

---

## External References

### Apple Documentation

- [Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) - Official WebKit blog post on safe areas
- [env() CSS function - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/env) - CSS environment variables documentation

### Best Practices Research

- CSS-Tricks: The Notch and CSS - https://css-tricks.com/the-notch-and-css/
- Dev.to: Make Your PWAs Look Handsome on iOS - https://dev.to/karmasakshi/make-your-pwas-look-handsome-on-ios-1o08

### Key Patterns from Research

**Pattern 1: Full-bleed background with inner safe-area padding**

```css
/* Prefer background on html/body and padding on an inner wrapper */
html,
body {
  background-color: var(--background-base);
}

.content {
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
```

Note: applying safe-area padding directly on `body` can prevent true “full-bleed” background in some layouts; use an inner wrapper unless you specifically want the whole document inset.

**Pattern 2: Using max() for minimum spacing**

```css
.header {
  padding-top: max(12px, env(safe-area-inset-top));
}
```

**Pattern 3: iOS 11.0 + 11.2+ compatibility**

```css
padding-top: constant(safe-area-inset-top); /* iOS 11.0 */
padding-top: env(safe-area-inset-top); /* iOS 11.2+ */
```

**Pattern 4: @supports detection**

```css
@supports (padding: max(0px)) {
  .post {
    padding-left: max(12px, env(safe-area-inset-left));
    padding-right: max(12px, env(safe-area-inset-right));
  }
}
```

---

## Validation Criteria

### Acceptance Criteria (from issue, made testable)

- [ ] **Cold launch (installed PWA, standalone):** background color (`--background-base`) visibly fills behind the Dynamic Island (no contrasting strip/gap at the top).
- [ ] **Cold launch (installed PWA, standalone):** header content is not obscured by the Dynamic Island (top of header content is below the island safe area).
- [ ] Safe-area handling is consistent across all views (session page, mobile menu overlay, mobile tabs/file review overlay).
- [ ] No visual glitches when rotating between portrait and landscape.
- [ ] No regressions in prompt input placement (not under home indicator) and keyboard open/close behavior on iOS.
- [ ] Works correctly on:
  - [ ] iPhone 14 Pro/Pro Max and newer (Dynamic Island)
  - [ ] iPhone X/XS/11/12/13 series (notch)
  - [ ] iPads (home indicator)

### Visual Tests

1. **Cold launch background fill**: Launch installed PWA fresh (force quit first), verify background extends behind Dynamic Island with no gaps.
2. **Cold launch header visibility**: On first render, verify header content is not obscured by Dynamic Island.
3. **Overlay consistency**: Open mobile menu + mobile tabs overlays and compare safe-area behavior to the main view.
4. **Rotation**: Rotate device (both orientations), verify no gaps and content remains correctly positioned.
5. **Keyboard**: Focus the prompt input, verify keyboard open/close does not push UI under the home indicator / notch and does not reveal background gaps.
6. **Scroll**: Scroll chat content, verify it scrolls smoothly and doesn’t clip under safe areas unexpectedly.

### Regression Tests

1. **Desktop browser**: Ensure no visual changes on non-PWA desktop browsers.
2. **Android PWA**: Verify Android PWA still works correctly.
3. **Non-notch devices**: Verify older iPhones without notch still work.
4. **Session prompt placement**: Ensure the prompt input/footer UI is not obscured by the home indicator on iOS and remains usable across keyboard open/close.

---

## Rollback Plan

If the changes cause regressions:

1. Revert changes to `index.css` PWA styles
2. Revert changes to `layout.tsx` safe-area handling
3. The original safe-area padding on the layout wrapper was functional, just not ideal

---

## Notes & Decisions

### Decision: Safe-Area Strategy

**Chosen approach**: Apply background at `html`/`body`/`#root` level, apply safe-area padding at content/header level specifically.

**Rationale**: This matches how the working overlays function and follows Apple's recommended patterns.

### Consideration: iOS 11.0 Support

The `constant()` fallback for iOS 11.0 may not be necessary since:

- iOS 11.0 is very old (2017)
- Most users are on iOS 15+
- The current `env()` usage should cover virtually all users

**Decision**: Skip `constant()` fallbacks unless testing reveals issues.

### Consideration: Orientation Changes

The issue mentions problems that appear to resolve after rotating. This is a strong signal that the root problem may be **late/incorrect safe-area values or viewport sizing on first render**, not just “background applied in the wrong container”.

Possible causes:

- iOS recalculating safe areas on rotation
- `env(safe-area-inset-*)` values being `0` on cold launch and updating later
- `vh`/`h-screen` sizing differences between browser vs standalone mode

**Mitigation**: Prefer solutions that are resilient to initial incorrect values (verify `--safe-area-inset-*` behavior) and avoid broad refactors until Phase 0 confirms the true cause.
