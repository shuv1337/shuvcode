# Plan: Plugin Commands Feature

**Issue Reference:** Based on PR #4411 concepts  
**Created:** 2025-12-26  
**Revised:** 2025-12-27  
**Status:** Complete

---

## Overview

Implement plugin-registered slash commands that execute via the existing `session.command` API entrypoint. Alias resolution and error/event handling are server-side only. This plan avoids any client changes and stays backward compatible with existing clients that already call the command API.

This plan implements the feature from scratch with fixes for the issues identified in PR #4411's review, while minimizing footprint and aligning with upstream patterns.

---

## Design Decisions

### sessionOnly Enforcement

**Definition**: A `sessionOnly` command requires an **existing** session.

**Enforcement point**: Server-side, within the `session.command` execution path. We do not prevent session creation (clients may auto-create sessions), but we can block execution if the session does not meet the required criteria. If stronger semantics are needed (e.g., "must have prior messages"), define that explicitly and check server-side.

### Alias Resolution

**Single source of truth**: `Command.get()` on the server resolves aliases.

**Client behavior**: No changes. Alias resolution only applies to the `session.command` API entrypoint. Clients that already call the command endpoint will work; clients that send `/cmd` as prompt text remain unchanged.

### Error Handling

**Cross-client errors**: Use `Session.Event.Error` (not TUI-specific events) so all clients can handle failures.

### Event Emission

**Backward compatible**: Keep `command.executed` schema unchanged. Only emit when a message is created.

---

## Implementation

### Part 1: Plugin Hook Type

Add the `plugin.command` hook to the plugin type definitions.

**File**: `packages/plugin/src/index.ts`

- [x] **1.1** Add `plugin.command` hook to `Hooks` interface

```typescript
export interface Hooks {
  // ... existing hooks ...
  
  /**
   * Register custom slash commands (accessible via /command in TUI/web)
   */
  "plugin.command"?: {
    [name: string]: {
      description: string
      aliases?: string[]
      sessionOnly?: boolean
      execute(input: {
        sessionID: string
        arguments: string
        client: ReturnType<typeof createOpencodeClient>
      }): Promise<void>
    }
  }
}
```

---

### Part 2: Command Schema

Add fields to support plugin commands, aliases, and sessionOnly.

**File**: `packages/opencode/src/command/index.ts`

- [x] **2.1** Update `Command.Info` schema

```typescript
export const Info = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    template: z.string(),
    type: z.enum(["template", "plugin"]).default("template"),
    subtask: z.boolean().optional(),
    sessionOnly: z.boolean().optional(),
    aliases: z.array(z.string()).optional(),
  })
  .meta({
    ref: "Command",
  })
```

- [x] **2.2** Update default commands to include `type: "template"`

```typescript
const result: Record<string, Info> = {
  [Default.INIT]: {
    name: Default.INIT,
    type: "template",
    description: "create/update AGENTS.md",
    template: PROMPT_INITIALIZE.replace("${path}", Instance.worktree),
  },
  [Default.REVIEW]: {
    name: Default.REVIEW,
    type: "template",
    description: "review changes [commit|branch|pr], defaults to uncommitted",
    template: PROMPT_REVIEW.replace("${path}", Instance.worktree),
    subtask: true,
  },
}
```

- [x] **2.3** Update config command loading to include `type: "template"`

```typescript
for (const [name, command] of Object.entries(cfg.command ?? {})) {
  result[name] = {
    name,
    type: "template",
    agent: command.agent,
    // ...
  }
}
```

---

### Part 3: Plugin Command Loading

Load plugin commands into the command registry.

**File**: `packages/opencode/src/command/index.ts`

- [x] **3.1** Import Plugin namespace

```typescript
import { Plugin } from "../plugin"
```

- [x] **3.2** Load plugin commands in `state()`

```typescript
const state = Instance.state(async () => {
  const cfg = await Config.get()
  const result: Record<string, Info> = {
    // ... default commands ...
  }

  // Config commands
  for (const [name, command] of Object.entries(cfg.command ?? {})) {
    // ...
  }

  // Plugin commands
  const plugins = await Plugin.list()
  for (const plugin of plugins) {
    const commands = plugin["plugin.command"]
    if (!commands) continue
    for (const [name, cmd] of Object.entries(commands)) {
      if (result[name]) continue // Don't override existing commands
      result[name] = {
        name,
        type: "plugin",
        description: cmd.description,
        template: "", // Plugin commands don't use templates
        sessionOnly: cmd.sessionOnly,
        aliases: cmd.aliases,
      }
    }
  }

  return result
})
```

- [x] **3.3** Update `Command.get()` to resolve aliases (server-side only)

```typescript
export async function get(name: string) {
  const commands = await state()
  if (commands[name]) return commands[name]
  for (const cmd of Object.values(commands)) {
    if (cmd.aliases?.includes(name)) return cmd
  }
  return undefined
}
```

---

### Part 4: Plugin Command Execution

Handle plugin command execution in the session prompt.

