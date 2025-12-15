# Plan: Integrate Plugin Commands from Upstream PR #4411

**Issue**: [#132](https://github.com/Latitudes-Dev/shuvcode/issues/132)  
**Upstream PR**: [sst/opencode#4411](https://github.com/sst/opencode/pull/4411)  
**Status**: Implemented (pending manual testing)  
**Created**: 2025-12-15  
**Labels**: enhancement, upstream-sync

---

## Overview

This plan documents the integration of a new plugin hook system (`plugin.command`) from upstream that allows plugins to register custom slash commands with executable code. This is a significant extensibility feature that enables use cases like session manipulation, plugin toggling, and custom workflows.

### Feature Summary

The `plugin.command` hook enables plugins to:

- Register custom `/commands` visible in TUI autocomplete
- Execute arbitrary code when commands are invoked
- Define command aliases (e.g., `/hi` → `/hello`)
- Restrict commands to active sessions only (`sessionOnly: true`)

### Use Cases

- `/prune` - Prune tool outputs from session history
- `/toggle-feature` - Enable/disable plugin features dynamically
- `/export-custom` - Custom export formats
- `/workflow` - Composable multi-step workflows

---

## Technical Specifications

### New Plugin Hook Interface

```typescript
// packages/plugin/src/index.ts
"plugin.command"?: {
  [key: string]: {
    description: string
    aliases?: string[]
    sessionOnly?: boolean
    execute(input: {
      sessionID?: string
      client: ReturnType<typeof createOpencodeClient>
    }): Promise<void>
  }
}
```

### Command Schema Extensions

```typescript
// packages/opencode/src/command/index.ts - Command.Info schema
{
  name: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  template: z.string(),
  subtask: z.boolean().optional(),
  sessionOnly: z.boolean().optional(),  // NEW
  aliases: z.array(z.string()).optional(),  // NEW
}
```

### SDK Type Updates

```typescript
// packages/sdk/js/src/gen/types.gen.ts
export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  template: string
  subtask?: boolean
  sessionOnly?: boolean // NEW
}

// packages/sdk/js/src/v2/gen/types.gen.ts
export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  template: string
  subtask?: boolean
  sessionOnly?: boolean // NEW
  aliases?: Array<string> // NEW
}
```

---

## Files to Modify

| File                                                                  | Line Range | Change Type  | Description                                                  |
| --------------------------------------------------------------------- | ---------- | ------------ | ------------------------------------------------------------ |
| `packages/plugin/src/index.ts`                                        | 189-203    | Addition     | Add `plugin.command` hook interface to `Hooks`               |
| `packages/opencode/src/plugin/index.ts`                               | 53-76      | Modification | Exclude `plugin.command` from trigger, add `client()` export |
| `packages/opencode/src/command/index.ts`                              | 23-79      | Modification | Add schema fields, load plugin commands, alias lookup        |
| `packages/opencode/src/session/prompt.ts`                             | 1413-1498  | Modification | Plugin command execution with error handling                 |
| `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | 207-222    | Modification | Filter `sessionOnly`, add aliases to options                 |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`        | 506-520    | Modification | Resolve command aliases, remove console.log                  |
| `packages/sdk/js/src/gen/types.gen.ts`                                | 1447-1454  | Modification | Add `sessionOnly` to Command type                            |
| `packages/sdk/js/src/v2/gen/types.gen.ts`                             | 1615-1622  | Modification | Add `sessionOnly` and `aliases` to Command type              |

---

## Implementation Tasks

### Phase 1: Plugin Infrastructure

#### 1.1 Update Plugin Hook Interface

- [x] Add `plugin.command` hook type to `Hooks` interface in `packages/plugin/src/index.ts`

**Location**: `packages/plugin/src/index.ts:189` (after `experimental.text.complete` hook)

**Code to add**:

```typescript
/**
 * Register custom plugin commands (accessible via /command in TUI)
 */
"plugin.command"?: {
  [key: string]: {
    description: string
    aliases?: string[]
    sessionOnly?: boolean
    execute(input: { sessionID?: string; client: ReturnType<typeof createOpencodeClient> }): Promise<void>
  }
}
```

#### 1.2 Update Plugin Trigger Function

- [x] Exclude `plugin.command` from the `trigger` function type constraint in `packages/opencode/src/plugin/index.ts`

**Location**: `packages/opencode/src/plugin/index.ts:55-56`

**Change**:

```typescript
// FROM:
Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,

// TO:
Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "plugin.command">,
```

#### 1.3 Add Plugin Client Export

- [x] Add `client()` export function to expose SDK client to plugins

**Location**: `packages/opencode/src/plugin/index.ts:73` (after `hooks()` function)

**Code to add**:

```typescript
export async function client() {
  return state().then((x) => x.input.client)
}
```

---

### Phase 2: Command Module Updates

#### 2.1 Update Command Schema

- [x] Add `sessionOnly` and `aliases` fields to `Command.Info` schema

**Location**: `packages/opencode/src/command/index.ts:28-31`

**Change**:

```typescript
// After 'subtask: z.boolean().optional(),' add:
sessionOnly: z.boolean().optional(),
aliases: z.array(z.string()).optional(),
```

#### 2.2 Add Plugin Import

- [x] Import `Plugin` namespace in command module

**Location**: `packages/opencode/src/command/index.ts:8` (after existing imports)

**Code to add**:

```typescript
import { Plugin } from "../plugin"
```

#### 2.3 Load Plugin Commands in State

- [x] Modify `state()` function to load commands from plugins

**Location**: `packages/opencode/src/command/index.ts:69` (after config command loop, before `return result`)

**Code to add**:

```typescript
const plugins = await Plugin.list()
for (const plugin of plugins) {
  const commands = plugin["plugin.command"]
  if (!commands) continue
  for (const [name, cmd] of Object.entries(commands)) {
    if (result[name]) continue
    result[name] = {
      name,
      description: cmd.description,
      template: "",
      sessionOnly: cmd.sessionOnly,
      aliases: cmd.aliases,
    }
  }
}
```

#### 2.4 Update Command Get Function

- [x] Modify `get()` function to support alias resolution

**Location**: `packages/opencode/src/command/index.ts:73-75`

**Change from**:

```typescript
export async function get(name: string) {
  return state().then((x) => x[name])
}
```

**Change to**:

```typescript
export async function get(name: string) {
  const commands = await state()
  if (commands[name]) return commands[name]
  // Check aliases
  for (const cmd of Object.values(commands)) {
    if (cmd.aliases?.includes(name)) return cmd
  }
  return undefined
}
```

---

### Phase 3: Command Execution

#### 3.1 Update Session Prompt Command Handler

- [x] Add plugin command execution logic to `command()` function

**Location**: `packages/opencode/src/session/prompt.ts:1415-1416`

**Change from**:

```typescript
const command = await Command.get(input.command)
const agentName = command.agent ?? input.agent ?? "build"
```

**Change to**:

```typescript
const command = await Command.get(input.command)
const agentName = command?.agent ?? input.agent ?? "build"

const plugins = await Plugin.list()
for (const plugin of plugins) {
  const pluginCommands = plugin["plugin.command"]
  const pluginCommand = pluginCommands?.[input.command]
  if (!pluginCommand) continue

  const client = await Plugin.client()
  try {
    await pluginCommand.execute({ sessionID: input.sessionID, client })
  } catch (error) {
    log.error("plugin command failed", {
      command: input.command,
      error: error instanceof Error ? error.message : String(error),
    })
    return await SessionPrompt.prompt({
      sessionID: input.sessionID,
      agent: agentName,
      parts: [
        {
          type: "text",
          text: `Plugin command "/${input.command}" failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    })
  }
  const last = await Session.messages({ sessionID: input.sessionID, limit: 1 })
  const message = last.at(0)
  if (message) return message
  return await SessionPrompt.prompt({
    sessionID: input.sessionID,
    agent: agentName,
    parts: [
      {
        type: "text",
        text: "",
      },
    ],
  })
}

