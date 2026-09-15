# Live-test results: readiness blocked before shutdown

2026-09-15 13:28 PDT. Execution requested by the user; stopped at the plan's
Setup 3a readiness gate, before any service shutdown, build, auth import or
provider request.

## Source and scope

- Inspected working-copy revision: `49a1f3b613339191e33bca4e5b1e345a51b69cfa`.
- Parent: `3785c69c`, bookmark `v2-rewrite`.
- Pre-existing working-copy change: revised `PLAN-live-test-v2-rewrite.md` only.
- No artifact built; no binary hash or runtime timings claimed.
- Bun, jj, sqlite3, jq, Python 3, termctrl, tailscale and sharkctl are installed
  (executable-path discovery only; versions not checked before the blocker).

## Readiness — BLOCKED

Required Claude Pro/Max and Antigravity support remains unimplemented in this
checkout:

- Neither planned package directory exists under `packages`.
- `packages/core/src/plugin/provider.ts` registers neither integration.
- Targeted searches of Core/CLI/Schema/plugin source found no
  `claude-pro-max`, `antigravity`, `@shuvcode/claude-plugin` or
  `CLAUDE_CODE_OAUTH_TOKEN` implementation.
- `PLAN-fresh-v2-rewrite.md:374` still describes the L6 implementation work.
- The auth-only importer is still a proposed prerequisite in Setup 3a, without
  a reviewed concrete command or verified provider-specific mappings. The
  existing legacy migration is not a substitute for that verification.

The plan explicitly requires these integrations and import readiness before
starting the live suite. API-key smoke tests cannot satisfy the required OAuth
coverage. Implementation was not silently added to this testing task.

## T1 — BLOCKED

Boot not attempted because Setup 3a failed. No test server was started.

## T2 — BLOCKED

TUI/plugin/MCP testing not attempted. No config copied or goal-plugin exclusion
applied; effective config remains unverified.

## T3 — BLOCKED

No credentials read/imported or provider calls made. OpenRouter, Claude Pro/Max
and Antigravity imported-auth cases are all unexecuted.

## T4 — BLOCKED

No model/tool-use cases executed for any provider.

## T5 — BLOCKED

Non-interactive and continue tests not executed.

## T6 — BLOCKED

No pairing exposure created, browser auth attempted, or tailnet mapping changed.

## T7 — BLOCKED

No cold-start measurement attempted.

## T8 — UNVERIFIED

Full post-shutdown integrity comparison was not applicable: shutdown never
began and no protected-file baseline was collected. Read-only unit inspection
reported `ActiveState=active`, `SubState=running`, `MainPID=22514`. The old
service was intentionally left running to avoid downtime for a suite that
cannot pass its prerequisite gate. Other process inventory/ancestry checks
were not completed; no claim is made that all existing clients were enumerated.

## Cleanup and next action

No test-owned process, credential store, artifact, exposure or capture was
created; no test cleanup is needed. No existing service/client was stopped.
No remote token refresh occurred. No old-login recovery is needed from this
attempt.

Test totals: **0 PASS, 0 runtime FAIL, 7 BLOCKED, 1 UNVERIFIED**. Separately,
readiness is BLOCKED. These totals are not a successful live-test run.

Next prerequisite: implement/review the existing L6 Claude/Antigravity tasks
and a scoped auth-only importer, resolve refresh-token ownership safety, then
rerun readiness and the complete shutdown-first live suite. Do not remove
required provider coverage to turn this result into a pass.
