# Plan: TUI Session Header Toggle via Command Palette

**Issue**: [#107 - Add command palette toggle to hide the session header (title/token/share bar) on small screens](https://github.com/Latitudes-Dev/shuvcode/issues/107)  
**Created**: 2025-01-09  
**Status**: Planning

---

## Overview

Add command palette actions to hide/show the session header bar in the **TUI app**. When the sidebar is hidden (on narrow terminals or when manually hidden), the TUI displays a header bar at the top showing the session title, token count, cost, and share URL. This header consumes vertical space that users may want to reclaim on small screens.

---

## Context & Technical Analysis

### Current Implementation

The TUI session view conditionally renders the header and footer when the sidebar is **not** visible:

```tsx
// packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:969-972
<Show when={!sidebarVisible()}>
  <Header />
</Show>

// packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1131-1133
<Show when={!sidebarVisible()}>
  <Footer />
</Show>
```

The `sidebarVisible()` logic (lines 206-211):

```tsx
const sidebarVisible = createMemo(() => {
  if (session()?.parentID) return false // Always hide for subagent sessions
  if (sidebar() === "show") return true // Manual show
  if (sidebar() === "auto" && wide()) return true // Auto-show on wide terminals
  return false
})
```

### Header Component Structure

The header (`packages/opencode/src/cli/cmd/tui/routes/session/header.tsx`) displays:

- Session title (with `#` prefix)
- Token count and context percentage
- Session cost
- Share URL or `/share` prompt (when sharing is enabled)
- For subagent sessions: parent/prev/next navigation hints

The header takes ~3-4 terminal lines depending on share status.

### Footer Component Structure

The footer (`packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx`) displays:

- Current directory
- LSP/MCP status indicators
- Permission count (when applicable)
- `/connect` prompt for new users

The footer takes 1 terminal line.

### Existing State Management Patterns

The TUI uses a KV store (`packages/opencode/src/cli/cmd/tui/context/kv.tsx`) for persisting UI preferences:

```tsx
// Examples from index.tsx
const [sidebar, setSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("sidebar", "auto"))
const [showThinking, setShowThinking] = createSignal(kv.get("thinking_visibility", true))
const [showTimestamps, setShowTimestamps] = createSignal(kv.get("timestamps", "hide") === "show")
const [usernameVisible, setUsernameVisible] = createSignal(kv.get("username_visible", true))
const [showDetails, setShowDetails] = createSignal(kv.get("tool_details_visibility", true))
const [showScrollbar, setShowScrollbar] = createSignal(kv.get("scrollbar_visible", false))
const [showTokens, setShowTokens] = createSignal(kv.get("show_tokens", false))
```

### Command Registration Pattern

Commands are registered via `useCommandDialog().register()` returning an array of `CommandOption` objects:

```tsx
// packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:332-892
command.register(() => [
  {
    title: "Toggle sidebar",
    value: "session.sidebar.toggle",
    keybind: "sidebar_toggle",
    category: "Session",
    onSelect: (dialog) => {
      /* toggle logic */
    },
  },
  // ... more commands
])
```

### Relevant Code References

| File                                                             | Purpose                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`     | Main session route with header/footer rendering logic |
| `packages/opencode/src/cli/cmd/tui/routes/session/header.tsx`    | Header component (title, tokens, share)               |
| `packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx`    | Footer component (dir, LSP/MCP status)                |
| `packages/opencode/src/cli/cmd/tui/context/kv.tsx`               | KV store for persisting UI preferences                |
| `packages/opencode/src/cli/cmd/tui/component/dialog-command.tsx` | Command palette infrastructure                        |
| `packages/opencode/src/config/config.ts`                         | Config schema including KeybindsConfig                |
| `packages/sdk/js/src/v2/gen/types.gen.ts`                        | KeybindsConfig type definition                        |

---

## Design Decisions

### State Model

**Option A**: Single boolean for header visibility

- Simpler, just `headerVisible: boolean`
- Default: `true`

**Option B**: Tri-state like sidebar (`"show" | "hide" | "auto"`)

- More flexible, could auto-hide on very small terminals
- Adds complexity

**Recommendation**: **Option A** - A simple boolean is sufficient. The header is already conditionally rendered based on sidebar visibility. Adding a separate toggle provides the control users need without over-engineering.

### What to Toggle

**Option A**: Toggle header only

- Just the title/token/share bar at the top
- Footer remains visible (1 line, provides useful status info)

**Option B**: Toggle both header and footer

- Maximum space recovery
- Risk: users lose visibility into LSP/MCP status

**Option C**: Separate toggles for header and footer

- Most flexible
- May be overkill for this issue

**Recommendation**: **Option A** - Toggle header only for this issue. The footer is minimal (1 line) and provides valuable status info. A separate footer toggle could be added later if requested.

### Default State

The header should be **visible by default** to maintain backward compatibility. Users who want more space can toggle it off.

### Compact Fallback

When the header is hidden, critical info (token count, cost) is still available via:

1. The sidebar (when visible)
2. The `/status` command
3. The command palette could show a status line

No compact fallback UI is necessary in the main view.

---

## Implementation Tasks

### Phase 1: Add State and Persistence

- [ ] **1.1** Add header visibility state signal in session route
  - File: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
  - Add after line 144 (near other visibility state):
    ```tsx
    const [headerVisible, setHeaderVisible] = createSignal(kv.get("header_visible", true))
    ```

### Phase 2: Update Header Rendering Logic

- [ ] **2.1** Update conditional rendering to include header visibility state
  - File: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
  - Modify line 969-972 from:
    ```tsx
    <Show when={!sidebarVisible()}>
      <Header />
    </Show>
    ```
    to:
    ```tsx
    <Show when={!sidebarVisible() && headerVisible()}>
      <Header />
    </Show>
    ```

### Phase 3: Register Command Palette Actions

- [ ] **3.1** Add toggle command to session command registration
  - File: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
  - Add to the `command.register()` array (after sidebar toggle ~line 508):
    ```tsx
    {
      title: headerVisible() ? "Hide session header" : "Show session header",
      value: "session.header.toggle",
      keybind: "header_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setHeaderVisible((prev) => {
          const next = !prev
          kv.set("header_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    ```

### Phase 4: Add Keybind Configuration

- [ ] **4.1** Add `header_toggle` to KeybindsConfig schema
  - File: `packages/opencode/src/config/config.ts`
  - Add to keybinds object (around line 500):
    ```typescript
    header_toggle: {
      description: "Toggle session header visibility",
      type: "string",
    },
    ```

- [ ] **4.2** Update SDK types (auto-generated)
  - The SDK types in `packages/sdk/js/src/v2/gen/types.gen.ts` are generated from the OpenAPI spec
  - Run type generation after config.ts changes

- [ ] **4.3** Set default keybind (optional)
  - If a default keybind is desired, add to config defaults
  - Suggested: `ctrl+h` or leave unbound (accessible via command palette only)

### Phase 5: Testing & QA

- [ ] **5.1** Test header toggle functionality
  - Start TUI with sidebar hidden (narrow terminal)
  - Open command palette (`Ctrl+P` or configured key)
  - Search for "header"
  - Select "Hide session header"
  - Verify header disappears
  - Repeat to show header
  - Verify header reappears

- [ ] **5.2** Test state persistence
  - Hide header
  - Restart TUI
  - Verify header remains hidden
  - Show header
  - Restart TUI
  - Verify header remains visible

- [ ] **5.3** Test interaction with sidebar toggle
  - With sidebar visible: header should not be shown (regardless of headerVisible state)
  - Hide sidebar: header visibility should respect headerVisible state
  - Show sidebar: header should hide again

- [ ] **5.4** Test on small terminal sizes
  - Verify no layout issues when header is hidden
  - Verify prompt input area not affected
  - Verify scrollbox still functions correctly

- [ ] **5.5** Test keybind (if configured)
  - Press configured keybind
  - Verify header toggles

---

## File Changes Summary

| File                                                         | Change Type | Description                                                       |
| ------------------------------------------------------------ | ----------- | ----------------------------------------------------------------- |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | Modify      | Add headerVisible state, update rendering logic, register command |
| `packages/opencode/src/config/config.ts`                     | Modify      | Add header_toggle keybind config                                  |

---

## Validation Criteria

### Acceptance from Issue

- [x] Command palette shows an action to hide the session header and another to show/restore it
  - Implemented as single toggle command that shows appropriate label based on state
- [ ] Toggling immediately hides/shows the sticky header area in the session view (no layout shift breaking the chat pane)
- [ ] Token usage and share affordances remain accessible when the header is hidden (compact fallback is acceptable)
  - Accessible via sidebar (when shown) or `/status` command
- [ ] Works on small window sizes without overlapping the chat input or message area

### Additional Validation

- [ ] State persists across TUI restarts
- [ ] Header toggle respects sidebar visibility (only applies when sidebar hidden)
- [ ] Command appears in command palette with searchable terms

---

## Code Changes Detail

### index.tsx - State Addition

```tsx
// After line 144 (near showTokens signal)
const [headerVisible, setHeaderVisible] = createSignal(kv.get("header_visible", true))
```

### index.tsx - Rendering Logic Update

```tsx
// Line 969-972 - Update from:
<Show when={!sidebarVisible()}>
  <Header />
</Show>

// To:
<Show when={!sidebarVisible() && headerVisible()}>
  <Header />
</Show>
```

### index.tsx - Command Registration

```tsx
// Add to command.register() array, after sidebar toggle command (~line 508)
{
  title: headerVisible() ? "Hide session header" : "Show session header",
  value: "session.header.toggle",
  keybind: "header_toggle",
  category: "Session",
  onSelect: (dialog) => {
    setHeaderVisible((prev) => {
      const next = !prev
      kv.set("header_visible", next)
      return next
    })
    dialog.clear()
  },
},
```

### config.ts - Keybind Schema

```typescript
// Add to keybinds schema object
header_toggle: {
  description: "Toggle session header visibility",
  type: "string",
},
```

---

## Open Questions

1. **Default keybind**: Should there be a default keyboard shortcut for header toggle?
   - If yes, suggest `ctrl+h` (H for header)
   - If no, users can configure via `keybinds.header_toggle` in config

2. **Footer toggle**: Should we also add a separate toggle for the footer?
   - Could be a future enhancement if users request it

3. **Status bar alternative**: When header is hidden, should there be a minimal status indicator in the footer showing token count?
   - The footer already shows `/status` hint which provides full info

---

## Dependencies

- No new npm dependencies required
- Uses existing KV store for persistence
- Uses existing command palette infrastructure

---

## Notes

- The implementation follows existing patterns for toggleable UI elements (sidebar, scrollbar, tool details, etc.)
- The toggle command dynamically updates its title based on current state (`headerVisible() ? "Hide..." : "Show..."`)
- State is persisted to `$STATE_DIR/kv.json` along with other UI preferences
- The keybind is optional - the feature is fully accessible via command palette
