# Plan: Fix Default Agent Not Applied in Shuvcode (Issue #255)

**Issue:** [#255 - Default agent does not apply in shuvcode](https://github.com/Latitudes-Dev/shuvcode/issues/255)  
**Created:** 2026-01-03  
**Author:** iamhenry  
**Priority:** High (Bug)

---

## Problem Statement

The `default_agent` configuration option is not respected in the shuvcode TUI. When a user sets a custom default agent (e.g., `"orchestrator"`) in their config, the TUI always starts with the first agent in the list (typically `"build"`) instead of the configured default.

### User Report

> In my config I have the `orchestrator` custom agent set as my default and it works as expected in opencode. However in shuvcode it always starts with the `build` agent and doesnt respect the config.

```json
"default_agent": "orchestrator"
```

---

## Root Cause Analysis

### The Bug

The TUI's local context initializes the current agent using the first agent in the list rather than checking for the `default` property that's set by the Agent module based on the user's `default_agent` configuration.

**Location:** `packages/opencode/src/cli/cmd/tui/context/local.tsx:42`

**Current (Buggy) Code:**
```typescript
const [agentStore, setAgentStore] = createStore<{
  current: string
}>({
  current: agents()[0].name,  // <-- Always uses first agent
})
```

### How It Should Work

1. User sets `default_agent: "orchestrator"` in their `opencode.json`
2. The `Agent.state()` function in `packages/opencode/src/agent/agent.ts:269-279` marks the configured agent with `default: true`
3. The TUI should look for an agent with `default: true` and use that as the initial selection
4. If no default is found, fall back to the first agent

### Upstream Fix

This issue was fixed in upstream opencode in commit `8f6c8844d` (PR #5843):

**Fixed Code:**
```typescript
const [agentStore, setAgentStore] = createStore<{
  current: string
}>({
  current: agents().find((x) => x.default)?.name ?? agents()[0].name,
})
```

---

## Technical Context

### Agent Default Property Flow

1. **Config Schema** (`packages/opencode/src/config/config.ts:722-727`):
   ```typescript
   default_agent: z
     .string()
     .optional()
     .describe(
       "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
     ),
   ```

2. **Agent State Processing** (`packages/opencode/src/agent/agent.ts:269-279`):
   ```typescript
   // Mark the default agent
   const defaultName = cfg.default_agent ?? "build"
   const defaultCandidate = result[defaultName]
   if (defaultCandidate && defaultCandidate.mode !== "subagent") {
     defaultCandidate.default = true
   } else {
     // Fall back to "build" if configured default is invalid
     if (result["build"]) {
       result["build"].default = true
     }
   }
   ```

3. **Server-side Default Agent** (`packages/opencode/src/agent/agent.ts:300-304`):
   ```typescript
   export async function defaultAgent(): Promise<string> {
     const agents = await state()
     const defaultCandidate = Object.values(agents).find((a) => a.default)
     return defaultCandidate?.name ?? "build"
   }
   ```

### Agent Info Type

The `Agent.Info` type includes a `default?: boolean` property that gets set when the agent matches the configured `default_agent`.

---

## Implementation Plan

### Task 1: Apply the TUI Fix

- [ ] **1.1** Modify `packages/opencode/src/cli/cmd/tui/context/local.tsx` line 42
  - Change: `current: agents()[0].name,`
  - To: `current: agents().find((x) => x.default)?.name ?? agents()[0].name,`

### Task 2: Add Unit Tests

- [ ] **2.1** Create new test file or extend `packages/opencode/test/agent/agent.test.ts`
  - Add test: "default_agent config sets default property on specified agent"
  - Add test: "default_agent falls back to build when invalid agent specified"
  - Add test: "defaultAgent() returns configured default agent name"

- [ ] **2.2** Example test cases:
  ```typescript
  test("default_agent config sets default property on specified agent", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })
        const agentDir = path.join(opencodeDir, "agent")
        await fs.mkdir(agentDir, { recursive: true })

        // Create custom agent
        await Bun.write(
          path.join(agentDir, "orchestrator.md"),
          `---
  model: test/model
  mode: primary
  ---
  Orchestrator agent prompt`,
        )

        // Set as default
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            default_agent: "orchestrator",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Agent.list()
        const orchestrator = agents.find((a) => a.name === "orchestrator")
        expect(orchestrator?.default).toBe(true)
        
        const build = agents.find((a) => a.name === "build")
        expect(build?.default).toBeFalsy()
        
        const defaultName = await Agent.defaultAgent()
        expect(defaultName).toBe("orchestrator")
      },
    })
  })
  ```

### Task 3: Verify Related Code Paths

- [ ] **3.1** Review other locations where agent initialization happens:
  - `packages/opencode/src/cli/cmd/run.ts` - CLI run command
  - `packages/opencode/src/cli/cmd/github.ts` - GitHub integration
  - `packages/opencode/src/session/prompt.ts` - Session prompts
  - `packages/opencode/src/acp/agent.ts` - ACP agent handling

- [ ] **3.2** Ensure all paths use `Agent.defaultAgent()` or check the `default` property

### Task 4: Testing & Validation

- [ ] **4.1** Run type checking: `bun turbo typecheck`
- [ ] **4.2** Run test suite: `bun test` in `packages/opencode`
- [ ] **4.3** Manual testing:
  - Create a custom agent file in `.opencode/agent/`
  - Set `default_agent` in `opencode.json`
  - Launch TUI with `bun dev`
  - Verify the configured agent is selected on startup
  - Verify agent cycling (`tab`/`shift+tab`) works correctly

---

## File References

### Internal Files to Modify

| File | Line(s) | Change Description |
|------|---------|-------------------|
| `packages/opencode/src/cli/cmd/tui/context/local.tsx` | 42 | Fix initial agent selection |
| `packages/opencode/test/agent/agent.test.ts` | New | Add default_agent tests |

### Internal Files for Reference (No Changes)

| File | Purpose |
|------|---------|
| `packages/opencode/src/agent/agent.ts:269-304` | Agent default marking & defaultAgent() function |
| `packages/opencode/src/config/config.ts:722-727` | default_agent config schema |
| `packages/opencode/src/session/prompt.ts:730,1374,1536` | Uses Agent.defaultAgent() |
| `packages/opencode/src/server/server.ts:503-504,1154,1158` | Uses Agent.defaultAgent() |
| `packages/opencode/src/acp/agent.ts:709-710,812` | Uses Agent.defaultAgent() |

### External References

| URL | Description |
|-----|-------------|
| https://github.com/sst/opencode/commit/8f6c8844d | Upstream fix commit |
| https://github.com/sst/opencode/pull/5843 | Upstream PR with full context |

---

## Validation Criteria

### Definition of Done

1. **TUI respects `default_agent` config** - When launching the TUI, the configured default agent should be selected
2. **Fallback works** - If `default_agent` is not set or invalid, the first agent should be selected
3. **Tests pass** - All existing tests continue to pass
4. **New tests added** - Tests cover the default_agent configuration and TUI initialization
5. **Type check passes** - No TypeScript errors introduced

### Test Commands

```bash
# Type check
cd packages/opencode && bun run typecheck

# Unit tests  
cd packages/opencode && bun test

# Full turbo test
bun turbo test

# Manual TUI test
cd packages/opencode && bun dev
```

---

## Rollback Plan

If the fix introduces regressions:

1. Revert the single line change in `local.tsx`
2. Return to: `current: agents()[0].name,`

---

## Notes

- This is a straightforward one-line fix from upstream
- The server-side `Agent.defaultAgent()` function already works correctly
- The bug is specifically in the TUI's client-side agent initialization
- The fix aligns with how other parts of the codebase respect the default agent setting
