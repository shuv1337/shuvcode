# Plan: Restore Search in Messages Feature (PR #4898)

**Date:** 2025-12-09  
**Related PR:** https://github.com/sst/opencode/pull/4898  
**Status:** IMPLEMENTED - Feature restored 2025-12-10

## Overview

This plan documents the restoration of the "Search in Messages" feature that was originally added in PR #4898. The feature allows users to press `Ctrl+F` to search through chat history with match highlighting and navigation.

## Current State Analysis

### What's Working

| Component                | File                                                            | Status                 |
| ------------------------ | --------------------------------------------------------------- | ---------------------- |
| `SearchInput` component  | `packages/opencode/src/cli/cmd/tui/component/prompt/search.tsx` | **EXISTS** (231 lines) |
| Theme strikethrough hack | `packages/opencode/src/cli/cmd/tui/context/theme.tsx`           | **EXISTS** (line 912)  |

### What's Missing

| Component                | File                                                         | Status                        |
| ------------------------ | ------------------------------------------------------------ | ----------------------------- |
| Search integration       | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | **REMOVED** by upstream merge |
| `ctrl+f` keybind handler | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | **REMOVED**                   |
| Match highlighting       | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | **REMOVED**                   |
| Match navigation         | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | **REMOVED**                   |

The `SearchInput` component exists but is orphaned - not imported or used anywhere.

## Technical Approach

### Highlighting Strategy ("Strikethrough Hack")

- For Markdown messages, inject `~~` (strikethrough) markers around matched text
- Theme renders `markup.strikethrough` as highlighted block (Primary Background / Inverse Text)
- Complex regex handles matches inside code blocks by temporarily "breaking" and restarting the block

### Scroll Navigation & Estimation

- TUI renders large markdown blocks as single components
- Estimation algorithm scrolls to specific matches within long messages
- Calculates approximate line using `match.charOffset / charsPerLine`
- Scrolls viewport to estimated Y-offset

## Implementation Tasks

### Phase 1: Add Search State and Types

- [x] Add `SearchMatch` type definition to `index.tsx`
  ```typescript
  type SearchMatch = {
    messageID: string
    partID: string
    matchIndex: number
    charOffset: number
  }
  ```
- [x] Add import for `SearchInput` and `SearchInputRef` from `@tui/component/prompt/search`
- [x] Add search-related signals:
  - [x] `searchMode: createSignal<boolean>(false)`
  - [x] `searchQuery: createSignal<string>("")`
  - [x] `currentMatchIndex: createSignal<number>(0)`
- [x] Add `matches` memo that computes `SearchMatch[]` from messages

### Phase 2: Add Search Functions

- [x] Implement `handleNextMatch()` function
- [x] Implement `handlePrevMatch()` function
- [x] Implement `scrollToMatch(index: number)` function with estimation logic

### Phase 3: Add Keyboard Handling

- [x] Add `ctrl+f` keybind handler to toggle search mode
- [x] Ensure `ESC` exits search mode and returns focus to prompt
- [x] Wire up `Up` and `Down` arrow navigation to match cycling

### Phase 4: Add Highlighter Components

- [x] Implement `SearchHighlighter` component for plain text parts
- [x] Implement `MarkdownSearchHighlighter` component for markdown with code block handling
- [x] Add regex for handling code blocks: breaks code fence, inserts highlight, restarts fence

### Phase 5: Update Context and UI

- [x] Add to context provider:
  - `searchQuery: () => string`
  - `currentMatchIndex: () => number`
  - `matches: () => SearchMatch[]`
- [x] Add conditional rendering of `SearchInput` when `searchMode()` is true
- [x] Update `UserMessage` component to use `SearchHighlighter` when search is active
- [x] Update `TextPart` component to use `MarkdownSearchHighlighter` when search is active

## Code References

### Internal Files

- `packages/opencode/src/cli/cmd/tui/component/prompt/search.tsx` - SearchInput component (exists)
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:80-89` - Context definition (needs search fields)
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1001-1095` - UserMessage component (needs highlighting)
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1203-1221` - TextPart component (needs highlighting)
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx:912` - Strikethrough hack (exists)

### External References

- Original PR: https://github.com/sst/opencode/pull/4898

## Estimated Changes

| File        | Lines Added | Lines Modified |
| ----------- | ----------- | -------------- |
| `index.tsx` | ~340        | ~20            |
| **Total**   | ~340        | ~20            |

## Validation Criteria

- [x] Pressing `Ctrl+F` activates search mode with search input visible
- [x] Typing a query highlights all matches in chat history
- [x] Match counter displays "X of Y" format (e.g., "1 of 12")
- [x] `Up` and `Down` arrows navigate between matches
- [x] Viewport scrolls to current match, including matches within long messages
- [x] `ESC` exits search mode and returns to normal prompt
- [x] Matches inside code blocks are highlighted correctly
- [x] Search works across both user and assistant messages

## Dependencies

None - the `SearchInput` component is already complete and ready to use.

## Risks & Considerations

1. **Scroll Estimation Accuracy**: The estimation algorithm for scrolling to matches within long messages achieves ~80% accuracy. Consider if more precise scrolling is needed.

2. **Code Block Handling**: The regex for handling matches inside code blocks is complex. Test thoroughly with various code block scenarios.

3. **Performance**: Match calculation runs on every keystroke. May need debouncing for very long sessions.
