# Plan: Enable Text Selection in Desktop UI Agent Session Messages

**Issue:** [#193](https://github.com/Latitudes-Dev/shuvcode/issues/193)  
**Date:** 2025-12-22  
**Type:** Bug Fix  
**Priority:** Medium

## Summary

Text selection is disabled in the desktop app's agent session view. Users cannot select or copy text from assistant messages, user messages, or any conversation content. This makes it difficult to copy code snippets, error messages, or other content from conversations.

## Root Cause Analysis

### Global Selection Disabled

The `<body>` element has `select-none` applied globally in `packages/desktop/index.html`:

```html
<body class="antialiased overscroll-none select-none text-12-regular overflow-hidden h-full"></body>
```

This sets `user-select: none` on the entire application, providing an app-like feel where text isn't accidentally selected during interactions.

### Selective Override Pattern

Some areas override this with `select-text` class:

- File review tabs: `packages/desktop/src/pages/session.tsx:775,810,1042,1077`
- Enterprise share page: `packages/enterprise/src/routes/share/[shareID].tsx:306`

However, the main `SessionTurn` component does **not** have this override applied.

### Missing Override in SessionTurn

The `SessionTurn` component is rendered with a `classes` prop that doesn't include `select-text`:

```tsx
// packages/desktop/src/pages/session.tsx:648-658
<SessionTurn
  sessionID={params.id!}
  messageID={activeMessage()!.id}
  classes={{
    root: "pb-20 flex-1 min-w-0 h-full overflow-hidden",
    content: "pb-20",  // <-- Missing select-text!
    container: "w-full " + ...
  }}
/>
```

The `SessionTurn` component accepts these classes and applies them:

```tsx
// packages/ui/src/components/session-turn.tsx:414-415
<div data-component="session-turn" class={props.classes?.root}>
  <div ref={scrollRef} onScroll={handleScroll} data-slot="session-turn-content" class={props.classes?.content}>
```

### Plan Review Notes (Repo Alignment)

- The only desktop usage of `SessionTurn` is in `packages/desktop/src/pages/session.tsx:642`; other usages are in the enterprise share page, which already has `select-text` on a parent container.
- Keep the change localized to the desktop session page to avoid changing selection behavior in other surfaces.

## Technical Specifications

### Affected Files

| File                                          | Lines   | Current State                             |
| --------------------------------------------- | ------- | ----------------------------------------- |
| `packages/desktop/index.html`                 | 27      | Has `select-none` on body                 |
| `packages/desktop/src/pages/session.tsx`      | 648-658 | SessionTurn classes without `select-text` |
| `packages/ui/src/components/session-turn.tsx` | 414-415 | Applies classes from props                |

### Existing Pattern Examples

**File Review Tabs (with selection enabled):**

```tsx
// packages/desktop/src/pages/session.tsx:775
<Tabs.Content value="review" class="select-text flex flex-col h-full overflow-hidden contain-strict">

// packages/desktop/src/pages/session.tsx:810
<Tabs.Content value={tab} class="select-text flex flex-col h-full overflow-hidden contain-strict">
```

**Enterprise Share Page:**

```tsx
// packages/enterprise/src/routes/share/[shareID].tsx:306
<div class="select-text flex flex-col flex-1 min-h-0">
```

### CSS Classes Reference

| Class         | Effect                                         |
| ------------- | ---------------------------------------------- |
| `select-none` | `user-select: none` - Disables text selection  |
| `select-text` | `user-select: text` - Enables text selection   |
| `select-all`  | `user-select: all` - Selects all text on click |
| `select-auto` | `user-select: auto` - Browser default behavior |

## Implementation Options

### Option A: Add `select-text` to SessionTurn Content Class (Recommended)

**Location:** `packages/desktop/src/pages/session.tsx`  
**Approach:** Add `select-text` to the `content` class passed to SessionTurn

```tsx
// packages/desktop/src/pages/session.tsx:648-658
<SessionTurn
  sessionID={params.id!}
  messageID={activeMessage()!.id}
  classes={{
    root: "pb-20 flex-1 min-w-0 h-full overflow-hidden",
    content: "pb-20 select-text",  // <-- Add select-text here
    container: "w-full " + ...
  }}
/>
```

**Pros:**

- Targeted fix affecting only session messages
- Consistent with existing pattern (file review tabs)
- Minimal change, low risk

**Cons:**

- Need to apply in multiple places if SessionTurn is used elsewhere

### Option B: Add `select-text` to SessionTurn Root Class

**Approach:** Add to root instead of content

```tsx
classes={{
  root: "pb-20 flex-1 min-w-0 h-full overflow-hidden select-text",  // <-- Here
  content: "pb-20",
  container: "w-full " + ...
}}
```

**Pros:** Broader coverage including any root-level content

### Option C: Add CSS Rule to SessionTurn Component

**Location:** `packages/ui/src/components/session-turn.css` (if exists) or inline  
**Approach:** Add style at component level

```css
[data-slot="session-turn-content"] {
  user-select: text;
}
```

**Pros:**

- Centralizes the fix in the component itself
- Applies everywhere SessionTurn is used

**Cons:**

- May affect TUI or other consumers unexpectedly
- Less explicit than class-based approach

### Option D: Remove Global `select-none` (Not Recommended)

**Location:** `packages/desktop/index.html`  
**Approach:** Remove `select-none` from body, add it only where needed

**Cons:**

- High risk of unintended selection behavior across app
- Many components would need `select-none` added
- Breaking change to UI behavior

### Recommended Approach: Option A

Add `select-text` to the `content` class in SessionTurn. This is consistent with existing patterns and provides targeted enablement.

## Implementation Tasks

### Phase 1: Enable Text Selection

- [x] **Add `select-text` to desktop SessionTurn content class**
  - File: `packages/desktop/src/pages/session.tsx`
  - Line: ~652 (content class in SessionTurn classes prop)
  - Change: Add `select-text` to content class string
  - Validation: Can select text in session messages

- [x] **Add `select-text` to mobile SessionTurn (if different)**
  - File: `packages/desktop/src/pages/session.tsx`
  - Search for other SessionTurn usages
  - Change: Add `select-text` where appropriate
  - Validation: Mobile uses the same SessionTurn component (no separate usage)

### Phase 2: Testing

- [ ] **Test text selection in assistant messages**
  - Steps:
    1. Open a session with assistant messages
    2. Click and drag to select text in an assistant response
  - Expected: Text is highlighted and selectable

- [ ] **Test text selection in user messages**
  - Steps:
    1. Open a session with user messages
    2. Click and drag to select text in a user message
  - Expected: Text is highlighted and selectable

- [ ] **Test copy functionality**
  - Steps:
    1. Select some text
    2. Press Ctrl+C (or Cmd+C on Mac)
    3. Paste elsewhere
  - Expected: Text is copied to clipboard

- [ ] **Test right-click context menu**
  - Steps:
    1. Select some text
    2. Right-click on selection
  - Expected: Context menu shows "Copy" option

- [ ] **Test interactive elements remain functional**
  - Steps:
    1. Test accordion expand/collapse
    2. Test button clicks
    3. Test code block interactions
  - Expected: All interactive elements work normally

- [ ] **Test on mobile layout**
  - Steps:
    1. Use responsive mode or actual mobile device
    2. Long-press to select text
  - Expected: Text selection works on mobile

### Phase 3: Regression Testing

- [ ] **Verify file review tabs still work**
  - Steps:
    1. Open session with file changes
    2. Click on file tabs
    3. Select text in file diff view
  - Expected: Selection works as before

- [ ] **Verify no accidental selection during scrolling**
  - Steps:
    1. Scroll quickly through session messages
    2. Click/tap around the UI
  - Expected: Text isn't accidentally selected during navigation

## Validation Criteria

| Criterion                             | Validation Method             |
| ------------------------------------- | ----------------------------- |
| Text selectable in assistant messages | Click and drag to select      |
| Text selectable in user messages      | Click and drag to select      |
| Copy works (Ctrl+C / Cmd+C)           | Select, copy, paste elsewhere |
| Context menu shows Copy               | Right-click on selection      |
| Interactive elements unaffected       | Click accordions, buttons     |
| Mobile selection works                | Long-press on mobile          |
| No TypeScript errors                  | `bun run typecheck`           |

## Code References

### Internal Files

- `packages/desktop/index.html:27` - Global `select-none`
- `packages/desktop/src/pages/session.tsx:648-658` - SessionTurn classes (to modify)
- `packages/desktop/src/pages/session.tsx:775,810,1042,1077` - File tabs with `select-text`
- `packages/ui/src/components/session-turn.tsx:414-415` - Component structure

### Related Areas

Session components that may also need `select-text`:

- Summary/title text
- Code blocks within messages
- Error messages
- Tool output displays

## Notes

- The `select-none` on body is intentional for app-like UX (prevents accidental selection during interactions)
- The pattern of selectively enabling `select-text` is already established in the codebase
- Consider whether code blocks need special handling (they may already have copy buttons)
- On mobile, this enables long-press-to-select behavior