if (!command)
  return await SessionPrompt.prompt({
    sessionID: input.sessionID,
    agent: agentName,
    parts: [
      {
        type: "text",
        text: "",
      },
    ],
  })
```

---

### Phase 4: TUI Autocomplete Updates

#### 4.1 Update Autocomplete Command Filtering

- [x] Add `sessionOnly` filtering and `aliases` to autocomplete options

**Location**: `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx:207-222`

**Change from**:

```typescript
const commands = createMemo((): AutocompleteOption[] => {
  const results: AutocompleteOption[] = []
  const s = session()
  for (const command of sync.data.command) {
    results.push({
      display: "/" + command.name,
      description: command.description,
      onSelect: () => {
```

**Change to**:

```typescript
const commands = createMemo((): AutocompleteOption[] => {
  const results: AutocompleteOption[] = []
  const s = session()

  for (const command of sync.data.command) {
    if (command.sessionOnly && !s) continue

    results.push({
      display: "/" + command.name,
      description: command.description,
      aliases: command.aliases?.map((a) => "/" + a),
      onSelect: () => {
```

#### 4.2 Update Prompt Command Resolution

- [x] Add alias resolution to command submission

**Location**: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:506-520`

**Change from**:

```typescript
inputText.startsWith("/") &&
iife(() => {
  const command = inputText.split(" ")[0].slice(1)
  console.log(command)
  return sync.data.command.some((x) => x.name === command)
})
) {
let [command, ...args] = inputText.split(" ")
sdk.client.session.command({
  sessionID,
  command: command.slice(1),
```

**Change to**:

```typescript
inputText.startsWith("/") &&
iife(() => {
  const command = inputText.split(" ")[0].slice(1)
  return sync.data.command.some((x) => x.name === command || x.aliases?.includes(command))
})
) {
let [command, ...args] = inputText.split(" ")
const commandName = command.slice(1)
const resolved = sync.data.command.find((x) => x.name === commandName || x.aliases?.includes(commandName))
sdk.client.session.command({
  sessionID,
  command: resolved?.name ?? commandName,
```

---

### Phase 5: SDK Types

#### 5.1 Update SDK v1 Types

- [x] Add `sessionOnly` to Command type

**Location**: `packages/sdk/js/src/gen/types.gen.ts:1453`

**Change from**:

```typescript
export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  template: string
  subtask?: boolean
}
```

**Change to**:

```typescript
export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  template: string
  subtask?: boolean
  sessionOnly?: boolean
}
```

#### 5.2 Update SDK v2 Types

- [x] Add `sessionOnly` and `aliases` to Command type

**Location**: `packages/sdk/js/src/v2/gen/types.gen.ts:1621`

**Change from**:

```typescript
export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  template: string
  subtask?: boolean
}
```

**Change to**:

```typescript
export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  template: string
  subtask?: boolean
  sessionOnly?: boolean
  aliases?: Array<string>
}
```

---

### Phase 6: Build and Verification

#### 6.1 Rebuild SDK

- [x] Run SDK build script to regenerate types

```bash
cd packages/sdk/js && bun run script/build.ts
```

#### 6.2 Run Type Check

- [x] Verify no TypeScript errors

```bash
bun run typecheck
```

#### 6.3 Run Tests

- [x] Run full test suite

```bash
bun test
```

#### 6.4 Manual Testing

- [ ] Start dev server and test plugin command registration (skipped - requires manual testing)
- [ ] Test autocomplete filtering with `sessionOnly` (skipped - requires manual testing)
- [ ] Test alias resolution (skipped - requires manual testing)
- [ ] Test error handling for failed commands (skipped - requires manual testing)

---

## Validation Criteria

### Acceptance Tests

| Test Case                                           | Expected Result                                           | Verified |
| --------------------------------------------------- | --------------------------------------------------------- | -------- |
| Plugin commands appear in `/` autocomplete          | Commands registered via `plugin.command` are shown        | [ ]      |
| `sessionOnly: true` commands hidden without session | Command not shown when no active session                  | [ ]      |
| `sessionOnly: true` commands shown with session     | Command appears when session is active                    | [ ]      |
| Alias resolution in autocomplete                    | Typing `/hi` matches command with `aliases: ["hi"]`       | [ ]      |
| Alias resolution on submit                          | `/hi` executes the aliased command                        | [ ]      |
| Plugin command execution                            | `execute()` function is called with correct context       | [ ]      |
| Error handling                                      | Failed commands show error message to user                | [ ]      |
| SDK types compile                                   | TypeScript accepts new `sessionOnly` and `aliases` fields | [ ]      |

### Example Plugin for Testing

Create `.opencode/plugin/test-commands.ts`:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const TestCommandsPlugin: Plugin = async (ctx) => {
  return {
    "plugin.command": {
      hello: {
        description: "Say hello from plugin",
        aliases: ["hi", "greet"],
        sessionOnly: true,
        async execute({ sessionID, client }) {
          console.log(`Hello command executed for session: ${sessionID}`)
          // Optionally send a message to the session
          if (sessionID) {
            await client.session.sendMessage({
              path: { id: sessionID },
              body: { content: "Hello from test plugin command!" },
            })
          }
        },
      },
      info: {
        description: "Show plugin info (no session required)",
        sessionOnly: false,
        async execute({ client }) {
          console.log("Info command executed - no session required")
        },
      },
      fail: {
        description: "Test error handling",
        sessionOnly: true,
        async execute() {
          throw new Error("Intentional test failure")
        },
      },
    },
  }
}
```

---

## External References

### Upstream PR Diff

```bash
# Get full diff
gh pr diff 4411 --repo sst/opencode

# Apply as patch (if desired)
gh pr diff 4411 --repo sst/opencode | git apply --check
```

### Reference Implementations

| Pattern                      | Source                  | URL                                                                |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------ |
| Command registration pattern | callstack/rock          | https://github.com/callstack/rock                                  |
| Plugin hook system           | commandkit              | https://github.com/underctrl-io/commandkit                         |
| Typora plugin commands       | typora-community-plugin | https://github.com/typora-community-plugin/typora-community-plugin |

### Related Files in Codebase

- Plugin system entry: `packages/opencode/src/plugin/index.ts`
- Command system entry: `packages/opencode/src/command/index.ts`
- Session prompt handler: `packages/opencode/src/session/prompt.ts`
- TUI autocomplete: `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`
- TUI prompt input: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- Plugin types: `packages/plugin/src/index.ts`
- SDK v1 types: `packages/sdk/js/src/gen/types.gen.ts`
- SDK v2 types: `packages/sdk/js/src/v2/gen/types.gen.ts`

---

## Risk Assessment

### Potential Conflicts

| File                                      | Risk                       | Mitigation                                            |
| ----------------------------------------- | -------------------------- | ----------------------------------------------------- |
| `packages/opencode/src/session/prompt.ts` | High - frequently modified | Check git log before applying, manual merge if needed |
| `packages/opencode/src/command/index.ts`  | Low - stable file          | Direct application likely safe                        |
| `packages/plugin/src/index.ts`            | Low - additive change      | Append to existing interface                          |
| SDK type files                            | Medium - auto-generated    | May need regeneration via build script                |

### Upstream PR Status

The upstream PR is currently **OPEN** (not merged). Consider:

1. **Wait for merge**: Safer approach, changes will be vetted by upstream
2. **Cherry-pick now**: Get feature earlier, but may need to reconcile when PR is merged
3. **Manual implementation**: Implement based on PR diff, full control

**Recommendation**: Wait for upstream merge if not urgent, or cherry-pick with awareness of potential future reconciliation.

---

## Notes

- The upstream PR removes a `console.log(command)` statement that exists in our fork at `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:509`
- SDK types may be auto-generated; if so, the underlying schema in `packages/opencode/src/command/index.ts` drives regeneration
- Plugin commands with empty `template: ""` are distinguished from config-defined commands
- The `plugin.command` hook is intentionally excluded from `Plugin.trigger()` since it's handled differently (direct execution vs. transformation hooks)
