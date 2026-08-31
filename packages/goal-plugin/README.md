# @shuvcode/goal-plugin

One explicit objective per Session for OpenCode V2: `/goal` keeps the objective visible at every model Step, continues automatically after successful executions within strict bounds, and completes only through structured, evidence-backed claims. The full contract lives in [`specs/v2/goal-plugin.md`](../../specs/v2/goal-plugin.md).

## Configuration

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@shuvcode/goal-plugin@0.1.0",
      "options": {
        "command": "goal",
        "limits": {
          "continuations": 10,
          "duration_ms": 900000,
          "tokens": 200000,
          "tool_free_steps": 2,
          "no_progress_steps": 2,
          "prompt_failures": 3,
        },
        "persistence": { "enabled": true },
      },
    },
  ],
}
```

Every limit is a positive integer or `null` to disable; zero never means unlimited. Invalid options fail plugin setup with a field-specific error.

## Usage

```text
/goal migrate auth to the V2 client; success means tests and typecheck pass
/goal status
/goal pause
/goal resume
/goal clear
```

The agent manages the goal through typed tools: `goal_set`, `goal_status`, `goal_pause`, `goal_resume`, `goal_block`, `goal_complete`, and `goal_clear`. Completion requires evidence for every stored success criterion and no failed checks; a rejected claim leaves the goal active and lists exact deficiencies.

## Plannotator handoff

[Plannotator's](https://github.com/plannotator/plannotator) `setup-goal` workflow produces a reviewed goal package at `goals/<slug>/` — `goal.md`, `facts.md`, `facts.meta.json`, and a gated `plan.md` — and ends with:

```text
/goal goals/<slug>/goal.md
```

That invocation is first-class here. The agent reads the package and maps it onto the goal contract: the articulated goal and done condition become the objective, each accepted fact becomes one success criterion verbatim, stated boundaries become constraints, and the package documents become `references` — bounded relative paths rendered into the injected goal context on every Step, so the approved plan survives history compaction. The plan executes in order without re-planning, and facts flagged for automated verification must be backed by passed checks in the `goal_complete` claim.

## Limitations

- **Commands go through the model.** The command callback substitutes the invocation arguments into the goal instructions and re-prompts the same Session with the original delivery mode. The agent then calls the matching lifecycle tool; there are no zero-model-call handlers.
- **Evidence is a claim, not proof.** The completion gate validates structure and consistency locally; it does not independently re-run checks.
- **Restart recovery pauses active goals.** After a plugin or server restart, an active goal recovers as `paused` with stop code `restart_recovery` and requires an explicit `goal_resume`. Ambiguous in-flight work is never replayed automatically.
- **One mutating process per goal.** Goal state is guarded by a no-replace owner file. When another process owns the shard, tools return `owned_elsewhere`; a dead owner (its pid is gone) is adopted automatically. `goal_resume` with `takeover: true` force-replaces the owner — use it only when the previous owner is genuinely dead, because taking over a live owner reduces to last-writer-wins on that state.
- **State may contain private text.** Goals persist under `<project>/.opencode/goals/v2/` (objective, blockers, evidence, local paths). Add `.opencode/goals/` to `.gitignore`.

## Development

```sh
cd packages/goal-plugin
bun test
bun typecheck
```

Load the source directly during development:

```jsonc
{ "plugins": ["./packages/goal-plugin/src/index.ts"] }
```
