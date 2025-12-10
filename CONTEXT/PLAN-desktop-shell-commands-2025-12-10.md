# Desktop Shell Command Implementation Plan (2025-12-10)

## Objective

Add user-initiated shell command support with `!` prefix to the desktop app (`packages/desktop`), matching the TUI implementation for feature parity.

## Background

The TUI allows users to run shell commands directly by typing `!` at the start of input, which enters "shell mode". When submitted, the command executes in the user's default shell and output streams to the session in real-time. This is distinct from AI-invoked bash commands (which have permission checks) - user shell commands run directly without validation since the user explicitly typed them.

## Current Context

### TUI Implementation (Reference)

**Shell mode detection** (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:722-733`):

```typescript
if (e.name === "!" && input.visualCursor.offset === 0) {
  setStore("mode", "shell")
  e.preventDefault()
  return
}
if (store.mode === "shell") {
  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
    setStore("mode", "normal")
    e.preventDefault()
    return
  }
}
```

**Key behaviors**:

- `!` only triggers shell mode when typed at **cursor position 0**
- The `!` character is NOT inserted into the input (prevented)
- Shell mode is exited via:
  - `backspace` at position 0
  - `escape` key
- Mode stored in component state: `mode: "normal" | "shell"`

**Shell mode submission** (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:451-461`):

```typescript
if (store.mode === "shell") {
  sdk.client.session.shell({
    sessionID,
    agent: local.agent.current().name,
    model: {
      providerID: selectedModel.providerID,
      modelID: selectedModel.modelID,
    },
    command: inputText,
  })
  setStore("mode", "normal")
}
```

