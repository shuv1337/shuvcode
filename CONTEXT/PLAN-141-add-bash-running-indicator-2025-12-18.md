# Project Plan: Add running indicator for bash commands in TUI

This plan addresses issue #141, adding a visual spinner indicator for bash commands (and potentially other tools) while they are running in the TUI.

## Context

Currently, users have no visual feedback when an agent executes a bash command. A running indicator will improve UX by showing that the process is active.

## Design Decision: Spinner Architecture

**Decision:** Use a **single shared module-level spinner signal** rather than per-component intervals.

**Rationale:**

- The TUI already uses two spinner systems: `opentui-spinner/solid` with `<spinner>` element (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:932`) and braille frames in sidebar (`packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:30`).
- Per-ToolTitle intervals would cause timer explosion (sessions can have dozens/hundreds of tool parts).
- A shared signal ensures only ONE `setInterval` exists regardless of how many tools are displayed.

**Approach:** Create a module-level braille spinner signal (consistent with sidebar style) that all loading ToolTitles subscribe to reactively.

## Technical Approach

1.  **Shared Spinner Signal**: Create a module-level spinner signal with a single interval that all loading indicators subscribe to.
2.  **Tool Call Status Propagation**: Update the rendering pipeline to pass the tool call status from `ToolPart` component down to individual tool render functions via the `Dynamic` component.
3.  **Enhanced `ToolTitle`**: Update `ToolTitle` to support a `loading` state, displaying a spinner appended after the icon (not replacing it, to avoid width jitter).
4.  **Bash Tool Integration**: Enable spinner for `BashTool` and other long-running tools like `WebFetchTool`, `TaskTool`.

## Internal Code References

| Component                | File                                                           | Line Range | Notes                                                              |
| ------------------------ | -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| ToolPart component       | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | 1652-1759  | Has access to `props.part.state.status`                            |
| Dynamic component call   | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | 1722-1729  | Where status needs to be passed                                    |
| ToolProps type           | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | 1761-1767  | Needs `status` and `agentColor` fields                             |
| ToolTitle component      | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | 1798-1807  | Needs `loading` prop                                               |
| BashTool render          | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | 1811-1861  | Primary integration target                                         |
| Existing sidebar spinner | `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` | 30-36      | Braille frames to reuse                                            |
| Existing spinner system  | `packages/opencode/src/cli/cmd/tui/ui/spinner.ts`              | 272        | Knight-rider style (different visual)                              |
| ToolState types (SDK)    | `packages/sdk/js/src/v2/gen/types.gen.ts`                      | 269-324    | Status values: pending, running, completed, error                  |
| Agent color impl         | `packages/opencode/src/cli/cmd/tui/context/local.tsx`          | 95-101     | Returns `RGBA` object, not string                                  |
| Agent color usage        | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | 1548       | `local.agent.color(props.message.mode)` - uses `mode`, not `agent` |
| showDetails check        | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | 1661       | Hides completed tools when disabled                                |

## Data Flow

Current flow (no status in render functions):

```
ToolPart (has props.part.state.status)
  -> Dynamic component (passes input, metadata, permission, output, tool)
    -> BashTool render function (no status available)
      -> ToolTitle (no loading prop)
```

Proposed flow:

```
ToolPart (has props.part.state.status, props.message.mode)
  -> Dynamic component (adds status, agentColor to existing props)
    -> BashTool render function (has props.status, props.agentColor)
      -> ToolTitle (loading={isRunning}, loadingColor={agentColor})
        -> subscribes to shared spinner signal (no new interval)
```

## Implementation Tasks

### 1. Create Shared Spinner Signal (Module-Level)

Create a module-level spinner signal in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (or extract to a utility):

- [x] Add module-level singleton spinner:

  ```typescript
  import { createSignal } from "solid-js"
  import type { ColorInput } from "@opentui/core"

  // Module-level shared spinner - ONE interval for all tool spinners
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const SPINNER_INTERVAL_MS = 100

  // Lazy-initialized: interval only starts when first subscriber reads the signal
  let spinnerInitialized = false
  const [spinnerIndex, setSpinnerIndex] = createSignal(0)

  function getSpinnerFrame(): string {
    if (!spinnerInitialized) {
      spinnerInitialized = true
      setInterval(() => {
        setSpinnerIndex((prev) => (prev + 1) % SPINNER_FRAMES.length)
      }, SPINNER_INTERVAL_MS)
    }
    return SPINNER_FRAMES[spinnerIndex()]
  }
  ```

- [x] **Note:** This interval is intentionally never cleaned up - it runs for the lifetime of the TUI process. This is acceptable because:
  - Only ONE interval exists regardless of tool count
  - The TUI process terminates when closed anyway
  - Cost is negligible (~10 signal updates/sec)

### 2. Update sidebar.tsx to Use Shared Spinner

Refactor `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:30-36`:

- [x] Import and use the shared spinner instead of local implementation:

  ```typescript
  // Remove local spinnerFrames/spinnerIndex/setSpinnerIndex/intervalId
  // Import from shared location or inline if kept in index.tsx
  import { getSpinnerFrame } from "./index" // or wherever placed

  // Replace spinnerFrames[spinnerIndex()] with getSpinnerFrame()
  ```

### 3. Update ToolProps Interface

Modify `ToolProps` in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1761-1767`:

- [x] Add `status` and `agentColor` fields with correct types:

  ```typescript
  import type { ColorInput } from "@opentui/core"
  import type { ToolState } from "@opencode-ai/sdk/v2"

  type ToolProps<T extends Tool.Info> = {
    input: Partial<Tool.InferParameters<T>>
    metadata: Partial<Tool.InferMetadata<T>>
    permission: Record<string, any>
    tool: string
    output?: string
    status: ToolState["status"] // "pending" | "running" | "completed" | "error"
    agentColor: ColorInput // RGBA from local.agent.color(), not string
  }
  ```

- [x] **Important:** Use `ToolState["status"]` from SDK types to avoid type drift.
- [x] **Important:** Use `ColorInput` (which accepts `RGBA`) since `local.agent.color()` returns `RGBA`.

### 4. Pass Status and Agent Color to Dynamic Component

Update the `Dynamic` component call in `ToolPart` at `index.tsx:1722-1729`:

- [x] Add `useLocal()` call within ToolPart if not already present
- [x] Modify the existing `Dynamic` call:

  ```typescript
  function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
    const { theme } = useTheme()
    const { showDetails } = use()
    const sync = useSync()
    const local = useLocal()  // Add this if not present
    // ... existing code ...

    <Dynamic
      component={render}
      input={input}
      tool={props.part.tool}
      metadata={metadata}
      permission={permission?.metadata ?? {}}
      output={props.part.state.status === "completed" ? props.part.state.output : undefined}
      status={props.part.state.status}
      agentColor={local.agent.color(props.message.mode)}  // Use mode, not agent
    />
  ```

- [x] **Note:** Use `props.message.mode` for color (consistent with assistant UI at line 1548), not `props.message.agent`.

### 5. Enhance ToolTitle Component

Update `ToolTitle` at `index.tsx:1798-1807`:

- [x] Add `loading` and `loadingColor` props:

  ```typescript
  import type { ColorInput } from "@opentui/core"

  function ToolTitle(props: {
    fallback: string
    when: any
    icon: string
    children: JSX.Element
    loading?: boolean
    loadingColor?: ColorInput
  }) {
    const { theme } = useTheme()

    return (
      <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
        <Show fallback={<>~ {props.fallback}</>} when={props.when}>
          <span style={{ bold: true }}>{props.icon}</span>
          <Show when={props.loading}>
            <span style={{ fg: props.loadingColor, bold: true }}> {getSpinnerFrame()}</span>
          </Show>
          {" "}{props.children}
        </Show>
      </text>
    )
  }
  ```

- [x] **Design choice:** Spinner is APPENDED after icon, not replacing it. This avoids width jitter from different Unicode glyph widths.
- [x] **Backwards compatibility:** When `loading` is omitted/false, behavior is identical to current implementation (no new timers, no updates).
- [x] Visual behavior:
  - `when=false` (pending, no input yet): Shows `~ {fallback}` (e.g., "~ Writing command...")
  - `when=true` AND `loading=true`: Shows `{icon} {spinner} {children}` (e.g., "# ⠋ Shell")
  - `when=true` AND `loading=false`: Shows `{icon} {children}` (current behavior)

### 6. Integrate with BashTool

Update `BashTool` registration at `index.tsx:1811-1861`:

- [x] Modify the render function to use new props:

  ```typescript
  ToolRegistry.register<typeof BashTool>({
    name: "bash",
    container: "block",
    render(props) {
      const rawOutput = createMemo(() => props.metadata.output?.trim() ?? "")
      const ctx = use()
      const { theme } = useTheme()

      // Only show spinner for "running" status
      // "pending" means waiting for input or permission - show fallback text instead
      const isRunning = props.status === "running"

      // ... existing output processing code ...

      return (
        <box>
          <ToolTitle
            icon="#"
            fallback="Writing command..."
            when={props.input.command}
            loading={isRunning}
            loadingColor={props.agentColor}
          >
            {props.input.description || "Shell"}
          </ToolTitle>
          {/* ... rest of existing render ... */}
        </box>
      )
    },
  })
  ```

- [x] **Note on status semantics:**
  - `pending`: Tool call received but not yet started (may be waiting for permission). Show fallback text, NOT spinner.
  - `running`: Tool is actively executing. Show spinner.
  - `completed`/`error`: Tool finished. No spinner.

### 7. Integrate with Other Long-Running Tools

Apply similar changes to these tools:

- [x] **WebFetchTool** (`index.tsx:2008-2018`):

  ```typescript
  render(props) {
    const isRunning = props.status === "running"
    return (
      <ToolTitle
        icon="%"
        fallback="Fetching from the web..."
        when={(props.input as any).url}
        loading={isRunning}
        loadingColor={props.agentColor}
      >
        WebFetch {(props.input as any).url}
      </ToolTitle>
    )
  }
  ```

- [x] **TaskTool** (`index.tsx:1972-2005`): Already has spinner in sidebar for subagents. Add inline spinner for visual consistency with other tools.

- [x] **CodeSearch** (`index.tsx:2020-2032`): External API call, benefits from spinner.

- [x] **WebSearch** (`index.tsx:2034-2045`): External API call, benefits from spinner.

- [x] **EditTool** (`index.tsx:2048-2116`): May be slow with large files + LSP diagnostics.

### 8. Performance Considerations

- [x] **Timer count:** Verify only ONE interval exists (the shared module-level one). No per-component timers.
- [x] **Update frequency:** Spinner updates 10x/sec. Verify this doesn't trigger expensive re-layout of bash output (`ghostty-terminal`).
- [x] **Visibility optimization:** Consider skipping spinner updates when `showDetails()` is false and tool would be hidden anyway (line 1661).
- [x] **Stress test:** With many historical tool parts visible (`showDetails()` enabled), ensure no CPU spikes.

## Validation Criteria

### Functional Tests

- [x] Start a bash command in the TUI (e.g., `sleep 5`).
- [x] Verify a spinner appears next to the command title while running.
- [x] Verify the spinner color matches the agent/mode color.
- [x] Verify the spinner is replaced by just the `#` icon once the command completes.
- [x] Verify the TUI remains responsive during command execution.

### Edge Cases

- [x] **Fast command** (<100ms): Spinner may flash briefly. Acceptable, but verify no jarring flicker. (See optional enhancement for minimum display time.)
- [x] **Multiple concurrent commands**: Each tool call shows independent spinner state (all subscribe to same shared signal).
- [x] **Permission request during tool**: `pending` status should show fallback text, NOT spinner. Spinner starts when status becomes `running`.
- [x] **Abort during execution**: Spinner stops when command is aborted (status changes).
- [x] **Error during execution**: Spinner stops, error state shown correctly.
- [x] **Output streaming**: Spinner animates while `metadata.output` streams in real-time (note: output comes via metadata during running, not `output` prop).

### Performance Tests

- [x] Run `for i in {1..10}; do echo $i; sleep 1; done` - verify smooth animation with streaming output.
- [x] Open a session with 50+ tool calls, enable `showDetails()`, verify no noticeable CPU increase.
- [x] Verify only ONE setInterval exists in the process (can check via debugger or logging).

## Implementation Order

1.  Add shared module-level spinner signal to `index.tsx`.
2.  Update `sidebar.tsx` to use shared spinner (refactor, no behavior change).
3.  Extend `ToolProps` with `status` and `agentColor` (correct types).
4.  Update `Dynamic` component call to pass new props.
5.  Enhance `ToolTitle` with `loading` and `loadingColor` props.
6.  Update `BashTool` render to use loading props.
7.  Test with bash commands.
8.  Extend to `WebFetchTool`, `TaskTool`, and other tools.
9.  Final testing and polish.

## Feature Flag (Recommended)

Add TUI config option to disable spinners for users who prefer minimal UI:

```yaml
tui:
  show_tool_spinners: true # default
```

- [x] Check `sync.data.config.tui?.show_tool_spinners !== false` before showing spinner.
- [x] Pattern exists at `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:2056` for reference.

## Optional Future Enhancements

- [ ] **Minimum spinner display time** (e.g., 200ms) to avoid flicker on fast commands:
  - Track when spinner started
  - Keep showing for minimum duration even if status changes to completed
  - Improves perceived smoothness

- [ ] **Different spinner styles** configurable in theme:
  - Braille (current): `["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]`
  - Dots: `["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"]`
  - Simple: `["-", "\\", "|", "/"]`

- [ ] **Distinct "awaiting permission" indicator**:
  - Instead of fallback text for `pending`, show a pause icon or "⏸" when permission is required.
  - Would require passing permission state to render functions.

## Files to Modify

| File                                                           | Changes                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | Shared spinner signal, ToolProps, Dynamic call, ToolTitle, tools |
| `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` | Refactor to use shared spinner signal                            |

## Review Checklist

- [x] Only ONE setInterval exists for spinner (module-level, not per-component).
- [x] Agent color uses `props.message.mode` and type is `ColorInput`/`RGBA`, not `string`.
- [x] Status type derives from SDK types (`ToolState["status"]`), not hardcoded union.
- [x] Spinner is appended after icon (not replacing) to avoid width jitter.
- [x] `loading` prop defaults to `false` - no new timers/updates when omitted.
- [x] TypeScript types are correct and complete.
- [x] No performance regressions in message rendering with many tools visible.
- [x] Spinner is visually consistent with existing sidebar spinner.
- [x] `pending` status shows fallback text, `running` shows spinner.
