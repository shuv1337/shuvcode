## Summary

Update the TUI terminal window/tab title branding to match the shuvcode fork. Replace OpenCode/OC labels with shuvcode/shuv while preserving existing logic and truncation behavior.

## Issue Context and Decisions

### Source Issue

- GitHub Issue: 195 "Update terminal window/tab title from OpenCode to shuv/shuvcode"

### Current Behavior

- Home screen or default/untitled session: "OpenCode"
- Custom titled session: "OC | <session title>"
- Title is truncated to 40 characters

### Desired Behavior

- Home screen or default/untitled session: "shuvcode"
- Custom titled session: "shuv | <session title>"
- Title truncation remains 40 characters

### Plan Review Notes (Repo Alignment)

- Terminal title strings live in `packages/opencode/src/cli/cmd/tui/app.tsx:193` and `packages/opencode/src/cli/cmd/tui/app.tsx:207`; avoid touching other `OpenCode` strings used in warnings or help text.
- Keep the existing guards (`terminalTitleEnabled()` and `Flag.OPENCODE_DISABLE_TERMINAL_TITLE`) unchanged.

### Decisions and Rationale

- Preserve existing route-based title logic and truncation to minimize behavioral change.
- Only update branding strings and prefix; do not alter session detection or truncation logic.

## Requirements and Acceptance Criteria

- [x] Terminal title shows `shuvcode` when on home screen
- [x] Terminal title shows `shuvcode` when session has default/untitled title
- [x] Terminal title shows `shuv | <session title>` when session has a custom title
- [x] Title truncation behavior preserved (40 char max)

## Scope

### In Scope

- Update string literals used for terminal title branding in the TUI app

### Out of Scope

- Changes to session title generation or storage
- Changes to title truncation logic
- Any UI/UX beyond terminal title strings

## Code References (Internal)

- `packages/opencode/src/cli/cmd/tui/app.tsx`

## External References

| Purpose                                        | URL                             |
| ---------------------------------------------- | ------------------------------- |
| Upstream project reference (for parity checks) | https://github.com/sst/opencode |

## Technical Specifications

### Behavior Rules

- If `route.data.type === "home"`, set terminal title to `shuvcode`.
- If `route.data.type === "session"`:
  - If session is missing or default/untitled: set `shuvcode`.
  - Else: set `shuv | <session title>` with title truncated to 40 chars (existing logic).

### Configuration / Flags

- Respect existing checks:
  - `terminalTitleEnabled()`
  - `Flag.OPENCODE_DISABLE_TERMINAL_TITLE`

### Data Model / Integration Points

- Session lookup via `sync.session.get(route.data.sessionID)`
- Default title detection via `SessionApi.isDefaultTitle(session.title)`

## Implementation Plan

### Milestone 1: Update Branding Strings

- [x] Edit `packages/opencode/src/cli/cmd/tui/app.tsx` to replace "OpenCode" with "shuvcode" in the home route block
- [x] Edit `packages/opencode/src/cli/cmd/tui/app.tsx` to replace "OpenCode" with "shuvcode" in the default session block
- [x] Edit `packages/opencode/src/cli/cmd/tui/app.tsx` to replace `OC | ${title}` with `shuv | ${title}` in the custom session block

### Milestone 2: Verify Behavior

- [ ] Launch the TUI app and confirm terminal title shows `shuvcode` on the home screen
- [ ] Navigate to a default/untitled session and confirm terminal title shows `shuvcode`
- [ ] Navigate to a custom titled session and confirm terminal title shows `shuv | <session title>`
- [ ] Validate truncation at 40 characters still applies

## Validation Criteria

- Titles update immediately on route changes without errors
- All acceptance criteria checkboxes are satisfied
- No changes to title truncation length or behavior

## Notes / Open Questions

- None at this time
