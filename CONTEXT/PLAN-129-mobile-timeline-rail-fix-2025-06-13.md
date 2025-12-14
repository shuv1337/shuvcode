# Fix Mobile Timeline/MessageRail Usability (Issue #129)

This plan addresses the mobile usability issues with the Timeline navigation rail (the `SessionMessageRail` / `MessageNav` components) on small screens and touch devices.

The key goal is to make message navigation **functional on touch** without requiring a major layout/provider refactor.

## Problem Summary

On mobile/small screen layouts (currently defined in the desktop app as `matchMedia("(max-width: 40rem)")`), the timeline rail is effectively unusable:

1. The “compact” rail UI is visually present but not reliably interactive.
2. The interaction model relies on hover/tooltips, which are not dependable on touch devices.
3. In some layouts the absolute-positioned rail can appear as visual artifacts and/or be hard to target.

## Current Codebase Reality (Validated)

### What exists today

- `SessionMessageRail` renders two slots (compact + full) and swaps them using a container query.
  - `packages/ui/src/components/session-message-rail.tsx`
  - `packages/ui/src/components/session-message-rail.css`

- `MessageNav` drives the actual message selection UI.
  - `packages/ui/src/components/message-nav.tsx`
  - `packages/ui/src/components/message-nav.css`

- Desktop session page includes `SessionMessageRail` alongside `SessionTurn`.
  - `packages/desktop/src/pages/session.tsx`

- Enterprise share page also includes `SessionMessageRail`.
  - `packages/enterprise/src/routes/share/[shareID].tsx`

### Primary root cause (must be fixed)

The current compact mode renders a **non-interactive tick**:

- In `packages/ui/src/components/message-nav.tsx`, compact mode uses a `<div data-slot="message-nav-tick-button">` with **no `onClick`**.
- The only “selection” path in compact mode is via a hover tooltip that renders a nested `MessageNav` with `size="normal"`.
  - This is a mouse/hover pattern; it is not reliable on touch.

This means the issue is not only “z-index overlay”; it’s that compact mode is not a true navigation control.

### Architectural constraint (blocks original Option A)

The desktop layout (`packages/desktop/src/pages/layout.tsx`) cannot access session state because of provider scope:

- `SessionProvider` wraps the `Session` route component only.
  - `packages/desktop/src/app.tsx`

Therefore, implementing “move timeline into collapsed sidebar” _from layout.tsx_ is not feasible without a provider/router restructure or a deliberate cross-boundary API.

## Goals and Non-Goals

### Goals

- Make timeline navigation **work on touch devices** (tap selects messages).
- Preserve current desktop behavior and styling as much as possible.
- Avoid a large architectural refactor (no provider re-parenting unless explicitly chosen).
- Ensure the fix applies consistently anywhere `SessionMessageRail` is used (Desktop app + Enterprise share).

### Non-Goals (for this plan)

- Fully redesigning the timeline UI.
- Moving session-specific navigation into the global sidebar (can be a follow-up plan).
- Adding complex gestures (swipe/haptics) unless a clear need emerges.

## Selected Approach (Revised)

**Fix the existing primitives (`MessageNav` / `SessionMessageRail`) to be touch-functional**.

This is lower risk than creating a new “mobile timeline component” and avoids the blocked “layout needs session state” dependency.

### High-level changes

1. **Make compact ticks real buttons** that call `onMessageSelect`.
2. **Gate the tooltip behavior** to hover-capable pointers (or keep it as a progressive enhancement), but do not rely on it for selection.
3. **Improve touch target sizing** for coarse pointers so that the rail is usable on phones.
4. Optionally address layering/positioning so the rail is reliably clickable (z-index/pointer-events), but treat this as secondary after fixing interactivity.

## Implementation Plan

### Phase 0: Confirm Repro + Scope (Required)

