**Issue:** [#138 - fix(desktop): Session tab loses left padding when session changes panel is expanded side-by-side](https://github.com/Latitudes-Dev/shuvcode/issues/138)
**Created:** 2025-12-17
**Status:** Plan Only (not yet implemented)

## Goals & Scope

### Primary Goal

Restore consistent left padding/spacing in the desktop **Session** tab so the session content does not become flush against the left edge when the **Session changes** panel is expanded side-by-side (pane mode).

### Acceptance Criteria (from issue)

- [ ] Session tab maintains consistent left padding regardless of whether session changes panel is in pane or tab mode
- [ ] Left padding is preserved between the session content and the sidebar/message rail
- [ ] Visual spacing is consistent in both layout modes
- [ ] No regression in responsive behavior on mobile/narrow screens

### Non-goals

- [ ] Do not redesign overall session layout or spacing scale
- [ ] Do not change behavior of review pane/tab switching logic
- [ ] Do not change message rail visibility rules (only shown when there are >1 user messages)
- [ ] Do not introduce new UI components; keep this as a class/padding fix

## Planning Context Capture

### What the bug looks like

In the desktop app, when review is expanded in **side-by-side pane mode**, the session’s main content loses left padding between the **SessionMessageRail** (message navigation rail) and the **SessionTurn** content container.

When review is shown in its own **tab mode**, left padding is present and the spacing looks correct/consistent.

### The layout state that triggers the bug

In `packages/desktop/src/pages/session.tsx`, the memo `wide()` drives which layout/padding strategy is used:

- `wide()` is `true` when:
  - review state is `"tab"`, OR
  - there are no diffs to display (`diffs().length === 0`)
- `wide()` is `false` when:
  - review state is `"pane"` AND diffs exist (side-by-side review visible)

Relevant internal logic:

- `packages/desktop/src/pages/session.tsx` (wide memo and `SessionTurn` class wiring)
- `packages/desktop/src/context/layout.tsx` (review layout state: `pane()` / `tab()`)

### Root cause (from issue, confirmed in code)

In `packages/desktop/src/pages/session.tsx`, the `SessionTurn` `classes.container` is conditional:

- Wide case (tab mode / no diffs): `"max-w-146 mx-auto px-4 sm:px-6"` (includes left + right padding)
- Non-wide case (pane mode w/ diffs): `"pr-4 sm:pr-6"` (RIGHT padding only)

This removes left padding entirely in the non-wide case.

### Existing spacing contributors (must be considered)

- The message rail contributes its own padding:
  - `packages/ui/src/components/session-message-rail.css` sets:
    - `padding-left: 0.5rem; padding-right: 0.25rem;` on the compact/full rail slots
- The session turn container is where we want “content gutter” padding to live:
  - `packages/ui/src/components/session-turn.tsx` applies `props.classes?.container` to the element with `data-slot="session-turn-message-container"`

### Related internal precedent

The enterprise share page uses explicit left+right padding even in non-wide layouts, with special handling when a message rail is present:

- `packages/enterprise/src/routes/share/[shareID].tsx` uses `px-6` and/or asymmetric padding (`pr-6 pl-18`) for alignment.

This suggests that “non-wide layouts still need left padding”, and sometimes need to account for rail spacing.

## Proposed Solution

### Preferred approach

Update the non-wide `SessionTurn` container class in `packages/desktop/src/pages/session.tsx` to include **left padding**.

We prefer using symmetric horizontal padding (`px-*`) to keep the gutter consistent and easy to reason about:

- Wide: `max-w-146 mx-auto px-4 sm:px-6`
- Non-wide: `px-4 sm:px-6`

This matches the spacing scale already used in the wide case and should produce consistent gap between the message rail and the session content.

### Why this approach

- It matches existing design intent in the wide state (same padding values)
- It fixes the exact regression (missing left padding)
- It minimizes scope (single conditional class string)
- It remains responsive (keeps `sm:` breakpoint behavior)

### Risks / things to verify

The issue notes a potential “double-padding” effect with the message rail.

We must verify in implementation that:

- The rail’s own right padding (`0.25rem`) plus the session content left padding (`px-4` = `1rem`) does not look excessively wide
- Spacing remains correct when:
  - sidebar is collapsed/expanded
  - message rail is not rendered (<= 1 user message)
  - narrow/mobile layouts

## Options Considered

| Option | Change                                                      | Pros                                                      | Cons                                               | Recommendation         |
| ------ | ----------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- | ---------------------- |
| A      | Add explicit left padding only: `pl-4 sm:pl-6 pr-4 sm:pr-6` | Precise and explicit                                      | More verbose; easy to drift from wide case         | Acceptable fallback    |
| B      | Use symmetric padding: `px-4 sm:px-6`                       | Matches wide case; simplest; consistent gutter            | Could feel slightly wider combined w/ rail padding | **Preferred**          |
| C      | Adjust message rail padding instead                         | Can fine-tune the rail/content gap                        | Risky; affects more views; changes nav spacing     | Only if A/B look wrong |
| D      | Use logical padding (`ps-*`/`pe-*`)                         | Better RTL readiness (Tailwind v4 supports logical props) | Repo currently uses `pl`/`pr`; inconsistent style  | Optional follow-up     |

## Technical Specifications

### State & UI integration points

| Concept                        | Location                                              | Details                                          |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------ | ------ | ----------------------- |
| Review layout state            | `packages/desktop/src/context/layout.tsx`             | `review.state()` returns `"closed"               | "pane" | "tab"`(default`closed`) |
| Session “wide” memo            | `packages/desktop/src/pages/session.tsx`              | `wide() = (layout.review.state() === "tab"       |        | !diffs().length)`       |
| Session turn container classes | `packages/desktop/src/pages/session.tsx`              | Passed as `classes.container` into `SessionTurn` |
| Message rail padding           | `packages/ui/src/components/session-message-rail.css` | `padding-left: 0.5rem; padding-right: 0.25rem;`  |

### No API / data-model changes

- This fix is purely presentational (CSS utility classes).
- No backend APIs, persisted state, or schema changes are expected.

### External references (padding utilities)

- Tailwind CSS padding utilities documentation: https://tailwindcss.com/docs/padding
- Tailwind CSS source repo (Git URL): https://github.com/tailwindlabs/tailwindcss

## Implementation Plan (Sequenced by Dependencies)

> Reminder: This is a plan only; do not implement as part of this document.

### Milestone 1 — Confirm reproduction and baseline

- [ ] 1.1 Open desktop app and navigate to a session with >1 user messages (so the message rail renders)
- [ ] 1.2 Ensure there are diffs available (so review can be opened)
- [ ] 1.3 Switch review state to `pane` (side-by-side) and confirm the session turn content becomes flush/loses left padding
- [ ] 1.4 Switch review state to `tab` and confirm left padding is restored
- [ ] 1.5 Record baseline screenshots (pane vs tab) for before/after comparison

### Milestone 2 — Apply targeted class fix

- [ ] 2.1 Update `packages/desktop/src/pages/session.tsx`:
  - [ ] 2.1.1 Locate `SessionTurn` usage where `classes.container` is computed
  - [ ] 2.1.2 Replace non-wide class string from `"pr-4 sm:pr-6"` to `"px-4 sm:px-6"` (preferred)
- [ ] 2.2 Ensure no other layout branches rely on left padding being absent
- [ ] 2.3 If the UI looks too wide after 2.1.2, switch to Option A (`pl-4 sm:pl-6 pr-4 sm:pr-6`) and re-check (only if necessary)

### Milestone 3 — Validate across layout permutations

- [ ] 3.1 Pane mode validation:
  - [ ] 3.1.1 Review = `pane`, diffs present, sidebar expanded
  - [ ] 3.1.2 Review = `pane`, diffs present, sidebar collapsed
  - [ ] 3.1.3 Confirm consistent spacing between message rail and content
- [ ] 3.2 Tab mode validation:
  - [ ] 3.2.1 Review = `tab`, diffs present
  - [ ] 3.2.2 Confirm spacing matches pane mode (no visual jump)
- [ ] 3.3 No-diffs validation:
  - [ ] 3.3.1 Ensure `diffs().length === 0` case still looks correct (wide mode)
- [ ] 3.4 Message rail visibility edge cases:
  - [ ] 3.4.1 Session with exactly 1 user message (rail hidden) should still have appropriate left padding
  - [ ] 3.4.2 Session with many user messages (rail shown) should not feel cramped or over-padded
- [ ] 3.5 Responsive checks:
  - [ ] 3.5.1 Narrow viewport (simulate mobile width) check for overflow/scroll issues
  - [ ] 3.5.2 Confirm `sm:` breakpoint behavior is preserved

### Milestone 4 — Automated checks and regression safety

- [ ] 4.1 Run typecheck:

```bash
bun turbo typecheck
```

- [ ] 4.2 Run the repo’s test task (if configured for your environment):

```bash
bun turbo opencode#test
```

- [ ] 4.3 If the desktop package has a build task, run it via turbo (optional but recommended):

```bash
bun turbo build
```

- [ ] 4.4 Ensure no formatting issues are introduced (run existing formatter if used in CI)

## Validation Criteria (Definition of Done)

### Functional / UX validation

- [ ] In pane mode, session content has a visible left gutter between message rail and content
- [ ] In tab mode, the left gutter matches pane mode (no jump)
- [ ] The change does not introduce horizontal scrollbars in the session area
- [ ] Message rail remains visually aligned and usable

### Visual regression checklist

- [ ] Spacing is consistent across themes (if the desktop app supports theme switching)
- [ ] Spacing is consistent across window sizes (small/medium/large)
- [ ] No new clipping around `SessionTurn` sticky header content

### Code review checklist

- [ ] Change is localized to `packages/desktop/src/pages/session.tsx`
- [ ] Class naming matches existing conventions in the file
- [ ] No unused imports or logic changes introduced

## Rollback Plan

- [ ] If the padding change causes undesirable spacing, revert the non-wide class to the previous value (`pr-4 sm:pr-6`) and pursue Option C (adjust rail padding) with careful cross-page verification.

## File Reference Index (Internal)

- `packages/desktop/src/pages/session.tsx`
- `packages/desktop/src/context/layout.tsx`
- `packages/ui/src/components/session-turn.tsx`
- `packages/ui/src/components/session-message-rail.tsx`
- `packages/ui/src/components/session-message-rail.css`
- `packages/enterprise/src/routes/share/[shareID].tsx` (reference pattern for non-wide padding when rail is present)
- `package.json` (workspace scripts)
- `turbo.json` (typecheck/build/test tasks)
