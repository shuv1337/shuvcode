# Plan: PWA Mobile Terminal Keyboard Support and WebSocket Cleanup

**Issues:** #188, #189  
**Date:** 2025-12-22  
**Status:** Implemented

## Summary

This plan targets two PWA mobile issues that touch the terminal lifecycle:

1. **Issue #188**: Tapping the terminal does not open the mobile keyboard and the viewport does not adjust when the keyboard appears.
2. **Issue #189**: Errors or UI instability after closing the terminal pane and submitting a message.

The revised plan aligns to current terminal behavior: the terminal pane unmounts and closes its WebSocket, while PTY state is persisted in the terminal context. The plan avoids destroying PTYs on pane close and focuses on safer lifecycle guards and mobile input routing.

---

## Problem Analysis

### Issue #188: Mobile Keyboard for Terminal Pane

**Root Cause (code-aligned):** The terminal uses `ghostty-web` rendered into a `<div>` and focuses it on mount, but mobile keyboards only open for editable elements. There is no hidden input to trigger the keyboard, and no viewport resize handling for the PWA context.

**Implications:** Any mobile input solution must route characters through the same path used by real terminal input (PTY WebSocket), not via `term.write()` which is for output rendering only.

### Issue #189: WebSocket/Unmount Errors and UI Instability

**Root Cause (code-aligned):** The terminal component performs async initialization (`Ghostty.load()` and terminal build) and registers event listeners. If the pane is closed during async setup or during drag/sort unmount, cleanup ordering can leave pending callbacks acting on disposed state. The pane being closed currently only hides/unmounts the terminal; PTY state persists in the terminal context.

**Implications:** The fix should guard async init and event handlers against unmount, and ensure cleanup runs in a deterministic order. It should not delete PTYs or clear terminal state as a side effect of closing the pane.

---

## Technical Approach

### Part A: Mobile Keyboard Support (Issue #188)

#### A1: Hidden Input Element for Keyboard Trigger

Add an invisible input element overlaying the terminal that:

- Triggers the mobile keyboard on tap.
- Forwards typed characters to the PTY through the existing WebSocket path.
- Handles special keys (backspace, enter) without using `term.write()`.

Notes:

- Do not use `term.write()` for input; input must be sent to the PTY WebSocket.
- Prefer sending data to `ws.send(...)` using the same encoding the terminal uses in `term.onData`.

#### A2: Visual Viewport API Integration

Implement keyboard visibility detection and layout adjustment using:

- `window.visualViewport` events for resize/scroll.
- A JS-set CSS custom property (e.g. `--keyboard-offset`) on `:root` to drive layout.
- Fallback behavior when `visualViewport` is not available.

#### A3: Platform-Specific Handling

- iOS PWA: account for safe area, fullscreen mode, and scroll restoration on blur.
- Android PWA: handle different viewport resize timing and keyboard heights.

### Part B: WebSocket and Unmount Safety (Issue #189)

#### B1: Terminal Mounted Guard

Add an explicit mounted flag and guard all async operations and event handlers so terminal setup and cleanup are no-ops after unmount.

#### B2: Cleanup Order and Drag/Sort Unmount

Ensure terminal cleanup happens before drag/sort teardown attempts to access unmounted elements:

- Keep `DragDropProvider`/`SortableProvider` mounted when possible, or
- Defer drag/sort teardown until after terminal cleanup completes.

#### B3: Pane Close vs PTY Close

Do not destroy PTYs when the pane closes. Only close a PTY via explicit user actions (close tab) using existing terminal context APIs.

#### B4: Focus Event Isolation

Ensure blur/focus handling (e.g. prompt input blur after submit) cannot trigger state updates on disposed terminal components.

---

## Implementation Tasks

### Phase 1: Lifecycle and Cleanup Fixes (Issue #189)

- [x] **1.1** Add mounted guard in `Terminal` component
  - Add a `let isMounted = true` flag.
  - Set false in `onCleanup`.
  - Bail out of async init if unmounted.
  - Guard `ws` event handlers.

- [x] **1.2** Cleanup order hardening in `terminal.tsx`
  - Remove listeners before disposing `term`.
  - Ensure `ws.close()` runs before `term.dispose()`.
  - Avoid calling `term` APIs after dispose.

- [x] **1.3** Pane-close behavior explicitly non-destructive
  - Confirm `layout.terminal.close()` only hides the pane.
  - Do **not** add `closeAll()` or clear terminal context on pane close.

- [x] **1.4** SortableProvider unmount safety
  - Evaluate keeping `DragDropProvider` mounted and hiding content instead of unmounting.
  - If unmounting is required, ensure cleanup ordering prevents transformer access after terminal cleanup.

- [x] **1.5** Focus/blur isolation for prompt input
  - Audit `editorRef.blur()` and terminal unmount interactions.
  - Add guards so focus events cannot update disposed terminals.

### Phase 2: Mobile Keyboard Support (Issue #188)

- [x] **2.1** Create `MobileTerminalInput` component
  - Hidden input overlay positioned over terminal.
  - Captures input events and sends to PTY via WebSocket.
  - Handles enter/backspace/arrow keys (send appropriate escape sequences).

- [x] **2.2** Integrate input into `Terminal` component
  - Render only on coarse pointer devices or touch-enabled platforms.
  - Tapping the terminal focuses the hidden input.

- [x] **2.3** Add keyboard visibility hook
  - Use `visualViewport` resize events.
  - Set a CSS variable on `document.documentElement` (e.g. `--keyboard-offset`).
  - Track `isKeyboardVisible` with a threshold.

- [x] **2.4** Adjust terminal pane layout when keyboard is visible
  - Apply padding/height adjustments via the CSS variable.
  - Ensure both standard terminal pane and fullscreen mobile overlay adjust.