**File**: `packages/opencode/src/session/prompt.ts`

- [x] **4.1** Add Plugin import (already present)

```typescript
import { Plugin } from "../plugin"
```

- [x] **4.2** Handle plugin commands in `SessionPrompt.command()`

```typescript
export async function command(input: CommandInput) {
  log.info("command", input)
  const command = await Command.get(input.command)
  if (!command) {
    log.warn("command not found", { command: input.command })
    return
  }

  // Plugin commands execute directly via hook
  if (command.type === "plugin") {
    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      const pluginCommands = plugin["plugin.command"]
      const pluginCommand = pluginCommands?.[command.name]
      if (!pluginCommand) continue

      try {
        const client = await Plugin.client()
        await pluginCommand.execute({
          sessionID: input.sessionID,
          arguments: input.arguments,
          client,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error("plugin command failed", { command: command.name, error: message })
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: new NamedError.Unknown({
            message: `/${command.name} failed: ${message}`,
          }).toObject(),
        })
        throw error
      }

      // Emit event if plugin created a message
      const last = await Session.messages({ sessionID: input.sessionID, limit: 1 })
      if (last.length > 0) {
        Bus.publish(Command.Event.Executed, {
          name: command.name,
          sessionID: input.sessionID,
          arguments: input.arguments,
          messageID: last[0].info.id,
        })
        return last[0]
      }
      return
    }
    return
  }

  // Template commands (existing logic)
  const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())
  // ... rest of existing template execution ...
}
```

- [x] **4.3** Add `Plugin.client()` export

**File**: `packages/opencode/src/plugin/index.ts`

```typescript
export async function client() {
  return state().then((x) => x.input.client)
}
```

- [x] **4.4** Exclude `plugin.command` from trigger

```typescript
export async function trigger<
  Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "plugin.command">,
  // ...
>
```

- [x] **4.5** Add type guard for plugin functions

```typescript
for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
  if (typeof fn !== "function") continue
  const init = await fn(input)
  hooks.push(init)
}
```

---

### Part 5: SDK Regeneration

Regenerate SDK types after schema changes.

- [x] **5.1** Regenerate SDK types

```bash
cd packages/sdk/js && bun run script/build.ts
```

---

## File Reference Summary

| Path | Changes |
|------|---------|
| `packages/plugin/src/index.ts` | Add `plugin.command` hook type |
| `packages/opencode/src/command/index.ts` | Schema updates, plugin loading, alias resolution |
| `packages/opencode/src/session/prompt.ts` | Plugin command execution (command API path) |
| `packages/opencode/src/plugin/index.ts` | Add `client()` export, type guard, exclude from trigger |
| `packages/opencode/src/config/config.ts` | Extend command config schema for aliases/sessionOnly (if needed) |

---

## Implementation Order

```
Phase 1: Core Infrastructure
  1.1  Add plugin.command hook type
  2.1  Update Command.Info schema
  2.2  Update default commands
  2.3  Update config command loading
  3.1  Import Plugin in command/index.ts
  3.2  Load plugin commands
  3.3  Add alias resolution to Command.get()

Phase 2: Execution Path
  4.1  Import Plugin in prompt.ts
  4.2  Handle plugin commands in SessionPrompt.command()
  4.3  Add Plugin.client() export
  4.4  Exclude plugin.command from trigger
  4.5  Add type guard for plugin functions

Phase 3: Finalization
  5.1 Regenerate SDK types
```

---

## Testing Checklist

### Plugin Commands
- [ ] Create `.opencode/command/hello.ts` with a simple command
- [ ] Verify `/hello` appears in autocomplete
- [ ] Verify `/hello` executes and calls the plugin hook
- [ ] Verify plugin command can use `client` to send messages

### sessionOnly
- [ ] Create command with `sessionOnly: true`
- [ ] Verify `session.command` rejects when session does not meet the required criteria
- [ ] Verify `/cmd` works when sent via the command API for an eligible session

### Aliases
- [ ] Create command with `aliases: ["hi"]`
- [ ] Verify alias resolves via `session.command` (server-side)
- [ ] Verify logs/events use canonical name, not alias

### Error Handling
- [ ] Create command that throws an error
- [ ] Verify error appears in TUI
- [ ] Verify error appears in web app

### Event Emission
- [ ] Create command that sends a message
- [ ] Verify `command.executed` event fires
- [ ] Create command that doesn't send a message
- [ ] Verify no event fires (and no error)

---

## Differences from PR #4411

| Aspect | PR #4411 | This Plan |
|--------|----------|-----------|
| sessionOnly enforcement | Autocomplete only | Server-side in `session.command` execution path |
| Error handling | `TuiEvent.ToastShow` | `Session.Event.Error` |
| Event emission | Missing | Conditional when message created |
| Alias resolution | TUI only | Server-side for command API only |
| Client changes | TUI-only | None |

---

## Estimated Scope

- **New code**: ~70 lines
- **Modified code**: ~30 lines
- **Files touched**: 4-5
