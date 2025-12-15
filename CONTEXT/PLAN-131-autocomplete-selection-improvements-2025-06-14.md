# Plan: Autocomplete Selection Improvements for Desktop Prompt Input

**GitHub Issue:** [#131](https://github.com/Latitudes-Dev/shuvcode/issues/131)
**Date:** 2025-06-14
**Status:** Implementation Complete - Pending Manual Testing

## Summary

The desktop app's prompt input autocomplete for `/` (slash commands) and `@` (file mentions) has multiple UX issues that need to be addressed. This is a regression from upstream changes that broke previously working functionality.

### Issues to Resolve

1. **Tab key selection not working** - Only Enter key selects autocomplete items
2. **Mouse click selection broken** - Clicking on autocomplete items does not select them
3. **Auto-scroll not working** - The list doesn't scroll to keep the active item visible during keyboard navigation

---

## Context & Background

### Current Implementation

The autocomplete popover is implemented in `prompt-input.tsx` using a custom `For` loop rendering raw `<button>` elements. It does NOT use the `List` component from `@opencode-ai/ui/list` which already has built-in:

- Auto-scroll behavior (scrollIntoView on active item change)
- Proper mouse interaction (onMouseMove + onClick handlers)
- Keyboard navigation via the `onKeyDown` handler

The `useFilteredList` hook from `@opencode-ai/ui/hooks` is used for filtering and navigation state, but the rendering and scroll management are handled manually (incorrectly) in the popover.

### Root Cause Analysis

1. **Tab key**: The `handleKeyDown` function in `prompt-input.tsx` (line 498) only handles `ArrowUp`, `ArrowDown`, and `Enter` for popover navigation. Tab is not included.

2. **Mouse click**: The buttons in the popover have `onClick` handlers, but they may be getting intercepted or the event handling flow is broken due to the contenteditable input focus management.

3. **Auto-scroll**: Unlike the `List` component which has a `createEffect` watching `active()` and calling `scrollIntoView()`, the custom popover implementation has no such mechanism.

---

## Technical Approach

### Option A: Refactor to Use List Component (Recommended)

Replace the custom `For` loop rendering with the existing `List` component which already handles all three issues correctly.

**Pros:**

- Leverages existing, tested code
- Consistent behavior across the app
- Less custom code to maintain
- Auto-scroll and mouse handling work out of the box

**Cons:**

- Requires adapting the popover styling to work with List component's data-slot based styling
- May need to add a ref to control scrolling from outside

### Option B: Fix Custom Implementation

Add the missing functionality to the existing custom implementation:

1. Add Tab key to the keyboard handling
2. Fix mouse click event propagation
3. Add a `createEffect` to scroll active item into view

**Pros:**

- Minimal changes to existing structure
- Maintains current styling approach

**Cons:**

- Duplicates logic that already exists in List component
- More code to test and maintain
- Risk of further divergence/regressions

### Recommendation

**Option B** is recommended for this fix because:

1. The popover has specific positioning/styling that may be harder to achieve with the List component
2. The changes are relatively straightforward
3. Lower risk of unintended visual changes

---

## Implementation Details

### Files to Modify

| File                                               | Purpose                                                  |
| -------------------------------------------------- | -------------------------------------------------------- |
| `packages/desktop/src/components/prompt-input.tsx` | Main file - add Tab handling, fix click, add auto-scroll |
| `packages/ui/src/hooks/use-filtered-list.tsx`      | Optional - could add Tab support at hook level           |

### Code References

#### Current Keyboard Handling (prompt-input.tsx:497-506)

```tsx
// Handle popover navigation based on mode
if (store.popoverIsOpen && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
  if (store.popoverMode === "command") {
    commandList.onKeyDown(event)
  } else {
    onKeyDown(event)
  }
  event.preventDefault()
  return
}
```

#### useFilteredList onKeyDown (use-filtered-list.tsx:63-72)

```tsx
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    event.preventDefault()
    const selectedIndex = flat().findIndex((x) => props.key(x) === list.active())
    const selected = flat()[selectedIndex]
    if (selected) props.onSelect?.(selected, selectedIndex)
  } else {
    list.onKeyDown(event)
  }
}
```

#### Command Popover Rendering (prompt-input.tsx:740-758)

```tsx
<For each={commandList.flat()}>
  {(cmd) => (
    <button
      classList={{
        "w-full flex items-center justify-between rounded-md px-2 py-1.5": true,
        "bg-surface-raised-base-hover": commandList.active() === cmd.name,
      }}
      onClick={() => handleCommandSelect(cmd)}
    >
      ...
    </button>
  )}
</For>
```

#### Reference: List Component Auto-Scroll (list.tsx:58-67)

```tsx
createEffect(() => {
  const all = flat()
  if (store.mouseActive || all.length === 0) return
  if (active() === props.key(all[0])) {
    scrollRef()?.scrollTo(0, 0)
    return
  }
  const element = scrollRef()?.querySelector(`[data-key="${active()}"]`)
  element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
})
```

---

## Task Breakdown

### Phase 1: Tab Key Selection

- [x] **1.1** Modify `handleKeyDown` in `prompt-input.tsx` to include Tab key

  ```tsx
  if (
    store.popoverIsOpen &&
    (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter" || event.key === "Tab")
  ) {
    if (event.key === "Tab") {
      event.preventDefault() // Prevent focus change
    }
    if (store.popoverMode === "command") {
      commandList.onKeyDown(event)
    } else {
      onKeyDown(event)
    }
    event.preventDefault()
    return
  }
  ```

- [x] **1.2** Modify `onKeyDown` in `use-filtered-list.tsx` to handle Tab key

  ```tsx
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const selectedIndex = flat().findIndex((x) => props.key(x) === list.active())
      const selected = flat()[selectedIndex]
      if (selected) props.onSelect?.(selected, selectedIndex)
    } else {
      list.onKeyDown(event)
    }
  }
  ```

- [ ] **1.3** Test Tab selection for `/` commands
- [ ] **1.4** Test Tab selection for `@` file mentions
- [ ] **1.5** Verify Tab does NOT interfere when popover is closed

### Phase 2: Mouse Click Selection

- [x] **2.1** Add `onMouseDown` with `event.preventDefault()` to prevent focus loss

  ```tsx
  <button
    onMouseDown={(e) => e.preventDefault()}
    onClick={() => handleCommandSelect(cmd)}
    ...
  >
  ```

- [x] **2.2** Ensure the popover container doesn't steal focus

  ```tsx
  <div
    class="absolute inset-x-0 ..."
    onMouseDown={(e) => e.preventDefault()}
  >
  ```

- [ ] **2.3** Test mouse click selection for command items
- [ ] **2.4** Test mouse click selection for file items
- [ ] **2.5** Test scrolling the list and clicking items beyond initial view

### Phase 3: Auto-Scroll During Keyboard Navigation

- [x] **3.1** Add a ref to the popover scroll container

  ```tsx
  let popoverScrollRef: HTMLDivElement | undefined

  // In JSX:
  <div
    ref={popoverScrollRef}
    class="absolute inset-x-0 -top-3 ... overflow-auto"
  >
  ```

- [x] **3.2** Add `data-key` attribute to list items for querySelector

  ```tsx
  <button
    data-key={cmd.name}
    classList={{...}}
    ...
  >
  ```

- [x] **3.3** Add `createEffect` to scroll active item into view for command mode

  ```tsx
  createEffect(() => {
    if (!store.popoverIsOpen || store.popoverMode !== "command") return
    const activeKey = commandList.active()
    if (!activeKey || !popoverScrollRef) return

    const element = popoverScrollRef.querySelector(`[data-key="${activeKey}"]`)
    if (element) {
      element.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  })
  ```

- [x] **3.4** Add `createEffect` for file mode auto-scroll

  ```tsx
  createEffect(() => {
    if (!store.popoverIsOpen || store.popoverMode !== "file") return
    const activeKey = active()
    if (!activeKey || !popoverScrollRef) return

    const element = popoverScrollRef.querySelector(`[data-key="${activeKey}"]`)
    if (element) {
      element.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  })
  ```

- [ ] **3.5** Test keyboard navigation scrolls the list (command mode)
- [ ] **3.6** Test keyboard navigation scrolls the list (file mode)
- [ ] **3.7** Test that first item scrolls to top when active

### Phase 4: Verification & Testing

- [ ] **4.1** Verify Enter key still works as expected
- [ ] **4.2** Verify arrow key navigation still works
- [ ] **4.3** Verify Escape closes the popover
- [ ] **4.4** Test combined interactions (keyboard nav + mouse hover + click)
- [ ] **4.5** Test on different screen sizes / scroll contexts
- [ ] **4.6** Run desktop app locally and perform manual testing

---

## External References

### W3C ARIA Combobox Pattern

- **URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- **Relevance:** Standard keyboard interaction patterns for combobox/autocomplete widgets. Enter is the standard selection key; Tab is commonly used in IDE-style autocomplete.

### solid-list Package

- **NPM:** https://www.npmjs.com/package/solid-list
- **Version:** 0.3.0 (used in this project)
- **Relevance:** The underlying list navigation library used by `createList` in `useFilteredList`

### GitHub Repository References

For `scrollIntoView` usage patterns in SolidJS:

```
https://github.com/solidjs-community/solid-primitives
```

---

## Code File Paths

### Internal (Relative to Repository Root)

| File                                               | Description                                         |
| -------------------------------------------------- | --------------------------------------------------- |
| `packages/desktop/src/components/prompt-input.tsx` | Main component with autocomplete popover            |
| `packages/ui/src/hooks/use-filtered-list.tsx`      | Filtered list hook with keyboard handling           |
| `packages/ui/src/components/list.tsx`              | List component with working auto-scroll (reference) |
| `packages/ui/src/components/select-dialog.tsx`     | SelectDialog using List component (reference)       |

### External References

| URL                                                  | Description            |
| ---------------------------------------------------- | ---------------------- |
| https://github.com/Latitudes-Dev/shuvcode/issues/131 | GitHub Issue           |
| https://www.w3.org/WAI/ARIA/apg/patterns/combobox/   | W3C Combobox Pattern   |
| https://www.npmjs.com/package/solid-list             | solid-list npm package |

---

## Acceptance Criteria

From the GitHub issue:

- [ ] Pressing Tab when the autocomplete popover is open selects the currently highlighted option (same behavior as Enter)
- [ ] Tab selection works for both `/` (command) and `@` (file) autocomplete modes
- [ ] Mouse clicks on autocomplete items work reliably
- [ ] Tab key should NOT select when the popover is closed (should allow normal tab navigation)
- [ ] No regression to existing Enter key selection behavior
- [ ] No regression to existing arrow key navigation behavior
- [ ] Command list auto-scrolls to keep the active/highlighted item visible when navigating with arrow keys
- [ ] File mention list (`@`) also auto-scrolls during keyboard navigation
- [ ] Mouse click on any visible item in the scrolled list correctly selects that item

---

## Validation Steps

1. **Start the desktop app in development mode:**

   ```bash
   cd packages/desktop && bun dev
   ```

2. **Test Tab Selection:**
   - Type `/` to open command popover
   - Use arrow keys to navigate to different commands
   - Press Tab - should select the highlighted command
   - Verify the command text appears in input
   - Repeat for `@` file mentions

3. **Test Mouse Click:**
   - Type `/` to open command popover
   - Scroll down if list is long
   - Click on any visible item
   - Verify the item is selected and popover closes

4. **Test Auto-Scroll:**
   - Type `/` to open command popover (need enough commands to scroll)
   - Use arrow keys to navigate down past visible area
   - Verify list scrolls to keep active item visible
   - Navigate back up - verify scrolling works in both directions

5. **Regression Tests:**
   - Enter key still selects
   - Arrow keys still navigate
   - Escape closes popover
   - Popover closes after selection
   - Tab key does nothing when popover is closed

---

## Risk Assessment

| Risk                                         | Likelihood | Impact | Mitigation                                      |
| -------------------------------------------- | ---------- | ------ | ----------------------------------------------- |
| Changes break existing Enter key behavior    | Low        | High   | Test Enter key after each change                |
| Focus management issues with contenteditable | Medium     | Medium | Use `event.preventDefault()` on mousedown       |
| Auto-scroll causes visual jank               | Low        | Low    | Use `behavior: "smooth"` and `block: "nearest"` |
| Changes affect other parts of the app        | Low        | Medium | Changes are isolated to prompt-input.tsx        |

---

## Notes

- This was previously fixed but upstream changes caused a regression
- The `List` component in `packages/ui/src/components/list.tsx` already has all these features working correctly - consider refactoring to use it in the future
- The `SelectDialog` component uses `List` and works correctly - can be used as reference
