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

At this attempt, the next prerequisite was implementing/reviewing L6 and the
scoped importer. That implementation is now complete as documented below.
The historical live-test statuses above remain unchanged: they are not passes.

## Implementation follow-up — offline only, 2026-09-15 PDT

- Both subscription plugins are bundled/enabled by default in Bun and Node
  Shuvcode builds; artifact verification enforces their presence.
- Auth-only importer: `packages/core/script/import-test-auth.ts`, with explicit
  source/new target/window, dry-run, account preservation, private publication,
  secret-safe diagnostics, and no OAuth refresh capability.
- Core refresh resolution coalesces concurrent refreshes; imported access-only
  credentials fail before refresh inside the five-minute safety window.
- 170 focused tests passed: Core/importer/host regressions 90, Claude 21,
  Antigravity 56, artifact guards 3. `bun run check` passed.
- Built a Linux x64 Bun artifact with web UI at
  `/tmp/shuvcode-subscription-build.hGGkoc/bun/shuvcode-linux-x64/bin/shuvcode`.
  SHA-256: `0bdec97a93e0a107ea4d767fbbbe6b94094017052782e8a6567fcb44dbc8923d`.
- Built the Node bundle at `packages/cli/dist-node/opencode.mjs`.
  SHA-256: `6532161ad85638bc4417961c243b96afbb09d6f135d5bcfad007938cbd7a5f43`.
  Both passed bundled-provider verification and isolated version smoke checks.
  Node was validated as a bundle, not a new SEA installer on every platform.
- Packaging smoke checks used a private HOME/XDG wrapper at
  `/tmp/shuvcode-subscription-build.hGGkoc/run-isolated`. No server was started.
- No live credentials were accessed/imported and no provider requests were
  made. Existing old service remained active at PID 22514; no shutdown,
  installation, publish, or tailnet remapping was performed.

Next: rerun readiness and the complete shutdown-first suite with the commands
now in Setup 3a. Source token lifetime/availability and live subscription billing
are still unverified. Do not treat offline implementation checks as the live run.

## Authorized global cutover — 2026-09-15 14:56 PDT

The user subsequently authorized replacing the global install/service and chose
migration of existing sessions/auth rather than a fresh database. This supersedes
the earlier test-only prohibition on installation for this operation; it does not
turn the unexecuted provider tests above into passes.

- Stopped both identified old servers. Preserved the old binary, launchers,
  configuration, and a WAL-safe database backup before conversion.
- Converted a private clone into the new Shuvcode data root, retaining 1,025
  sessions, 35,632 session messages, 86,886 events, and all 9 credentials.
- Removed obsolete fork schema/journal entries, cleared legacy permissions and
  execution claims, and quarantined two background recovery records. Original
  data remains intact. Pending inbox work remains available on explicit resume.
- SQLite integrity/foreign-key checks, preserved counts/IDs, and opening the
  clone with the new runtime Database layer passed.
- Installed the verified Linux x64 artifact above as `2.0.3-shuv.1`; retained
  the existing enabled service and its address. Authenticated status, web root,
  and session list returned 200; unauthenticated API access returned 401.
- A real TUI reached the connected prompt. Both bundled OAuth methods and all
  saved credentials are visible. No prompts or model requests were submitted.
- Removed the obsolete goal-plugin config entry. Four MCP servers connected;
  Executor returned Unauthorized. On the user's subsequent request, removed its
  static Authorization header and static-auth URL parameter, enabled OAuth,
  and verified it now reports `needs_auth`, ready for the user's login.
- Private rollback material and conversion details are under
  `~/.local/state/shuvcode/deployments/20260915-145008-PDT/`.
  Do not restart the old credential owner blindly after new OAuth refreshes.

