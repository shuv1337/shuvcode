# Plan: Restore Bash Tool Expansion & ANSI Output Feature (PR #4791)

**Date:** 2025-12-09  
**Related PR:** https://github.com/sst/opencode/pull/4791  
**Status:** IMPLEMENTED - Feature restored 2025-12-10

## Overview

This plan documents the restoration of the "Bash Tool Expansion & Colored ANSI Output" feature that was originally added in PR #4791. The feature provides:

- Full-screen viewer for bash command outputs
- ANSI color rendering for terminal output
- Output truncation in chat with "Click to view full output" button
- Forced color output from CLI tools

## Current State Analysis

### What's Missing

| Component                      | File                                                           | Status      |
| ------------------------------ | -------------------------------------------------------------- | ----------- |
| `ghostty-opentui` dependency   | `packages/opencode/package.json`                               | **MISSING** |
| `ptyToText` import             | `packages/opencode/src/tool/bash.ts`                           | **MISSING** |
| `FORCE_COLOR` env vars         | `packages/opencode/src/tool/bash.ts`                           | **MISSING** |
| `bashOutput` signal            | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | **MISSING** |
| `showBashOutput` context       | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | **MISSING** |
| Full-screen bash viewer        | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | **MISSING** |
| `ghostty-terminal` component   | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | **MISSING** |
| Keyboard navigation for viewer | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | **MISSING** |
| Bash tool truncated preview    | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | **MISSING** |
| `initialValue` prop            | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | **MISSING** |
| `text` getter on PromptRef     | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | **MISSING** |

### Current Bash Tool Rendering

The current bash tool simply strips ANSI codes and displays plain text:

```typescript
const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
// ...
<text fg={theme.text}>{output()}</text>
```

## Technical Approach

### ANSI Color Rendering

- Use `ghostty-opentui` package for terminal rendering
- `GhosttyTerminalRenderable` component renders ANSI codes properly
- `ptyToText()` processes raw PTY output

### Environment Variables for Color Output

Force CLI tools to produce colored output even when not in TTY:

```typescript
env: {
  FORCE_COLOR: "3",
  CLICOLOR: "1",
  CLICOLOR_FORCE: "1",
  TERM: "xterm-256color",
  TERM_PROGRAM: "bash-tool",
  PY_COLORS: "1",
  ANSICON: "1",
  // ... more
}
```

### Full-Screen Viewer

- Toggle between chat view and full-screen bash viewer
- Keyboard navigation: ESC to close, Page Up/Down, Home/End for scrolling
- Preserve prompt text when switching views

## Implementation Tasks

### Phase 1: Add Dependencies

- [x] Add `ghostty-opentui` to `packages/opencode/package.json`
  ```json
  "ghostty-opentui": "1.3.6"
  ```
- [x] Run `bun install` to update lockfile

### Phase 2: Update Bash Tool

- [x] Add import to `packages/opencode/src/tool/bash.ts`:
  ```typescript
  import { ptyToText } from "ghostty-opentui"
  ```
- [x] Update spawn environment variables (around line 225):
  ```typescript
  env: {
    ...process.env,
    FORCE_COLOR: "3",
    CLICOLOR: "1",
    CLICOLOR_FORCE: "1",
    TERM: "xterm-256color",
    TERM_PROGRAM: "bash-tool",
    PY_COLORS: "1",
    ANSICON: "1",
    NO_COLOR: undefined,
  }
  ```
- [x] Wrap output with `ptyToText()` before returning

### Phase 3: Update Session Index

- [x] Add `BashOutputView` type:
  ```typescript
  type BashOutputView = {
    command: string
    output: () => string
  }
  ```
- [x] Add `bashOutput` signal: `createSignal<BashOutputView | undefined>(undefined)`
- [x] Add `showBashOutput` function to context
- [x] Register `ghostty-terminal` component with opentui
- [x] Add keyboard handlers for viewer navigation (ESC, PageUp/Down, Home/End)
- [x] Add conditional rendering that switches between scrollbox and bash viewer
- [x] Add `promptDraft` signal for preserving prompt text

### Phase 4: Update Bash Tool Renderer

- [x] Update the bash tool registration (around line 1382-1404):
  - [x] Use `<ghostty-terminal>` for output preview
  - [x] Limit preview to 20 lines
  - [x] Add "Click to see full output" button when output exceeds limit
  - [x] Wire click handler to `showBashOutput`

### Phase 5: Update Prompt Component

- [ ] Add `initialValue` prop to `PromptProps` type (line 29-36) - Not needed for basic implementation
- [ ] Add `text` getter to `PromptRef` type (line 38-45) - Not needed for basic implementation
- [ ] Handle `initialValue` in `onMount` to restore prompt text - Not needed for basic implementation

## Code References

### Internal Files

- `packages/opencode/package.json` - Add ghostty-opentui dependency
- `packages/opencode/src/tool/bash.ts:225-233` - spawn() call, needs env vars
- `packages/opencode/src/tool/bash.ts:350-358` - return statement, needs ptyToText
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:80-89` - Context definition
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1382-1404` - Bash tool renderer
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:29-45` - PromptProps/PromptRef types

### External References

- Original PR: https://github.com/sst/opencode/pull/4791
- ghostty-opentui package: https://www.npmjs.com/package/ghostty-opentui

## Estimated Changes

| File               | Lines Added | Lines Modified |
| ------------------ | ----------- | -------------- |
| `package.json`     | 1           | 0              |
| `bash.ts`          | 15          | 5              |
| `index.tsx`        | ~150        | ~30            |
| `prompt/index.tsx` | 10          | 5              |
| **Total**          | ~176        | ~40            |

## Validation Criteria

- [x] `bun install` succeeds with new dependency
- [x] CLI tools produce colored output (test with `ls --color`, `git status`)
- [x] Bash output in chat shows ANSI colors (not raw escape codes)
- [x] Long outputs are truncated to 20 lines in chat preview
- [x] "Click to see full output" button appears for truncated outputs
- [x] Clicking opens full-screen bash viewer
- [x] Full-screen viewer shows complete output with colors
- [x] ESC key closes full-screen viewer
- [x] Page Up/Down, Home/End work in viewer
- [ ] Prompt text is preserved when opening/closing viewer - Minor, can be addressed later

## Dependencies

- `ghostty-opentui` npm package (needs to be added)

## Risks & Considerations

1. **Package Compatibility**: The `ghostty-opentui` package may have been updated since PR #4791. Check for any API changes.

2. **Performance**: Rendering ANSI codes in the TUI may impact performance for very large outputs. The 20-line preview helps mitigate this.

3. **Interactive Commands**: This feature does NOT support interactive commands (like `top` or `vim`). It's strictly for static output rendering.

4. **Platform Differences**: Color forcing env vars may behave differently on Windows vs Unix. Test on multiple platforms.
