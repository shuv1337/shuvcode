# Plan: Add Session Rename Functionality to Desktop UI

**Issue:** [#194](https://github.com/Latitudes-Dev/shuvcode/issues/194)  
**Date:** 2025-12-22  
**Type:** Enhancement  
**Priority:** Medium

## Summary

The TUI (Terminal User Interface) supports renaming sessions via a dedicated dialog component, keybind (`Ctrl+R`), and `/rename` slash command. However, the Desktop UI lacks any way to rename sessions, creating a feature gap. This plan implements session rename functionality in the Desktop UI to achieve feature parity.

## Current State

### TUI Implementation (Reference)

The TUI has full session rename support:

1. **Dialog Component:** `packages/opencode/src/cli/cmd/tui/component/dialog-session-rename.tsx`
2. **Keybind:** `Ctrl+R` in session list dialog
3. **Slash Command:** `/rename` accessible from autocomplete prompt

### Desktop UI Gap

- Users can only archive sessions, not rename them
- No rename option in sidebar session list
- No rename in session header dropdown
- No keyboard shortcut for rename
- No `/rename` slash command

### Plan Review Notes (Repo Alignment)

- There is no `packages/desktop/src/components/index.ts`; plan should use direct imports from `@/components/...`.
- `SessionItem` hover actions are not accessible on mobile; add a mobile-friendly entry point (e.g., overflow menu or long-press menu) if parity is required.
- `ctrl+r` conflicts with the browser/desktop refresh shortcut; consider `mod+shift+r` or omit a keybind and rely on palette/slash.
- If session data loads after the dialog opens, initialize the input from `session()` in an effect so the field is prefilled.

## Technical Specifications

### SDK API (Already Exists)

The SDK already supports session updates including title changes:

```typescript
// From TUI implementation
sdk.client.session.update({
  sessionID: props.session,
  title: value,
})
```

### TUI Reference Implementation

**File:** `packages/opencode/src/cli/cmd/tui/component/dialog-session-rename.tsx`

```tsx
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session))

  return (
    <DialogPrompt
      title="Rename Session"
      value={session()?.title}
      onConfirm={(value) => {
        sdk.client.session.update({
          sessionID: props.session,
          title: value,
        })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
```

### Desktop UI Integration Points

| Location                | File                                     | Lines   | Purpose                    |
| ----------------------- | ---------------------------------------- | ------- | -------------------------- |
| Sidebar Session Item    | `packages/desktop/src/pages/layout.tsx`  | 449-540 | Add rename action button   |
| Header Session Dropdown | `packages/desktop/src/pages/layout.tsx`  | 838-854 | Add rename menu option     |
| Command Registration    | `packages/desktop/src/pages/session.tsx` | 222-422 | Register command + keybind |
| Dialog Component        | New file                                 | -       | Create rename dialog       |

### Existing Dialog Patterns

Desktop app uses a consistent dialog pattern. Example from `DialogCreateProject`:

```tsx
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { createStore } from "solid-js/store"

export const DialogCreateProject: Component = () => {
  const dialog = useDialog()
  const [store, setStore] = createStore({ value: "", error: undefined })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    // ... validation and API call
    dialog.close()
  }

  return (
    <Dialog title="Add Project">
      <form onSubmit={handleSubmit}>
        <TextField
          autofocus
          value={store.value}
          onChange={(value) => setStore("value", value)}
          validationState={store.error ? "invalid" : undefined}
          error={store.error}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Dialog>
  )
}
```

### Existing Command Registration Pattern

```tsx
// packages/desktop/src/pages/session.tsx
command.register(() => [
  {
    id: "session.new",
    title: "New session",
    description: "Create a new session",
    category: "Session",
    keybind: "mod+shift+s",
    slash: "new",
    onSelect: () => navigate(`/${params.dir}/session`),
  },
  {
    id: "file.open",
    title: "Open file",
    description: "Search and open a file",
    category: "File",
    keybind: "mod+p",
    slash: "open",
    onSelect: () => dialog.show(() => <DialogSelectFile />),
  },
])
```

### Session Archive Pattern (Reference)

The archive functionality in `layout.tsx` shows how to call session update:

```tsx
const archiveSession = async (session: Session) => {
  await globalSDK.client.session.update({
    directory: session.directory,
    sessionID: session.id,
    time: { archived: Date.now() },
  })
}
```

## New Component Design

### DialogSessionRename Component

**File:** `packages/desktop/src/components/dialog-session-rename.tsx`

```tsx
import { Component, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

interface DialogSessionRenameProps {
  sessionID: string
}

export const DialogSessionRename: Component<DialogSessionRenameProps> = (props) => {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const [store, setStore] = createStore({
    value: session()?.title ?? "",
    error: undefined as string | undefined,
  })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const trimmed = store.value.trim()

    if (!trimmed) {
      setStore("error", "Session name is required")
      return
    }

    await sdk.client.session.update({
      sessionID: props.sessionID,
      title: trimmed,
    })
    dialog.close()
  }

  return (
    <Dialog title="Rename session">
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 px-5 pb-6">
        <TextField
          autofocus
          label="Session name"
          value={store.value}
          onChange={(value) => setStore({ value, error: undefined })}
          validationState={store.error ? "invalid" : undefined}
          error={store.error}
        />
        <div class="flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button type="submit">Rename</Button>
        </div>
      </form>
    </Dialog>
  )
}
```

## Implementation Tasks

### Phase 1: Create Dialog Component

- [x] **Create DialogSessionRename component**
  - File: `packages/desktop/src/components/dialog-session-rename.tsx`
  - Implementation: Form dialog with TextField, validation, SDK call, and an effect to prefill when `session()` becomes available
  - Validation: Component renders, accepts input, calls API, and pre-fills the current title
  - Note: Also created `dialog-session-rename-global.tsx` for layout.tsx (uses globalSDK)

- [x] **Add direct imports where used**
  - File: `packages/desktop/src/pages/session.tsx`, `packages/desktop/src/pages/layout.tsx`
  - Change: Import from `@/components/dialog-session-rename` and `@/components/dialog-session-rename-global`
  - Validation: Dialog opens from command and sidebar

### Phase 2: Register Command

- [x] **Add session.rename command registration**
  - File: `packages/desktop/src/pages/session.tsx`
  - Location: Inside `command.register()` callback, near other session commands
  - Properties:
    - `id`: `"session.rename"`
    - `title`: `"Rename session"`
    - `description`: `"Rename the current session"`
    - `category`: `"Session"`
    - `keybind`: `"mod+shift+r"` (avoid refresh shortcut; TUI uses Ctrl+R)
    - `slash`: `"rename"`
    - `disabled`: `!params.id` (disable when no session selected)
    - `onSelect`: Show DialogSessionRename
  - Validation: Command appears in palette, keybind works

### Phase 3: Add Sidebar Action

- [x] **Add rename button to SessionItem hover actions**
  - File: `packages/desktop/src/pages/layout.tsx`
  - Location: Inside `SessionItem` component, near archive button (~line 530)
  - Implementation: Add IconButton with "pencil-line" icon
  - Validation: Button appears on hover, opens rename dialog

- [ ] **Add mobile-friendly entry point**
  - File: `packages/desktop/src/pages/layout.tsx`
  - Location: Mobile session actions menu (or an overflow menu on the session header)
  - Implementation: Add a "Rename session" menu item that opens the dialog
  - Validation: Rename is accessible without hover on mobile
  - Note: Deferred - mobile can use slash command `/rename` or command palette

### Phase 4: Add Header Dropdown Option (Optional)

- [ ] **Add rename option to header session dropdown**
  - File: `packages/desktop/src/pages/layout.tsx`
  - Location: Header Select component (~line 838)
  - Note: May require converting Select to DropdownMenu for additional actions
  - Validation: Rename option in dropdown menu
  - Note: Deferred - slash command and palette provide access

### Phase 5: Testing

- [ ] **Test rename via command palette**
  - Steps:
    1. Open a session
    2. Open command palette (Cmd/Ctrl+K)
    3. Search for "Rename session"
    4. Select command
  - Expected: Rename dialog opens with current title pre-filled

- [ ] **Test rename via keyboard shortcut**
  - Steps:
    1. Open a session
    2. Press Ctrl+R
  - Expected: Rename dialog opens

- [ ] **Test rename via slash command**
  - Steps:
    1. Open a session
    2. Type `/rename` in prompt
    3. Press Enter
  - Expected: Rename dialog opens

- [ ] **Test rename via sidebar button**
  - Steps:
    1. Hover over session in sidebar
    2. Click rename button
  - Expected: Rename dialog opens

- [ ] **Test rename submission**
  - Steps:
    1. Open rename dialog
    2. Change session name
    3. Click Rename or press Enter
  - Expected: Dialog closes, session title updates immediately

- [ ] **Test empty name validation**
  - Steps:
    1. Open rename dialog
    2. Clear the text field
    3. Click Rename
  - Expected: Error message shown, dialog stays open

- [ ] **Test cancel functionality**
  - Steps:
    1. Open rename dialog
    2. Change name
    3. Click Cancel or press Escape
  - Expected: Dialog closes, title unchanged

- [ ] **Test real-time title update**
  - Steps:
    1. Rename session
    2. Check sidebar
    3. Check header
  - Expected: Title updates everywhere via SSE `session.updated` event

### Phase 6: Mobile Responsiveness

- [ ] **Test rename dialog on mobile**
  - Steps:
    1. Use responsive mode or mobile device
    2. Open rename dialog
    3. Test keyboard, form submission
  - Expected: Dialog is usable on small screens

- [ ] **Test sidebar rename on mobile**
  - Steps:
    1. Long-press or tap session in mobile sidebar
    2. Access rename action
  - Expected: Rename action accessible on mobile

## Validation Criteria

| Criterion                                | Validation Method         |
| ---------------------------------------- | ------------------------- |
| Rename dialog opens from command palette | Search and select command |
| Rename dialog opens with Ctrl+R          | Press keyboard shortcut   |
| Rename via /rename slash command         | Type slash command        |
| Sidebar rename button works              | Hover + click             |
| Session title updates after rename       | Visual inspection         |
| Empty name shows validation error        | Submit empty form         |
| Cancel preserves original title          | Cancel after editing      |
| Mobile-responsive dialog                 | Test on small viewport    |
| No TypeScript errors                     | `bun run typecheck`       |

## Code References

### Internal Files

**TUI Reference:**

- `packages/opencode/src/cli/cmd/tui/component/dialog-session-rename.tsx` - TUI dialog
- `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx:93-98` - Keybind registration

**Desktop Integration Points:**

- `packages/desktop/src/pages/layout.tsx:449-540` - SessionItem component
- `packages/desktop/src/pages/layout.tsx:838-854` - Header dropdown
- `packages/desktop/src/pages/session.tsx:222-422` - Command registration

**Dialog Patterns:**

- `packages/desktop/src/components/dialog-select-file.tsx`
- `packages/desktop/src/components/dialog-create-project.tsx`
- `packages/desktop/src/components/dialog-select-model.tsx`

**SDK/Sync Usage:**

- `packages/desktop/src/context/sdk.tsx` - SDK provider
- `packages/desktop/src/context/sync.tsx` - Sync context

### UI Components

- `@opencode-ai/ui/dialog` - Dialog wrapper
- `@opencode-ai/ui/text-field` - TextField component
- `@opencode-ai/ui/button` - Button component
- `@opencode-ai/ui/context/dialog` - Dialog context (useDialog)

### API Reference

```typescript
// Session update API
sdk.client.session.update({
  sessionID: string,
  title?: string,
  time?: {
    archived?: number,
    // other time fields
  }
})
```

## Notes

- The TUI uses `Ctrl+R` for rename; using the same keybind provides consistency
- The SDK API already exists and handles real-time sync via SSE events
- Session title updates should propagate automatically through existing sync mechanisms
- Consider adding optimistic update for instant feedback (before API response)
- The sidebar SessionItem may need a dropdown menu if more actions are added in future
