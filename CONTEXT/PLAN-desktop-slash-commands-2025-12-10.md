# Desktop Slash Command Parity Plan (2025-12-10)

## Objective

Deliver user-defined slash `/` commands in the desktop app with 1:1 parity to the TUI implementation and the CLI path (`opencode run --command`), excluding TUI-only UI/menu commands.

## Current Context

### TUI Implementation (Reference)

- TUI shows slash suggestions from `sync.data.command` (SDK `command.list`) and triggers `sdk.client.session.command` when the input starts with `/name` and matches a command; otherwise it sends a normal prompt.
- Slash autocomplete only activates when `/` is typed at **cursor position 0** (`packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx:201-203`).
- Command detection logic (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:457-493`):
  ```typescript
  inputText.startsWith("/") &&
    iife(() => {
      const command = inputText.split(" ")[0].slice(1) // Extract first word without "/"
      return sync.data.command.some((x) => x.name === command) // Only SDK commands
    })
  ```
- **Fallback behavior**: If `/name` doesn't match any SDK command, it falls back to normal prompt submission (not an error).
- TUI loads commands in bootstrap: `sdk.client.command.list().then((x) => setStore("command", x.data ?? []))` (`packages/opencode/src/cli/cmd/tui/context/sync.tsx:282`).
- TUI uses custom commands defined in config plus defaults (`init`, `review`) from `packages/opencode/src/command/index.ts`.

### Desktop Implementation (Current State)

- Desktop prompt (`packages/desktop/src/components/prompt-input.tsx`) supports `@` file mentions using `useFilteredList` hook and sends prompts via `sdk.client.session.prompt`; no slash-command awareness.
- Desktop uses a **two-layer sync architecture**:
  - `packages/desktop/src/context/global-sync.tsx`: Global state with `State` type (lines 53-79) containing per-directory data
  - `packages/desktop/src/context/sync.tsx`: Per-directory wrapper with `load` object for data fetching
- Neither layer currently includes `command` in the state or load functions.
- Desktop imports types from `@opencode-ai/sdk/v2` but does NOT import `Command` type.

### SDK API Notes

- `sdk.client.command.list()` returns `Command[]` where:
  ```typescript
  type Command = {
    name: string
    description?: string
    agent?: string // Optional override
    model?: string // Optional override
    template: string
    subtask?: boolean
  }
  ```
- **Critical**: `session.command` takes `model` as a **string** (`"providerID/modelID"`), while `session.prompt` takes an object (`{ modelID, providerID }`).
- `command.executed` event is emitted **server-side** after execution; no client-side telemetry needed.

## Scope

**In scope**:

- Loading user-defined commands into desktop state
- Showing slash autocomplete with mode switching (vs `@` file mentions)
- Executing matching commands via `session.command`
- Graceful fallback to normal prompt for unknown `/commands`

**Out of scope**:

- TUI-only UI commands (`/help`, `/models`, `/theme`, `/exit`, `/new`, `/session`, etc.)
- Menu/dialog toggles
- Shell mode behavior
- Editing backend command definitions
- Client-side telemetry (handled server-side)

## Technical Plan

### 1. Data Loading

**File**: `packages/desktop/src/context/global-sync.tsx`

- [x] Add `Command` to imports from `@opencode-ai/sdk/v2` (line 1-15)
- [x] Add `command: Command[]` to the `State` type (lines 53-79):
  ```typescript
  type State = {
    // ... existing fields ...
    command: Command[] // Add this
  }
  ```
- [x] Initialize `command: []` in the `child()` function's default state (lines 95-117)

**File**: `packages/desktop/src/context/sync.tsx`

- [x] Add `command` to the `load` object (lines 15-32):
  ```typescript
  const load = {
    // ... existing loaders ...
    command: () => sdk.client.command.list().then((x) => setStore("command", x.data ?? [])),
  }
  ```
- [x] Commands load once per directory during initialization via `Promise.all(Object.values(load).map((p) => p()))`
- [x] Expose `sync.data.command` for component access (already works via store proxy)

**Optional refresh**: Piggyback on existing sync refresh pattern; no new trigger needed initially.

### 2. Prompt UX - Autocomplete

**File**: `packages/desktop/src/components/prompt-input.tsx`

- [x] Add command autocomplete state alongside file autocomplete:

  ```typescript
  const [store, setStore] = createStore<{
    popoverIsOpen: boolean
    popoverMode: "file" | "command" | null // Add mode tracking
  }>({
    popoverIsOpen: false,
    popoverMode: null,
  })
  ```

- [x] Create command filtered list using existing `useFilteredList` pattern (similar to lines 113-117):

  ```typescript
  const commandList = useFilteredList<Command>({
    items: () => sync.data.command,
    key: (x) => x.name,
    onSelect: handleCommandSelect,
  })
  ```

- [x] Modify `handleInput()` (lines 192-206) to detect slash trigger:

  ```typescript
  const handleInput = () => {
    const rawParts = parseFromDOM()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = rawParts.map((p) => p.content).join("")

    // Slash command detection - must be at start of input
    if (rawText.startsWith("/") && cursorPosition <= rawText.split(" ")[0].length) {
      const slashMatch = rawText.match(/^\/(\S*)/)
      if (slashMatch) {
        commandList.onInput(slashMatch[1])
        setStore({ popoverIsOpen: true, popoverMode: "command" })
        session.prompt.set(rawParts, cursorPosition)
        return
      }
    }

    // Existing @ file mention detection
    const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
    if (atMatch) {
      onInput(atMatch[1])
      setStore({ popoverIsOpen: true, popoverMode: "file" })
    } else if (store.popoverIsOpen) {
      setStore({ popoverIsOpen: false, popoverMode: null })
    }

    session.prompt.set(rawParts, cursorPosition)
  }
  ```

- [x] Hide autocomplete when command has arguments (parity with TUI):

  ```typescript
  // In handleInput, after slash detection:
  if (rawText.match(/^\/\S+\s+\S+/)) {
    // "/command arg" pattern
    setStore({ popoverIsOpen: false, popoverMode: null })
  }
  ```

- [x] Add command selection handler:

  ```typescript
  const handleCommandSelect = (command: Command | undefined) => {
    if (!command) return
    // Replace current input with "/commandname "
    editorRef.innerHTML = ""
    editorRef.appendChild(document.createTextNode(`/${command.name} `))
    handleInput()
    setStore({ popoverIsOpen: false, popoverMode: null })
    // Move cursor to end
    const range = document.createRange()
    range.selectNodeContents(editorRef)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }
  ```

- [x] Render command popover conditionally based on `popoverMode`:

  ```tsx
  <Show when={store.popoverIsOpen && store.popoverMode === "command"}>
    <div class="absolute inset-x-0 -top-3 -translate-y-full ...">
      <Show when={commandList.flat().length > 0} fallback={<div class="text-text-weak px-2">No matching commands</div>}>
        <For each={commandList.flat()}>
          {(cmd) => (
            <button
              classList={{
                "w-full flex items-center justify-between rounded-md p-2": true,
                "bg-surface-raised-base-hover": commandList.active() === cmd,
              }}
              onClick={() => handleCommandSelect(cmd)}
            >
              <div class="flex flex-col items-start">
                <span class="text-14-medium text-text-strong">/{cmd.name}</span>
                <Show when={cmd.description}>
                  <span class="text-12-regular text-text-weak">{cmd.description}</span>
                </Show>
              </div>
            </button>
          )}
        </For>
      </Show>
    </div>
  </Show>
  ```

- [x] Update keyboard handler to route to correct list based on mode (lines 280-296):
  ```typescript
  const handleKeyDown = (event: KeyboardEvent) => {
    if (store.popoverIsOpen && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
      if (store.popoverMode === "file") {
        onKeyDown(event)
      } else if (store.popoverMode === "command") {
        commandList.onKeyDown(event)
      }
      event.preventDefault()
      return
    }
    // ... rest unchanged
  }
  ```

### 3. Submission & Execution

**File**: `packages/desktop/src/components/prompt-input.tsx`

- [x] Modify `handleSubmit()` (lines 298-383) to branch for slash commands:

  ```typescript
  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    const prompt = session.prompt.current()
    const text = prompt.map((part) => part.content).join("")
    if (text.trim().length === 0) {
      if (session.working()) abort()
      return
    }

    // Slash command detection
    const isSlashCommand = text.startsWith("/")
    let matchedCommand: Command | undefined
    if (isSlashCommand) {
      const commandName = text.split(" ")[0].slice(1) // Remove leading "/"
      matchedCommand = sync.data.command.find((c) => c.name === commandName)
    }

    // Session creation (shared path)
    let existing = session.info()
    if (!existing) {
      const created = await sdk.client.session.create()
      existing = created.data ?? undefined
      if (existing) navigate(existing.id)
    }
    if (!existing) return

    // Clear UI (shared path)
    session.layout.setActiveTab(undefined)
    session.messages.setActive(undefined)
    editorRef.innerHTML = ""
    session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)

    if (matchedCommand) {
      // Execute as slash command
      const args = text.split(" ").slice(1).join(" ")
      sdk.client.session.command({
        sessionID: existing.id,
        command: matchedCommand.name,
        arguments: args,
        agent: local.agent.current()!.name,
        model: `${local.model.current()!.provider.id}/${local.model.current()!.id}`, // String format!
      })
    } else {
      // Execute as normal prompt (includes unknown /commands as fallback)
      const toAbsolutePath = (path: string) => (path.startsWith("/") ? path : sync.absolute(path))
      const attachments = prompt.filter((part) => part.type === "file")
      const attachmentParts = attachments.map((attachment) => {
        const absolute = toAbsolutePath(attachment.path)
        const query = attachment.selection
          ? `?start=${attachment.selection.startLine}&end=${attachment.selection.endLine}`
          : ""
        return {
          type: "file" as const,
          mime: "text/plain",
          url: `file://${absolute}${query}`,
          filename: getFilename(attachment.path),
          source: {
            type: "file" as const,
            text: { value: attachment.content, start: attachment.start, end: attachment.end },
            path: absolute,
          },
        }
      })

      sdk.client.session.prompt({
        sessionID: existing.id,
        agent: local.agent.current()!.name,
        model: {
          modelID: local.model.current()!.id,
          providerID: local.model.current()!.provider.id,
        },
        parts: [{ type: "text", text }, ...attachmentParts],
      })
    }
  }
  ```

**Key behaviors**:

- Slash commands do NOT send file attachments (attachments are only processed in the else branch)
- Unknown `/foo` commands fall back to normal prompt (no error)
- Model is passed as string `"providerID/modelID"` for commands, object for prompts

### 4. Error Handling

- [x] Wrap `session.command` call in try/catch to surface errors:
  ```typescript
  try {
    await sdk.client.session.command({ ... })
  } catch (error) {
    // Use existing toast/notification pattern if available
    console.error("Command execution failed:", error)
    // Optionally: show inline error in session messages
  }
  ```

### 5. State & Typing Updates

**File**: `packages/desktop/src/context/global-sync.tsx`

- [x] Add import: `import type { Command } from "@opencode-ai/sdk/v2"` (line ~15)
- [x] Add to State type (line ~79): `command: Command[]`
- [x] Add to child default state (line ~113): `command: []`

**No changes needed to**:

- Session pagination/limits
- Local storage persistence (commands not persisted)

## Implementation Order

1. **State setup** (30 min)
   - [x] Add `Command` type import to `global-sync.tsx`
   - [x] Add `command` to `State` type and default state
   - [x] Add `command` loader to `sync.tsx`

2. **Autocomplete UI** (2 hr)
   - [x] Add `popoverMode` state tracking
   - [x] Create `commandList` using `useFilteredList`
   - [x] Modify `handleInput()` for slash detection
   - [x] Add command popover rendering
   - [x] Update keyboard handler for mode-aware navigation

3. **Submission branching** (1 hr)
   - [x] Add command detection in `handleSubmit()`
   - [x] Implement `session.command` call with correct model format
   - [x] Ensure fallback to normal prompt for unknown commands

4. **Polish & validation** (1 hr)
   - [x] Add error handling for command execution
   - [x] Test mode switching between `@` and `/`
   - [x] Verify attachments not sent with commands
   - [x] Test empty command list gracefully handled

## Validation Criteria

- [x] Commands fetch once per workspace/directory on sync initialization without console errors
- [x] Typing `/` at position 0 opens command suggestions showing `init`, `review`, plus user-defined commands with descriptions
- [x] Autocomplete hides once a space and argument are typed (e.g., `/review main`)
- [x] Selection inserts `/name ` with trailing space and cursor at end
- [x] Entering `/init foo` sends `session.command` with `model: "providerID/modelID"` string format
- [x] Entering `/unknown bar` (non-existent command) sends normal prompt, not error
- [x] Typing `@` after clearing `/` shows file suggestions (mode switching works)
- [x] File attachments work normally; attachments are NOT sent with slash commands
- [x] Results match CLI `opencode run --command <name> ...` for same command+args

## Decisions Made

- **Telemetry**: Server-side `command.executed` event already emitted; no client-side telemetry needed
- **Command refresh**: Initial load only; manual refresh via existing sync pattern if needed later
- **Error surface**: Console error + optional toast; no inline banner for v1
- **Command agent/model overrides**: Pass current agent/model; server handles override logic

## References

| Component                | File                                                                  | Lines                         |
| ------------------------ | --------------------------------------------------------------------- | ----------------------------- |
| TUI slash detection      | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`        | 457-493                       |
| TUI autocomplete trigger | `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | 201-203, 428                  |
| TUI command loading      | `packages/opencode/src/cli/cmd/tui/context/sync.tsx`                  | 282                           |
| Command definitions      | `packages/opencode/src/command/index.ts`                              | 23-35                         |
| SDK Command type         | `packages/sdk/js/src/v2/gen/types.gen.ts`                             | 1460-1467                     |
| SDK session.command      | `packages/sdk/js/src/v2/gen/sdk.gen.ts`                               | 1318-1356                     |
| Desktop prompt           | `packages/desktop/src/components/prompt-input.tsx`                    | Full file                     |
| Desktop global-sync      | `packages/desktop/src/context/global-sync.tsx`                        | 53-79 (State), 95-117 (child) |
| Desktop sync             | `packages/desktop/src/context/sync.tsx`                               | 15-32 (load)                  |
| useFilteredList hook     | `packages/ui/src/hooks/use-filtered-list.tsx`                         | -                             |