- [x] **2.5** Consider viewport meta updates
  - Evaluate `interactive-widget=resizes-content`.
  - Confirm compatibility with iOS PWA mode.

### Phase 3: Testing and Validation

- [x] **3.1** Open/close terminal pane on desktop
  - Verify no console errors and no leaking WebSockets.

- [x] **3.2** Submit prompt after terminal close
  - Verify UI remains stable and prompt submits normally.

- [x] **3.3** Mobile keyboard on iOS PWA
  - Tap terminal, confirm keyboard shows, input reaches PTY, viewport adjusts.

- [x] **3.4** Mobile keyboard on Android PWA
  - Same as iOS, verify consistent behavior.

- [x] **3.5** Fast-open/close stress test
  - Open terminal then close quickly to validate async init guard.

---

## Code References

### Internal Files

| File                                               | Description                                  |
| -------------------------------------------------- | -------------------------------------------- |
| `packages/desktop/src/components/terminal.tsx`     | Terminal component with WebSocket connection |
| `packages/desktop/src/context/terminal.tsx`        | Terminal context with PTY persistence        |
| `packages/desktop/src/context/layout.tsx`          | Terminal pane open/close state               |
| `packages/desktop/src/pages/session.tsx`           | Terminal pane + fullscreen overlay           |
| `packages/desktop/src/components/prompt-input.tsx` | Prompt blur on submit                        |
| `packages/desktop/src/index.css`                   | PWA/mobile styles                            |
| `packages/desktop/index.html`                      | Viewport meta tag                            |

### External References

| Resource                            | URL                                                                                                                           | Purpose                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| MDN Visual Viewport API             | https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API                                                          | Primary API for keyboard visibility     |
| MDN VirtualKeyboard API             | https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API                                                          | Modern keyboard overlay API             |
| WICG Visual Viewport Spec           | https://github.com/WICG/visual-viewport                                                                                       | Reference implementation patterns       |
| solid-dnd Repository                | https://github.com/thisbeyond/solid-dnd                                                                                       | SortableProvider implementation details |
| Fix mobile keyboard overlap article | https://dev.to/franciscomoretti/fix-mobile-keyboard-overlap-with-visualviewport-3a4a                                          | Implementation patterns                 |
| Chrome VirtualKeyboard docs         | https://developer.chrome.com/docs/web-platform/virtual-keyboard/                                                              | Chrome-specific implementation          |
| PWA keyboard handling SO            | https://stackoverflow.com/questions/71606355/pwa-does-not-resize-window-when-virtual-keyboard-is-active-on-fullscreen-display | PWA-specific solutions                  |

---

## Technical Specifications

### A. MobileTerminalInput Component API (Revised)

```tsx
// packages/desktop/src/components/mobile-terminal-input.tsx

import { Component, onCleanup, onMount } from "solid-js"
import type { Terminal as Term } from "ghostty-web"

export interface MobileTerminalInputProps {
  term: Term
  socket: WebSocket
  containerRef: HTMLDivElement
  enabled?: boolean
  onKeyboardShow?: () => void
  onKeyboardHide?: () => void
}
```

Notes:

- Input should be sent to `socket.send(...)` to reach the PTY.
- Do not use `term.write()` for input.

### B. Keyboard Visibility Hook (Revised)

```tsx
// packages/desktop/src/hooks/use-keyboard-visibility.tsx

import { createSignal, onMount, onCleanup } from "solid-js"

export function useKeyboardVisibility() {
  const [keyboardHeight, setKeyboardHeight] = createSignal(0)
  const [isKeyboardVisible, setIsKeyboardVisible] = createSignal(false)

  onMount(() => {
    if (!window.visualViewport) return

    const handleResize = () => {
      const height = window.innerHeight - window.visualViewport!.height
      const clamped = Math.max(0, height)
      setKeyboardHeight(clamped)
      setIsKeyboardVisible(clamped > 100)
      document.documentElement.style.setProperty("--keyboard-offset", `${clamped}px`)
    }

    window.visualViewport.addEventListener("resize", handleResize)
    onCleanup(() => window.visualViewport?.removeEventListener("resize", handleResize))
  })

  return { keyboardHeight, isKeyboardVisible }
}
```

### C. CSS Variable for Keyboard Offset (Revised)

```css
/* packages/desktop/src/index.css addition */

:root {
  --keyboard-offset: 0px;
}

[data-component="terminal"][data-keyboard-visible="true"] {
  padding-bottom: var(--keyboard-offset);
}
```

---

## Validation Criteria

### Issue #189 (WebSocket/Cleanup)

1. **No console errors after closing terminal pane**
2. **Message submission works after terminal close**
3. **No terminal init after immediate close** (open then close quickly)

### Issue #188 (Mobile Keyboard)

1. **Keyboard opens on terminal tap**
2. **Input reaches PTY** (commands execute, not just local render)
3. **Viewport adjusts for keyboard**
4. **Works in iOS and Android PWA**

---

## Risk Assessment

### High Risk

- iOS PWA keyboard behavior is inconsistent and requires device testing.
- Drag/sort lifecycle interactions may require structural changes.

### Medium Risk

- Input event mapping must preserve PTY semantics and special keys.
- VisualViewport may differ across browsers; fallback needed.

### Low Risk

- Desktop regression: guarded by touch detection and kept separate from desktop logic.

---

## Dependencies

- No new packages expected.
- Uses existing `ghostty-web` and PTY WebSocket path.

---

## Future Considerations

1. Alternate mobile input modes (direct vs buffered).
2. Haptic feedback on keypress.
3. Gesture support for terminal navigation.
4. Tablet-specific UX adjustments.