**Visual indicator** (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:832-842`):

```typescript
<text fg={highlight()}>
  {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}
</text>
```

### Server-side Execution

**File**: `packages/opencode/src/session/prompt.ts:1209-1401`

The `SessionPrompt.shell()` function:

1. Creates user message with synthetic text: "The following tool was executed by the user"
2. Creates assistant message with a `bash` tool part in `"running"` state
3. Determines shell from environment (`$SHELL`, `$COMSPEC`, or fallback)
4. Spawns shell process with appropriate invocation pattern:
   - `bash`/`zsh`: `-c -l` with RC file sourcing
   - `fish`/`nu`: `-c`
   - `cmd.exe`: `/c`
   - `powershell.exe`: `-NoProfile -Command`
5. Streams stdout/stderr to the tool part's `metadata.output`
6. Marks part as `"completed"` when process exits

**Important**: No permission checks - user-initiated shell commands run directly.

### SDK API

**File**: `packages/sdk/js/src/v2/gen/sdk.gen.ts:1363-1400`

```typescript
public shell<ThrowOnError extends boolean = false>(
  parameters: {
    sessionID: string
    directory?: string
    agent?: string
    model?: {
      providerID: string
      modelID: string
    }
    command?: string
  },
  options?: Options<never, ThrowOnError>,
)
```

**Endpoint**: `POST /session/{sessionID}/shell`

### Desktop Current State

**File**: `packages/desktop/src/components/prompt-input.tsx`

- Already implements `/` slash command mode with `popoverMode: "file" | "command" | null`
- Uses `handleInput()` for mode detection based on input content
- Uses `handleKeyDown()` for keyboard navigation
- Uses `handleSubmit()` for form submission with command branching
- No shell mode awareness currently

## Scope

**In scope**:

- Detecting `!` at cursor position 0 to enter shell mode
- Visual indicator showing "Shell" mode vs agent name
- Exiting shell mode via backspace at position 0 or escape
- Submitting shell commands via `sdk.client.session.shell()`
- Proper mode cleanup after submission

**Out of scope**:

- Permission checks (intentionally bypassed for user commands)
- Command history specific to shell mode
- Shell autocomplete/suggestions
- Custom shell selection UI

## Technical Plan

### 1. State Management Updates

**File**: `packages/desktop/src/components/prompt-input.tsx`

- [x] Extend store to track shell mode:

  ```typescript
  const [store, setStore] = createStore<{
    popoverIsOpen: boolean
    popoverMode: "file" | "command" | null
    inputMode: "normal" | "shell" // Add this
  }>({
    popoverIsOpen: false,
    popoverMode: null,
    inputMode: "normal", // Add this
  })
  ```

### 2. Shell Mode Detection

**File**: `packages/desktop/src/components/prompt-input.tsx`

- [x] Add shell mode entry detection in `handleKeyDown()`:

  ```typescript
  const handleKeyDown = (event: KeyboardEvent) => {
    // Shell mode entry - ! at position 0
    if (event.key === "!" && getCursorPosition(editorRef) === 0 && store.inputMode === "normal") {
      event.preventDefault()
      setStore("inputMode", "shell")
      return
    }

    // Shell mode exit - backspace at position 0 or escape
    if (store.inputMode === "shell") {
      if (event.key === "Escape") {
        event.preventDefault()
        setStore("inputMode", "normal")
        return
      }
      if (event.key === "Backspace" && getCursorPosition(editorRef) === 0) {
        event.preventDefault()
        setStore("inputMode", "normal")
        return
      }
    }

    // Existing popover navigation...
    if (store.popoverIsOpen && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
      // ... existing code ...
    }
    // ... rest of handler ...
  }
  ```

- [x] Disable popover modes while in shell mode - modify `handleInput()`:

  ```typescript
  const handleInput = () => {
    const rawParts = parseFromDOM()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = rawParts.map((p) => p.content).join("")

    // Skip autocomplete detection in shell mode
    if (store.inputMode === "shell") {
      session.prompt.set(rawParts, cursorPosition)
      return
    }

    // Existing slash command detection...
    // Existing @ file mention detection...
  }
  ```

### 3. Visual Mode Indicator

**File**: `packages/desktop/src/components/prompt-input.tsx`

- [x] Add visual indicator in the prompt UI. Locate the model/agent selector area and add mode-aware display:

  ```tsx
  {/* In the bottom toolbar area of the prompt */}
  <Show when={store.inputMode === "shell"}>
    <div class="flex items-center gap-1.5 text-14-medium text-accent-text">
      <Icon name="terminal" class="size-4" />
      <span>Shell</span>
    </div>
  </Show>
  <Show when={store.inputMode === "normal"}>
    {/* Existing agent/model selector */}
  </Show>
  ```

- [x] Alternative: Modify existing agent display to show "Shell" when in shell mode:

  ```tsx
  <span class="text-14-medium text-text-strong">
    {store.inputMode === "shell" ? "Shell" : (local.agent.current()?.name ?? "Agent")}
  </span>
  ```

### 4. Shell Command Submission

**File**: `packages/desktop/src/components/prompt-input.tsx`

- [x] Modify `handleSubmit()` to handle shell mode:

  ```typescript
  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    const prompt = session.prompt.current()
    const text = prompt.map((part) => part.content).join("")
    if (text.trim().length === 0) {
      if (session.working()) abort()
      return
    }

    // Shell mode submission (new - check before slash commands)
    if (store.inputMode === "shell") {
      let existing = session.info()
      if (!existing) {
        const created = await sdk.client.session.create()
        existing = created.data ?? undefined
        if (existing) navigate(existing.id)
      }
      if (!existing) return

      session.layout.setActiveTab(undefined)
      session.messages.setActive(undefined)
      editorRef.innerHTML = ""
      session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
      setStore("inputMode", "normal") // Reset mode after submission

      try {
        await sdk.client.session.shell({
          sessionID: existing.id,
          agent: local.agent.current()!.name,
          model: {
            providerID: local.model.current()!.provider.id,
            modelID: local.model.current()!.id,
          },
          command: text,
        })
      } catch (error) {
        console.error("Shell command execution failed:", error)
      }
      return
    }

    // Existing UI command detection (undo/redo)...
    // Existing SDK command detection...
    // Existing normal prompt submission...
  }
  ```

### 5. Edge Case Handling

**File**: `packages/desktop/src/components/prompt-input.tsx`

- [x] Reset shell mode when session changes:

  ```typescript
  createEffect(() => {
    session.id
    editorRef.focus()
    setStore("inputMode", "normal") // Reset mode on session change
  })
  ```

- [x] Reset shell mode when editor loses focus (optional, for consistency):

  ```typescript
  createEffect(() => {
    if (!isFocused()) {
      setStore({ popoverIsOpen: false, popoverMode: null })
      // Optionally reset shell mode:
      // setStore("inputMode", "normal")
    }
  })
  ```

- [x] Prevent slash command autocomplete from triggering in shell mode (already handled in step 2)

### 6. Keyboard Shortcut Documentation

- [ ] Consider adding visual hint for shell mode entry (e.g., in help/shortcuts panel if one exists)
- [ ] The `!` prefix should be documented in any user-facing help text

## Implementation Order

1. **State setup** (15 min)
   - [x] Add `inputMode` to store type and default state

2. **Mode detection** (30 min)
   - [x] Add `!` detection in `handleKeyDown()`
   - [x] Add exit detection (backspace at position 0, escape)
   - [x] Skip autocomplete in shell mode via `handleInput()`

3. **Visual indicator** (30 min)
   - [x] Add "Shell" text indicator when in shell mode
   - [x] Style to match TUI (accent color, possibly terminal icon)

4. **Submission logic** (30 min)
   - [x] Add shell mode branch in `handleSubmit()`
   - [x] Call `sdk.client.session.shell()` with correct parameters
   - [x] Reset mode after successful submission

5. **Edge cases** (15 min)
   - [x] Reset mode on session change
   - [x] Test interaction with existing `/` and `@` modes

6. **Validation** (30 min)
   - [ ] Test all validation criteria below

## Validation Criteria

- [ ] Typing `!` at cursor position 0 enters shell mode (no `!` character inserted)
- [ ] Typing `!` anywhere else inserts the character normally
- [ ] Shell mode shows "Shell" indicator instead of agent name
- [ ] Pressing `Escape` in shell mode returns to normal mode
- [ ] Pressing `Backspace` at position 0 in shell mode returns to normal mode
- [ ] Backspace works normally for deleting text in shell mode (not at position 0)
- [ ] Submitting in shell mode calls `session.shell()` API
- [ ] Shell command output appears in session as tool call with streaming output
- [ ] Mode resets to normal after submission
- [ ] Mode resets to normal when switching sessions
- [ ] `/` command autocomplete does NOT trigger while in shell mode
- [ ] `@` file mention autocomplete does NOT trigger while in shell mode
- [ ] Commands like `ls`, `git status`, `echo "hello"` execute correctly
- [ ] Multi-line output renders properly (via existing tool rendering)

## Design Decisions

### Why `inputMode` separate from `popoverMode`?

The `popoverMode` controls the autocomplete dropdown visibility and type. Shell mode is a fundamentally different input mode that affects:

- What happens on submit
- Whether autocomplete is shown at all
- Visual styling of the prompt

Keeping them separate maintains clear separation of concerns.

### Why prevent `!` character insertion?

Matches TUI behavior - the `!` is a mode trigger, not part of the command. Users type `!ls`, but the command sent is `ls`. This also allows easy mode exit via backspace without needing to delete the `!`.

### Why no confirmation/permission prompt?

User-initiated shell commands are intentionally direct. The user typed the command explicitly, so no confirmation is needed. This matches standard terminal behavior and the TUI implementation.

### Why use `session.shell()` instead of `session.prompt()`?

The `session.shell()` endpoint creates the proper message structure with:

- Synthetic user message explaining tool execution
- Assistant message with bash tool part
- Proper streaming of command output
- Correct tool state transitions

Using `session.prompt()` with shell text would confuse the AI into thinking it should respond to the command rather than execute it.

## References

| Component                 | File                                                           | Lines     |
| ------------------------- | -------------------------------------------------------------- | --------- |
| TUI shell mode detection  | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 722-733   |
| TUI shell submission      | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 451-461   |
| TUI shell visual          | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 832-842   |
| TUI mode state            | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 276-291   |
| Server shell execution    | `packages/opencode/src/session/prompt.ts`                      | 1209-1401 |
| SDK shell method          | `packages/sdk/js/src/v2/gen/sdk.gen.ts`                        | 1363-1400 |
| Desktop prompt input      | `packages/desktop/src/components/prompt-input.tsx`             | Full file |
| Desktop slash commands    | `CONTEXT/PLAN-desktop-slash-commands-2025-12-10.md`            | Full file |
| Bash tool definition      | `packages/opencode/src/tool/bash.ts`                           | -         |
| Shell invocation patterns | `packages/opencode/src/session/prompt.ts`                      | 1294-1337 |

## External References

No external repositories required - all implementation is internal to the codebase.

## Appendix: Shell Invocation Patterns

For reference, the server-side shell detection and invocation (from `packages/opencode/src/session/prompt.ts:1294-1337`):

```typescript
const shell = process.env["SHELL"] ?? (process.platform === "win32" ? process.env["COMSPEC"] || "cmd.exe" : "bash")
const shellName = path.basename(shell).toLowerCase()

const invocations: Record<string, { args: string[] }> = {
  nu: { args: ["-c", input.command] },
  fish: { args: ["-c", input.command] },
  zsh: {
    args: [
      "-c",
      "-l",
      `
        [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
        [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
        ${input.command}
      `,
    ],
  },
  bash: {
    args: [
      "-c",
      "-l",
      `
        [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
        ${input.command}
      `,
    ],
  },
  "cmd.exe": { args: ["/c", input.command] },
  "powershell.exe": { args: ["-NoProfile", "-Command", input.command] },
  "": { args: ["-c", "-l", `${input.command}`] }, // Fallback
}
```

This is handled entirely server-side - the desktop client just passes the command string.