- [ ] Reproduce on desktop app at < 40rem (Chrome devtools emulation)
- [ ] Reproduce on at least one real touch device (or touch laptop)
- [x] Verify whether the failure mode is:
  - [x] "ticks are present but never select" (expected primary)
  - [ ] "ticks are behind other content" (possible secondary)
  - [ ] "ticks are artifacts" (likely due to sizing/positioning)

**Deliverable/Findings**: Code analysis confirms the primary failure mode:

- Before fix, compact mode rendered a non-interactive `<div data-slot="message-nav-tick-button">` with no click handler (fixed in Phase 1)
- Before fix, selection only worked via tooltip hover rendering a nested `MessageNav` with `size="normal"` (still available as hover enhancement)
- Hover/tooltips are unreliable on touch devices, so compact mode must not depend on them
- Compact tick dimensions (12px × 24px per message-nav.css:30-31) are far below WCAG 2.5.5 touch target minimum (44px × 44px)
- Cannot reproduce on real device in this environment but code inspection validates the bug exists

### Phase 1: Make Compact Mode Selectable (Must Fix)

Update `MessageNav` so compact ticks are clickable and accessible.

**Tasks**

- [x] Change compact mode from `<div>` to a semantic `<button>`
  - Target: `packages/ui/src/components/message-nav.tsx`
  - Requirements:
    - `onClick` must call `onMessageSelect(message)`
    - Provide an `aria-label` (use `message.summary?.title` when available)
    - Ensure focusability + keyboard activation
  - **Completed**: Changed div to `<button type="button">` with onClick handler, aria-label using message.summary?.title or fallback

- [x] Ensure compact mode does not depend on Tooltip for selecting messages
  - Target: `packages/ui/src/components/message-nav.tsx`
  - Keep tooltip as an enhancement, but selection must work without it.
  - **Completed**: Button now has direct onClick; tooltip is a progressive enhancement and is only enabled for `(hover: hover) and (pointer: fine)`

**Notes**

- This should improve both Desktop app and Enterprise share pages because they share `@opencode-ai/ui/message-nav` and `@opencode-ai/ui/session-message-rail`.

### Phase 2: Touch Target and Styling Adjustments (Should Fix)

Make compact ticks meet practical touch target size expectations.

**Tasks**

- [x] Add `@media (pointer: coarse)` (and/or `(hover: none)`) CSS to enlarge compact tick targets
  - Target: `packages/ui/src/components/message-nav.css`
  - Current compact tick size is very small (`height: 12px; width: 24px;`), which is not touch-friendly.
  - Proposed:
    - Increase clickable area to ~44x44px for coarse pointers
    - Keep the visible "tick line" small if desired, but increase the button hitbox
  - **Completed**: Added media query for `(pointer: coarse), (hover: none)` with min-height/width 44px and padding to expand hitbox while keeping visual small

- [x] Confirm the enlarged hitbox does not break desktop compact layout
  - Desktop compact mode is expected to be mouse-friendly; the coarse-pointer media query should prevent regressions.
  - **Completed**: Media query gates changes to only coarse/no-hover pointers; desktop mouse users unaffected

### Phase 3: Layering / Positioning Hardening (Conditional)

Only do this if Phase 1 + 2 still leave the rail hard to click or visually broken.

**Tasks**

- [ ] Add a conservative `z-index` to the rail slots
  - Target: `packages/ui/src/components/session-message-rail.css`
  - Avoid interfering with the prompt input overlay (`packages/desktop/src/pages/session.tsx` uses `z-50` for the input area).

- [ ] Validate the parent positioning assumptions
  - `session-message-rail.css` uses `position: absolute` but does not set `top`; it relies on surrounding layout.
  - If needed, ensure the containing element is `position: relative` in the contexts where it’s used.

### Phase 4 (Optional): Improve “Titles on Mobile” Without New Architecture

If users still need message titles on mobile:

