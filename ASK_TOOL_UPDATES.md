# Ask tool updates (PR 5563 follow-ups)

This document summarizes the local changes we made after integrating the Ask tool and reviewing UX feedback.

## Goals

- Make Ask behave like users expect coming from Claude Code:
  - `plan` can ask interactive questions by default.
  - Other agents should not unexpectedly pop interactive dialogs by default.
- Fix poor UX on small terminals and with long / multi-question prompts:
  - Prevent dialogs from rendering off-screen.
  - Make scrollability obvious (visual indicators + keyboard hints).

## Tool enablement defaults

### Default behavior

- `ask` is **enabled by default for the built-in `plan` agent**.
- `ask` is **disabled by default for other agents** (including `build` and subagents).
- We explicitly disable `ask` for hidden primary agents like `title` and `summary` to avoid surprise interactive dialogs in background flows.

Implementation:

- `packages/opencode/src/agent/agent.ts`

### Config overrides

The global config `tools` map still has the final word:

- Disable Ask everywhere:

```json
{
  "tools": { "ask": false }
}
```

- Enable Ask everywhere:

```json
{
  "tools": { "ask": true }
}
```

Notes:

- The built-in `plan` agent starts with `ask: true`, but a config value of `tools.ask: false` will override it.

Tests:

- `packages/opencode/test/config/config.test.ts`

## Plan mode guidance

We also updated the plan-mode reminder prompt to encourage using the interactive Ask tool when it’s available:

- `packages/opencode/src/session/prompt/plan.txt`

This helps keep the “planning phase” interactive without requiring the user to manually switch modes or respond to multiple free-form questions.

## TUI Ask dialog UX fixes

### Problem

In real usage, the Ask dialog could:

- Render multiple questions in a single dialog, causing the content to extend below the terminal.
- Render long option lists without any visible hint that more options exist.

### Improvements

#### 1) Scrollable question list (multi-question dialogs)

- The Ask dialog body is now a `scrollbox` with a max height derived from terminal size.
- We show `↑ more questions` / `↓ more questions` indicators when the list overflows.
- Keyboard hints are shown in the footer (tab/scroll/submit) to improve discoverability.

Implementation:

- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question.tsx`

#### 2) Collapsed non-active questions

To reduce vertical space, only the active question is expanded.
Non-active questions render as a single-line row with:

- a small “caret” affordance (e.g. `▸ 3.`)
- the question message (truncated)
- a short preview of the current answer (truncated)

This keeps multi-question prompts usable even on small screens.

Implementation:

- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question.tsx`

#### 3) Scrollable option lists + “more options” indicators

For questions with long option lists:

- `select` options are rendered in a scrollbox.
- We show `↑ more options` / `↓ more options` when the list is truncated.
- We also show a small hint line (e.g. “↑/↓ navigate • pgup/pgdn jump”) when scrolling is possible.

Implementation:

- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-select.tsx`

#### 4) Multi-select navigation + scroll indicators

Multi-select previously didn’t actually support keyboard navigation (focus was effectively stuck).
Now it:

- Tracks focused option.
- Supports `↑/↓`, `pgup/pgdn`, `home/end` navigation.
- Uses `space` to toggle.
- Shows `↑ more options` / `↓ more options` indicators when truncated.

Implementation:

- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-multi-select.tsx`

## Keyboard cheatsheet

- Multi-question dialog:
  - `tab` / `shift+tab`: next/prev question
  - `ctrl+u` / `ctrl+d`: scroll question list
  - `enter`: submit (or cancel if cancel button is focused)

- `select` question:
  - `↑/↓`: navigate options
  - `pgup/pgdn`: jump
  - `home/end`: top/bottom

- `multi-select` question:
  - `↑/↓`: move focus
  - `space`: toggle focused option
  - `pgup/pgdn`, `home/end`: jump

## Validation

We validated these changes with:

- `bun run --cwd packages/opencode typecheck`
- `bun --cwd packages/opencode test`

## Files changed

- `packages/opencode/src/agent/agent.ts`
- `packages/opencode/src/session/prompt/plan.txt`
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-select.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-question/dialog-question-multi-select.tsx`
- `packages/opencode/test/config/config.test.ts`
