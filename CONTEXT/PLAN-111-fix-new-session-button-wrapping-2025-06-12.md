# Plan: Fix 'New Session' Button Text Wrapping in Narrow Windows

**Issue:** [#111](https://github.com/Latitudes-Dev/shuvcode/issues/111)
**Date:** 2025-06-12
**Status:** In Progress

## Problem Statement

In the desktop app header, the "New Session" button text wraps to 2 rows when:

- The current session name is long
- The window is narrow

This creates a visually jarring header where content wraps/overflows inside a fixed-height bar, degrading usability on small/mobile-sized widths.

## Acceptance Criteria

- [ ] "New Session" button text never wraps and does not shrink
- [ ] Session Select trigger truncates with ellipsis when space is constrained; full session title remains visible in the dropdown list
- [ ] Header content stays single-line and vertically centered within the fixed `h-12` header regardless of session/project name length
- [ ] Layout remains usable down to a defined minimum window width (proposed 360px); if narrower, non-essential header controls collapse/hide instead of forcing wrap/overflow

## Technical Analysis

### Root Cause

The issue occurs because:

1. The "New Session" button does not prevent text wrapping (`whitespace-nowrap`)
2. The button can shrink when the flex container runs out of space (missing `shrink-0`/`flex-shrink: 0`)
3. The session Select **root flex item** cannot shrink because it lacks `min-width: 0`. The current shared `Select` component applies its `class` prop to the trigger/items/content, not the root, so adding `min-w-0` to `class` has no effect on flex sizing. The trigger already has ellipsis styles; the missing piece is allowing the flex item to shrink.

### CSS Flexbox Text Truncation Pattern

Standard pattern for text truncation in flex containers ([CSS-Tricks reference](https://css-tricks.com/flexbox-truncated-text/)):

```css
/* Truncating element needs min-width: 0 to allow shrinking below content size */
.truncate {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

/* Fixed elements should not shrink */
.no-shrink {
  flex-shrink: 0;
  white-space: nowrap;
}
```

### Current Implementation

**Header flex container** (`packages/desktop/src/pages/layout.tsx:355`):

```tsx
<div class="pl-4 px-6 flex items-center justify-between gap-4 w-full">
```

**Session selector** (`packages/desktop/src/pages/layout.tsx:384-393`):

```tsx
<Select
  options={sessions()}
  current={currentSession()}
  placeholder="New session"
  label={(x) => x.title}
  value={(x) => x.id}
  onSelect={navigateToSession}
  class="text-14-regular text-text-base max-w-md"
  variant="ghost"
/>
```

**New Session button** (`packages/desktop/src/pages/layout.tsx:396-398`):

```tsx
<Button as={A} href={`/${params.dir}/session`} icon="plus-small">
  New session
</Button>
```

## Code References

### Internal Files

| File                                    | Lines   | Purpose                         |
| --------------------------------------- | ------- | ------------------------------- |
| `packages/desktop/src/pages/layout.tsx` | 338     | Header component root           |
| `packages/desktop/src/pages/layout.tsx` | 355     | Header flex container           |
| `packages/desktop/src/pages/layout.tsx` | 365-394 | Left side controls container    |
| `packages/desktop/src/pages/layout.tsx` | 366     | Inner flex container with gap-2 |
| `packages/desktop/src/pages/layout.tsx` | 384-393 | Session Select component        |
| `packages/desktop/src/pages/layout.tsx` | 395-399 | New Session button              |
| `packages/ui/src/components/select.tsx` | 1-120   | Select component definition     |
| `packages/ui/src/components/button.tsx` | 1-34    | Button component definition     |

### External References

| Resource                      | URL                                            | Purpose                               |
| ----------------------------- | ---------------------------------------------- | ------------------------------------- |
| CSS-Tricks Flexbox Truncation | https://css-tricks.com/flexbox-truncated-text/ | Reference pattern for flex truncation |

## Implementation Plan

### Task 1: Prevent Button Text Wrapping

**Goal:** Ensure the "New Session" button never wraps text to multiple lines.

**File:** `packages/desktop/src/pages/layout.tsx`

**Changes:**

- [x] Add `shrink-0` class to prevent the button from shrinking
- [x] Add `whitespace-nowrap` class to prevent text wrapping

**Before:**

```tsx
<Button as={A} href={`/${params.dir}/session`} icon="plus-small">
  New session
</Button>
```

**After:**

```tsx
<Button as={A} href={`/${params.dir}/session`} icon="plus-small" class="shrink-0 whitespace-nowrap">
  New session
</Button>
```

---

### Task 2: Enable Session Selector Truncation

**Goal:** Allow the session Select flex item to shrink so existing trigger ellipsis can take effect.

**Files:** `packages/ui/src/components/select.tsx` (shared), possibly `packages/ui/src/components/select.css` if required.

**Changes:**

- [x] Add optional `rootClass` / `rootClassList` (name TBD) props that apply to the outer Kobalte root element (`data-component="select"`).
- [x] Keep existing `class` semantics for trigger/items/content styling to avoid breaking current call sites.
- [x] Document that width/layout utilities (`min-w-0`, `grow`, `max-w-*`) should be passed via `rootClass` to prevent leaking into dropdown width.

**Rationale:** `class` currently does not reach the root flex item, and also affects dropdown content. A dedicated root class solves shrinkability without unintentionally constraining the menu.

---

### Task 3: Apply Truncation/Shrink Fix in Header

**Goal:** Ensure session (and optionally project) Selects shrink and truncate before the "New Session" button forces wrapping/overflow.

**File:** `packages/desktop/src/pages/layout.tsx`

**Changes:**

- [x] Update the session Select to use `rootClass="min-w-0 grow max-w-md"` (or wrap it in a `div` with those classes if we decide not to change `Select` API).
- [x] Keep text sizing classes on the Select trigger via `class="text-14-regular text-text-base"` so dropdown width is unaffected.
- [x] Consider applying the same root shrink pattern to the project Select if long worktree names cause similar pressure.
- [x] If needed, add `min-w-0` / `grow` to the left-side controls container so it can shrink relative to right-side fixed controls.

---

### Task 4: Decide & Implement Very-Narrow-Width Fallback

**Goal:** Make the header usable on mobile-sized widths without wrapping.

**File(s):** `packages/desktop/src/pages/layout.tsx` and any affected picker components.

**Changes:**

- [ ] Define the minimum supported header width (proposed 360px; validate during testing).
- [ ] If the header still overflows at that width, collapse non-essential right-side controls (FontPicker/ThemePicker and/or terminal toggle) into icon-only or an overflow menu consistent with existing UI patterns.

**Note:** Task 4 will be validated during manual testing. The implementation in Tasks 1-3 should handle most cases. If overflow persists at 360px, additional work may be needed.

---

### Task 5: Verify Select Truncation Styling

**Goal:** Confirm ellipsis renders in the trigger and full titles remain visible in dropdown menus.

**Note:** `packages/ui/src/components/select.css` already applies `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to the trigger value, so no new CSS is expected unless Task 2 changes reveal a gap.

---

## Testing Plan

### Manual Testing

- [ ] **Long session names:** Create sessions with very long names (50+ characters)
- [ ] **Narrow window:** Resize window down to the defined minimum supported width (proposed 360px) and verify no wrapping/overflow
- [ ] **Very narrow window:** If testing below minimum width, verify fallback behavior (collapsed controls) instead of wrapping
- [ ] **Multiple projects:** Test with multiple projects and long worktree names to ensure project selector truncation/shrink works
- [ ] **Dropdown visibility:** Ensure full session/project titles remain visible in dropdown lists
- [ ] **Regression:** Check other Select usage (agent select in prompt input) for styling/behavior regressions

### Test Scenarios

| Scenario                          | Expected Behavior                                              |
| --------------------------------- | -------------------------------------------------------------- |
| Long session name, wide window    | Session name displays fully up to max-w-md, then truncates     |
| Long session name, narrow window  | Session name truncates with ellipsis, button stays on one line |
| Short session name, narrow window | Both display normally                                          |
| No current session                | "New session" placeholder shown, button hidden                 |
| Width below minimum supported     | Non-essential controls collapse/hide, no text wrapping         |

### Browser/Platform Testing

- [ ] Test in Tauri desktop app (primary target)
- [ ] Test at various window sizes (especially minimum supported width)

## Validation Criteria

### Task 1 Complete When:

- [x] "New Session" button text never wraps regardless of window width
- [x] Button maintains its natural width and doesn't shrink

### Task 2 Complete When:

- [x] Select root accepts layout classes and can shrink as a flex item
- [x] Session names truncate with ellipsis in the trigger when space is constrained
- [x] Dropdown menus still show full titles without new width constraints

### Task 3 Complete When:

- [x] Header remains single-line with no wrapping at or above minimum supported width
- [x] Session (and project, if updated) triggers truncate smoothly as window resizes

### Task 4 Complete When:

- [ ] Minimum supported width is documented and validated
- [ ] Below that width, fallback behavior prevents wrapping/overflow

### Task 5 Complete When:

- [x] Ellipsis appears correctly for truncated values
- [x] No visual artifacts or regressions in other Select call sites

### Overall Complete When:

- [ ] All acceptance criteria from issue #111 are met
- [ ] Header content remains stable (single-line, no vertical shifts) within `h-12` at all supported widths
- [ ] No regression in existing header functionality

## Implementation Order

```
1. Task 1: Prevent Button Text Wrapping (5 min)
   └── Simple class addition, immediate visual fix

2. Task 2: Expose Select root layout classes (15–25 min)
   └── Small shared UI API change; update desktop call sites together

3. Task 3: Apply header truncation/shrink fixes (10–15 min)
   └── Use `rootClass`/wrapper patterns for Selects

4. Task 4: Very-narrow-width fallback (15–30 min, if needed)
   └── Collapse/hide non-essential controls

5. Testing (20–30 min)
   └── Manual testing across scenarios and regressions
```

**Estimated Total Time:** 60–90 minutes (depending on whether Task 4 is needed)

## Risks and Mitigations

| Risk                                                    | Likelihood | Impact | Mitigation                                                                          |
| ------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------- |
| Select root API change impacts other consumers          | Low        | Medium | Only two desktop call sites today; update both together and do a quick visual sweep |
| Width classes leak into dropdown styling                | Medium     | Medium | Keep layout sizing in `rootClass` only; verify dropdown shows full titles           |
| Very narrow widths still overflow due to fixed controls | Medium     | Medium | Define minimum supported width; implement Task 4 fallback if overflow persists      |
| Truncation hides important information                  | Low        | Low    | Full title remains visible in dropdown list; consider tooltip later if needed       |

## Notes

- The fix is mostly CSS, but requires a small shared `Select` TypeScript API tweak to expose root layout classes
- The Button component already accepts `class` prop which gets spread onto the underlying element
- The Select trigger already supports ellipsis via `packages/ui/src/components/select.css`
- `Select.class` currently applies to trigger/items/content, not the root; use `rootClass` for flex sizing
- Tailwind classes used (`shrink-0`, `whitespace-nowrap`, `min-w-0`, `grow`, `max-w-md`) are already present in the configuration