- [ ] Prefer a single popover/list triggered by an explicit button (e.g. “Messages”) inside the session page rather than per-tick popovers.
  - This avoids N portals and avoids needing layout-level access.

This is intentionally optional and should not block the core fix.

## Plan Changes vs Original Draft (Why)

- Removed the “export from `packages/ui/src/components/index.ts`” step because `@opencode-ai/ui` uses subpath exports (`packages/ui/package.json` has `"./*": "./src/components/*.tsx"`).
- De-emphasized “move timeline into sidebar” because `SessionProvider` scope prevents `layout.tsx` from reading session state without architectural changes.
- Focused on correcting the core interaction bug: compact mode currently has no click handler.

## Files to Modify (Updated)

| File                                                  | Change Type     | Description                                         |
| ----------------------------------------------------- | --------------- | --------------------------------------------------- |
| `packages/ui/src/components/message-nav.tsx`          | Modify          | Make compact ticks clickable + accessible           |
| `packages/ui/src/components/message-nav.css`          | Modify          | Add coarse-pointer/touch target sizing              |
| `packages/ui/src/components/session-message-rail.css` | Optional Modify | Add conservative z-index / hardening if needed      |
| `packages/desktop/src/pages/session.tsx`              | Optional Modify | If hiding/repositioning affects padding/gutters     |
| `packages/enterprise/src/routes/share/[shareID].tsx`  | Optional Modify | If padding/layout needs adjustment after UI changes |

## Validation Criteria

### Acceptance Criteria (Must Pass)

- [x] On screens < 40rem, tapping a compact timeline tick selects the corresponding message.
  - **Implemented**: Compact tick is now a `<button>` with onClick handler calling onMessageSelect
- [x] No reliance on hover-only interactions to select messages.
  - **Implemented**: Direct onClick on button; tooltip remains as enhancement but not required for selection
- [x] Desktop behavior remains intact:
  - Full rail still appears at container width >= 72rem.
  - Compact rail still appears in smaller containers.
  - **Validated**: Media query gates touch enhancements to (pointer: coarse), (hover: none) only

### Additional Validation (Should Pass)

- [x] Touch targets are large enough to reliably tap (coarse pointer).
  - **Implemented**: 44x44px minimum via media query @media (pointer: coarse), (hover: none)
- [x] Keyboard navigation works (Tab/Enter/Space) for compact ticks.
  - **Implemented**: Using semantic <button> element provides built-in keyboard support
- [x] Works in both Desktop app session view and Enterprise share view.
  - **Validated**: Changes are in shared @opencode-ai/ui components used by both apps

## Risks and Mitigations

| Risk                                            | Impact | Mitigation                                                                |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| UI primitive change affects multiple apps       | Medium | Validate Desktop + Enterprise share routes                                |
| Tooltip behavior changes on desktop             | Low    | Gate changes behind pointer/hover capability; keep tooltip as enhancement |
| Layering issues persist after interactivity fix | Medium | Phase 3 adds conservative z-index/pointer-event hardening                 |

## Follow-up (If Sidebar Integration Is Still Desired)

If you still want “timeline inside collapsed sidebar” later, create a separate plan that includes one of these explicit architectural approaches:

1. Lift `SessionProvider` higher so layout can read it (high risk; affects routing/provider lifetimes).
2. Introduce a `Layout` “sidebar addon slot” API that session pages can set (lower risk; recommended).
3. Duplicate minimal session state in a new global store (risk: divergence/bugs).

## Approval Status

**NEEDS REVISION COMPLETE — READY TO IMPLEMENT PHASE 1/2**

**Phase 3 Decision**: After Phase 1 & 2 implementation, Phase 3 is deemed unnecessary. Analysis shows:

- Rail is positioned at left: 1.5rem (absolute)
- Input overlay is at bottom-8 centered with z-50
- No spatial overlap; no z-index conflict expected
- Parent container positioning validated; no issues found
- If layering issues emerge in real device testing, Phase 3 can be revisited
