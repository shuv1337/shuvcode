# Live test: v2-rewrite after shutting down existing Shuvcode

Revised 2026-09-15 PDT after plan review. **Plan only: do not execute until
separately authorized.** The user requires all existing Shuvcode servers and
TUIs to be stopped/closed before the test starts. This replaces the original
side-by-side requirement. It is still not a cutover or a migration.

## Goal and boundaries

Exercise the compiled rewrite with real preferences, plugins, MCP servers,
and repos, with isolated config and a fresh session database populated by a
scoped import of existing Shuvcode authentication. Do not alter
the installed binaries, migrate the old database, repair compatibility, or
publish anything.

Workspace: `/home/shuv/repos/shuvcode-workspaces/v2-rewrite`, bookmark
`v2-rewrite`. The original implementation reference was `b95a7cba`; the
reviewed plan's parent was `3785c69c`. Neither is an instruction to change
revisions. Record the exact full source commit actually built and its clean
working-copy state, plus the binary SHA-256. If implementation has changed
since review, review the relevant changes before proceeding.

Full L3 session/database conversion remains out of scope. **Auth-only import,
Claude Pro/Max and Antigravity are required coverage**, superseding the earlier
L6 exemptions. Missing provider support is a prerequisite blocker, not an
acceptable omission or permission to silently implement L6.

- Import existing OpenRouter, Claude Pro/Max and Antigravity auth into private
  test-owned stores; import no old sessions or execution claims. Record exact
  source-to-target account/method mappings without secret values.
- Test real subscription/OAuth model calls and tool use for Claude Pro/Max
  and Antigravity. Anthropic/Google API-key calls are not substitutes.
- Remove stale `goal-plugin` references from the **test config only**, consistent
  with decision 16 in `PLAN-fresh-v2-rewrite.md`. An uninstalled plugin should
  not be requested; verify no load attempt or failure entry occurs.
- Plannotator plugin compatibility is unknown; record its actual behavior.
- Plugin/MCP activity can have external side effects even with a copied
  config. Inventory those effects before allowing startup; do not invoke
  unrelated mutating tools merely to test connectivity.

## Historical host facts — revalidate, do not assume

Previously observed on 2026-09-15 PDT:

- Old launchers: `~/.local/bin/shuvcode` and `~/.npm-global/bin/shuvcode`.
- Old version `v2.0.0-alpha-20`; user unit `shuvcode.service`; listener
  `<tailscale-ip>:4096`. Its config-dir drop-in uses `~/.config/shuvcode`.
- Tailnet mappings include 10001 → `127.0.0.1:4096` and 10000 →
  `127.0.0.1:8787`. Preserve the complete actual mapping, not just these two.
- Old data/state use `~/.local/share/opencode` and `~/.local/state/opencode`.
  New defaults use `~/.local/share/shuvcode`, `~/.local/state/shuvcode`, and
  `~/.cache/shuvcode`. These directories may now contain an active service
  or valuable data; they are not presumed empty.
- Both versions can read `~/.config/shuvcode`; the new build must override it.
- Bun was 1.4.2. This is a non-colocated jj workspace; set the build channel.

## Hard rules

- Execute from an independent harness/terminal, **not inside any Shuvcode
  process being stopped**. Move the handoff first if necessary. An independent
  harness running in a Shuvcode-owned persistent PTY is not sufficient.
- Stopping the identified old `shuvcode.service` is now intentional. Do not
  restart or disable it, edit its unit/drop-ins, or mask it persistently.
  Leave old servers and TUIs off after the test; restart requires a separate
  user request. Record the expected downtime of the old 10001 backend.
- Do not run the old CLI's `service` commands. Stop its known manager instead.
- Do not edit old config/data/state. Graceful old-server shutdown may itself
  flush its DB and registration; establish the immutable baseline **after**
  shutdown. Do not classify that expected shutdown flush as a test mutation.
- Never globally install Shuvcode or replace its PATH launchers. Never push
  `v2-rewrite`, touch `integration-v2`, or convert the old database. Initializing
  the private test DB and the scoped auth-only import are the only exceptions
  to keeping existing database contents out of this test.
- Do not change tailnet mappings 10000/10001 or any existing review mapping.
  Use 10002 only if unowned, and remove only the mapping this run creates.
- All invocations of the compiled new binary use the wrapper below. Building,
  hashing, and file inspection are not binary invocations.
- Do not record passwords, API keys, full secret-bearing config, pairing QR
  payloads, or secret command arguments. No shell tracing or environment dumps.

## 0. Read-only preflight, then controlled shutdown

1. Load the `terminal-control` and `shark` skills. Verify installed tools:
   Bun, jj, sqlite3, jq, Python 3, termctrl, tailscale, sharkctl. Record versions.
2. Confirm the executing agent and its PTY/process ancestry are independent.
   Inventory all existing Shuvcode servers and TUIs, including source/dev
   clients, other channels, standalone servers, and background managers.
   Record exact PIDs, executable paths, parent relationships, service units,
   registration locations, listeners, and client/session owners. Avoid full
   process argument dumps, which can contain secrets. Names alone do not prove
   ownership. Resolve unknown owners with the user; never broad `pkill`/`killall`.
3. Record pre-shutdown old unit activity, PID and start time, binary hashes,
   config hashes/mtimes, and the complete `tailscale serve status --json`.
   Store baseline evidence in a private directory outside the repo. Record
   only safe summaries in the eventual results. Capture any available old
   plugin/MCP results now from existing evidence or an already-open TUI;
   do not launch an old client during the new test. If unavailable, mark the
   old comparison UNVERIFIED rather than inventing a baseline.
4. Coordinate with owners to finish/interrupt active work and save sessions.
   Gracefully close **all existing Shuvcode TUIs first**, preventing clients
   from automatically restarting their server. Then stop the identified old
   user unit with `systemctl --user stop shuvcode.service`. Stop every other
   inventoried server through its verified manager or graceful termination of
   its exact PID. Request separate approval before forced termination or
   configuration changes needed to suppress another manager's respawn.
5. Verify all inventoried clients/servers have exited, their listeners are
   gone, and managers are not respawning them. Repeat the check after a short
   observation interval. Confirm the old unit is inactive, not failed or
   still deactivating. **Do not begin setup/tests if any remain.**
6. Capture the post-shutdown baseline: old config/data/state file hashes and
   metadata, installed binary hashes, unit/drop-in hashes, and tailnet
   configuration. The old database is now quiescent; include its sidecar state.
   Inventory existing auth in the old credential DB and provider-owned stores
   (including auth.json and antigravity-accounts.json where present). Read only;
   report provider/method IDs, account aliases, active selection, credential
   types and expiration status, never secrets. Resolve the authoritative store
   for each account; do not assume legacy JSON files are current.
7. Check port 4919 is free and tailnet port 10002 has no mapping. Inspect any
   `~/.local/state/shuvcode/service.json` through a safe projection of
   `{pid,url,version}`. Resolve stale/live ownership before service setters:
   setters call `Service.stop` against this state path regardless of config
   isolation. Do not delete unknown registrations or adopt a live service.
8. Require fresh test/config/database and artifact destinations. If the paths
   below already exist, preserve them under an agreed archival name and verify
   they are not in use, or stop for a new destination decision. The build
   script recursively removes its output directory; never point it at an
   unreviewed or shared directory. Reject destination symlinks into old roots.

Create a private evidence directory (mode 0700) and record its path in the
results. Establish cleanup ownership tracking before any new server or tailnet
mapping is created. On failure/interruption, close test clients first, stop
only the owned test server, remove only the owned temporary mapping, and
verify the old processes remain off. If ownership cannot be proved, stop and
report rather than guessing a PID to terminate.

## Setup

### 1. Build and identify the full artifact

From a clean, recorded revision:

```sh
cd /home/shuv/repos/shuvcode-workspaces/v2-rewrite
jj status
jj log -r @ --no-graph -T 'commit_id ++ "\n"'
cd packages/cli
OPENCODE_CHANNEL=latest OPENCODE_VERSION=2.0.3-shuv.1 \
  bun run script/build.ts --single --outdir=/home/shuv/.local/opt/shuvcode-next
sha256sum /home/shuv/.local/opt/shuvcode-next/shuvcode-linux-x64/bin/shuvcode
```

Use a background job for the build. Do not pass `--skip-web-ui`; pairing needs
the web root. Record elapsed build time, Bun version and artifact hash. Abort
if the working copy changes during the build; do not claim a clean pinned
artifact in that case. No global installation is needed.

### 2. Copy the real config deliberately

Use `T=/home/shuv/.local/share/shuvcode-live-test`; create it with mode 0700
and a `config` child. Before copying, inventory actual sources in
`~/.config/shuvcode`, including:

- `opencode.json`, `opencode.jsonc`, and any legacy `config.json` (record which
  consumers support the latter rather than assuming it is a core config).
- Both `plugin` and `plugins`, commands, `skills`/`skill`, prompts, themes,
  `tui.json`/`tui.jsonc`, `cli.json`, and `AGENTS.md`.
- Dependency manifests/lockfiles and local `node_modules` needed by plugins.

Copy each existing selected source with checked exit status. Missing optional
sources are recorded as absent, not copy errors. Never suppress all stderr.
Exclude `service*.json`, their temporary files, and server registrations.
Inspect symlink destinations before copying: `cp -a` preserves links, including
relative links that may break or point back into old writable roots. Materialize
writable config/dependency targets inside the test tree; retain shared
instruction/skill/plugin source links only after explicitly documenting them
as intentionally shared and reviewing their write behavior. Preserve the
meaning of the global `AGENTS.md` link without changing its source.

Compare copied regular-file hashes with the sources; verify resolved links.
Do not dump file contents. Inventory absolute plugin paths, MCP commands,
external state directories and inherited credential **names**, not values.
If an enabled plugin/MCP writes protected old roots or requires competing
ownership, stop for a test-copy-only isolation decision; a copied config alone
is not a sandbox. Record every approved test-copy deviation and its coverage
impact. Remove stale goal-plugin references from all contributing test sources,
including copied plugin directories if applicable. If shared project config
still requests it, use a verified test-only exclusion and confirm the resolved
catalog; do not edit the real/project config. If exclusion is not supported,
resolve that blocker rather than accepting a load failure. Record this
intentional exclusion separately from compatibility findings.

### 3. Wrapper and path verification

Create `/home/shuv/.local/opt/shuvcode-next/run` with the following content;
do not execute credential-bearing commands under tracing:

```bash
#!/usr/bin/env bash
set -euo pipefail
set +x
for v in ${!OPENCODE_@}; do unset "$v"; done
export OPENCODE_CONFIG_DIR=/home/shuv/.local/share/shuvcode-live-test/config
export OPENCODE_DB=/home/shuv/.local/share/shuvcode-live-test/auth/opencode.db
export OPENCODE_DISABLE_AUTOUPDATE=1
# Import credentials once into test-owned stores; do not reread old auth here.
# Prevent environment fallback from masking the imported auth under test.
unset OPENROUTER_API_KEY ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
unset GOOGLE_API_KEY GOOGLE_GENERATIVE_AI_API_KEY GEMINI_API_KEY
exec /home/shuv/.local/opt/shuvcode-next/shuvcode-linux-x64/bin/shuvcode "$@"
```

Set mode 0700. Set `N=/home/shuv/.local/opt/shuvcode-next/run` in each shell
that needs it; variables do not automatically persist across agent tool calls.
Run `$N --version` and `$N debug paths`. Verify version `2.0.3-shuv.1`, test
config and database paths, and the expected new data/state/cache roots. Abort
on any unexpected XDG override; never silently accept an old root.

Audit the implemented plugins' environment methods; extend the unset list for
any additional variable that could mask imported auth. Other unrelated
credential variables remain inherited for real-config fidelity; record names
only. Verify selected connections are the imported accounts, not fallbacks.

### 3a. Required provider support and auth-only import gate

Check implementation readiness before scheduling shutdown where possible;
credential import and provider requests occur only after shutdown. Complete
this gate before the new server starts or provider coverage is claimed.

1. Verify the artifact includes the implemented `packages/claude-plugin` and
   `packages/antigravity-plugin`. Both are enabled in Core's default provider
   registry and bundled in Bun and Node installs; no `plugins` entry or separate
   installation is needed. Their integration/method pairs are
   `anthropic` / `claude-pro-max` and `google` / `google-ai-pro`. Build verification
   now rejects artifacts missing either bundled implementation. Do not
   substitute ordinary Anthropic/Google API-key tests for subscription coverage.
2. Use the implemented offline helper `packages/core/script/import-test-auth.ts`,
   documented in `packages/core/script/import-test-auth.md`. It reads an explicit
   checkpointed source DB into a read-only in-memory connection, validates all
   selected accounts, preserves effective active selection, and uses typed
   Core credential services to publish a fresh private target atomically.
   It does not boot a server, copy sessions, or modify source stores. The public
   credential HTTP group is not an import API. Run the helper from Core, not
   the ordinary CLI auth runtime.
3. Do not blindly place auth.json in the normal new data root. The migration
   `packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts`
   reads `global.data/auth.json` and guesses generic OAuth method IDs; it does
   not establish compatibility with these plugins. Validate method IDs, token
   fields, expiry units, metadata and provider-owned account state against the
   implemented integrations. Block rather than silently drop required accounts.
4. Read authoritative sources only after shutdown. Import required auth once
   into test-owned storage (directories 0700, secret files 0600), without
   printing secret values. Ensure target plugins read/write private test stores,
   not old HOME-based account files. Import no sessions or execution claims.
   Report only provider/account aliases, types, active selection and counts.
5. **Refresh-token safety:** the helper marks imported OAuth metadata with
   `shuvcodeAuthImport: "access-only"`, removes its refresh token, and requires
   real access-token expiry beyond the test window plus five minutes. Core
   rejects resolution at the five-minute boundary before any refresh callback;
   both plugins also reject marked refresh attempts. Imported Antigravity
   activation uses shipped models without discovery requests. Claude setup-token
   keys are supported unchanged; ordinary Anthropic API keys are not substitutes.
   Stop before the declared window ends. If the source lacks usable access tokens,
   the suite is BLOCKED: this importer has no refresh-transfer option. Obtain a
   separate explicit recovery/ownership-transfer decision instead of disabling
   the guard or inventing expiry. Never copy refreshed tokens back automatically;
   backups cannot undo remote invalidation.
6. Verify imported metadata and active selection offline; after boot confirm
   the catalog resolves those exact accounts/methods. No provider call occurs
   until the safety gate passes. Record any remote auth changes for restoration.

Implementation is present; live auth validity/billing remain unverified. After
shutdown and source inventory, choose a future test-window end with Pacific
offset. From `packages/core` run the same command first with `--dry-run`, then
without it only after the safe summary passes:

```sh
bun run script/import-test-auth.ts \
  --source /home/shuv/.local/share/opencode/opencode.db \
  --target /home/shuv/.local/share/shuvcode-live-test/auth \
  --window-end "$TEST_WINDOW_END" \
  --dry-run
```

`TEST_WINDOW_END` must be set explicitly, for example an actual future time in
`YYYY-MM-DDTHH:MM:SS-07:00` format during PDT. The parent test directory may
already hold copied config, but the `auth` target must not exist. The wrapper
above points to the published `auth/opencode.db`. Optional mapping and complete
legacy Google account formats are documented beside the helper; incomplete
refresh-only accounts are rejected rather than silently refreshed. Record the
actual implementation revision used. Synthetic coverage includes multi-account
selection/restart, no source/session/claim copying, private permissions,
secret-safe rejection, setup tokens, and refresh prohibition. Rerun these
checks from Core before live use:

```sh
bun run test test/credential-import.test.ts test/integration-refresh.test.ts \
  test/plugin/bundled-subscriptions.test.ts test/plugin/provider-antigravity.test.ts
```

Do not disable no-refresh protections to get the test running.

### 4. Configure the new service without exposing its password

Only after shutdown and registration ownership checks:

```sh
$N service set hostname 127.0.0.1
$N service set port 4919
jq '{hostname,port}' /home/shuv/.local/share/shuvcode-live-test/config/service.json
```

These setters do **not** create the password. Fresh managed-service startup
generates and persists it. Never `cat` either service config or registration.

## Results discipline

Create `PLAN-live-test-v2-rewrite-results.md` only when executing the plan.
Use one heading per test and status **PASS**, **FAIL**, **BLOCKED**, or
**UNVERIFIED**, with exact safe observations and timings. Missing required
support/auth is BLOCKED; a tested malfunction is FAIL. Neither permits an
overall pass. Short, sanitized TUI
captures only. Use termctrl per its skill; use the wrapper for new clients.

## Tests

### T1 — Boot with old processes shut down

Confirm no old or new Shuvcode listener/client has returned, then:

```sh
time $N service start
$N service status
ss -ltn | grep -E ':4096|:4919' || true
jq '{pid,url,version}' ~/.local/state/shuvcode/service.json
```

Pass: only the owned new server listens on 127.0.0.1:4919; registration PID,
version and URL match; the test DB is created at `OPENCODE_DB`; old processes
remain absent and old unit inactive. Locate and record the actual new log path
under the new data root; do not assume a filename or dump unredacted logs.

### T2 — Real config, plugins and MCP

```sh
cd /home/shuv/repos/shuvcode-workspaces/v2-rewrite
termctrl start next --host opentui --cols 140 --rows 40 -- $N .
termctrl wait next "Ask anything"
termctrl show next
```

Use a bounded wait per the current termctrl skill. Inspect `/plugins` and
`/mcps`; record each loaded/failed entry and sanitized error. Verify any
`-` disable marker is an actual configured plugin operation, not merely a
filename convention. Verify goal-plugin is absent from the effective requested
plugin set, with no load attempt or failure entry. A stale reference is a
configuration defect, not an expected runtime failure. Required Claude and
Antigravity integrations must load. Plannotator compatibility is unknown.

Compare the actual MCP inventory (historically cua-driver, executor,
skills-mcp, shuvshow, macos-cua) with pre-shutdown evidence. **Do not launch
an old TUI/server for comparison.** Missing old evidence is UNVERIFIED.

Pass: home and catalog appear within ~10s (watchlist B4). Record old-working/new-failing MCPs as findings, not fixes.

### T3 — Credentials and providers

```sh
$N auth list
$N models
```

Capture only safe rows and diagnostics. Verify imported OpenRouter key,
Claude Pro/Max subscription auth and Antigravity OAuth/account state resolve
to their intended accounts. Record full model IDs for all three. Confirm
connection source/method metadata, not just the display name: an Anthropic
API-key model does not prove Claude subscription auth, and a Google API-key
model does not prove Antigravity. Do not print account emails or token values.

Make one small real request per imported connection, with explicit model and
account selection and environment fallback excluded. Record streaming success,
provider/method, response outcome, elapsed time and safe usage metadata.
Exercise restart persistence using the same test stores (close clients before
server restart). If refresh is needed, use only the separately approved path
from Setup 3a; record refresh/cancel/error behavior and whether old login
recovery is required. Unexercised refresh is explicitly UNVERIFIED, not claimed
as validated. Do not force expiry or trigger revocation to manufacture coverage.

Pass requires all three imported-auth requests and restart persistence to work.
Expired/missing auth or missing plugin support blocks the relevant required
case and overall acceptance; do not silently replace imported auth with a new
login. Any recovery/login must be approved and human-operated in an unrecorded
secret prompt, with the deviation documented.

### T4 — Prompt and tool use in a real repo

Run separate cases using the OpenRouter, Claude Pro/Max and Antigravity
connections verified in T3. Record each full model ID and imported account
alias. Record expected read-only jj output beforehand; the current working-copy
description may legitimately be empty. Use the same prompt for each:

```text
Read packages/util/src/global.ts and tell me the value of `app`. Then run `jj log -r @ --no-graph -T description` and paste the output.
```

Pass: read/bash tools execute, permission behavior matches the copied config,
answer contains `shuvcode`, and jj output matches the baseline (not necessarily
a nonempty commit message). Record session ID, token/cost footer, and time to
first token for each provider. Claude subscription calls must use the intended
subscription transport, not billable API-key fallback; zero displayed cost alone
is not proof. Antigravity calls must use the imported OAuth account. If safe
transport/account evidence is unavailable, mark that assertion UNVERIFIED.
Do not authorize repository edits during these probes. All three tool-use
cases are required, not optional substitutions for one another.

### T5 — Non-interactive and continue

From the same repo, substitute the model ID established in T4:

```sh
$N run -m openrouter/<model-id> "Reply with exactly: ok"
$N session list
termctrl start next2 --host opentui --cols 120 --rows 36 -- $N --continue .
```

Pass: assistant text is `ok`; continue opens the exact run session ID.
Compare full session IDs/counts before and after; don't truncate the list and
then claim a count match (watchlist B3). Record any extra sessions created by
opening an empty TUI separately.

### T6 — Temporary tailnet pairing

Recheck that 10002 remains unowned, record ownership when creation succeeds,
and register failure/interruption cleanup before the test:

```sh
tailscale serve --bg --https=10002 http://127.0.0.1:4919
```

Have the user run `$N pair --url https://<host>.<tailnet>.ts.net:10002`
in a private, unrecorded terminal. It prints the password and a QR containing
it. Do not run this in a captured agent shell/PTY. The user enters credentials
directly in the browser/phone; the agent must not request the password in chat.

Send only the URL with SHark and open it locally:

```sh
sharkctl notify --url https://<host>.<tailnet>.ts.net:10002 \
  "Rewrite pairing test: use credentials from your private terminal." \
  --idempotency-key <unique-test-run-pairing-key>
xdg-open https://<host>.<tailnet>.ts.net:10002
```

Unauthenticated `/api/status` must return 401. For the authenticated probe,
use a local helper that reads the generated password directly from the
private test config and sends Basic auth in memory (username `opencode`).
It must print only HTTP status plus `{version,pid}` from the response, and
never headers, config, raw exceptions containing secrets, or a literal
`curl -u` command. Create/review that bounded helper when executing; no password
in shell arguments or environment dumps. Verify 200, version `2.0.3-shuv.1`
and PID equal to the test registration (`ServerStatus` defines both fields).
A status-only curl with discarded body does not verify identity.

Pass: phone/local UI load and list the three T4 sessions; other tailnet mappings are
unchanged. The old 10001 backend is deliberately offline, not a regression.
If human pairing cannot be completed, mark it BLOCKED rather than claiming
success from the HTTP probe alone.

Always remove the **owned** 10002 mapping, including on failure:

```sh
tailscale serve --https=10002 off
```

Compare the complete remaining configuration to baseline. Preserve unrelated
review mappings. Do not demand that only 10000/10001 remain.

### T7 — Genuine cold start

Close `next`, `next2`, and any other test clients first. Their managed
reconnection calls `Service.ensure` and can otherwise invalidate this test.
Then `$N service stop`; wait for its exact PID/listener to disappear, and
verify no old/new client or competing manager restarts it.

Create a timing directory inside the private test evidence directory. Record
Python `time.monotonic_ns()` immediately before launching:

```sh
termctrl start cold --host opentui --cols 120 --rows 36 -- $N /home/shuv/repos/shuvcode-workspaces/v2-rewrite
```

Poll bounded termctrl snapshots for home and model footer; timestamp each
with the same monotonic clock. Include launch overhead and polling resolution
in the report. Abort the measurement if another client restarts the server.
Pass: home <10s and model appears within ~1s of home (watchlist B1). Both times
are measured, not inferred from a fixed sleep. Stop `cold` afterward.

### T8 — Protected installation intact; old services remain off

After final teardown, compare protected old config/data/state and installed
binary hashes/metadata against the **post-shutdown** baseline. Compare unit
and drop-in hashes and complete tailnet configuration. Confirm old unit is
inactive, every old client/server is absent, and no test listener remains.
Old PID/start-time changes due to the requested shutdown are expected; old
HTTP availability is no longer a pass criterion.

Pass: no test-induced protected-file changes and no unintended restart.
If differences appear, stop and report exact safe evidence; do not repair,
restore a live DB, or restart the old service automatically.

## Teardown and rollback boundary

Run cleanup on success, failure, and interruption:

1. Close all owned test clients (`next`, `next2`, `cold`, and any extras).
2. Verify registration ownership, then `$N service stop`; check its PID and
   listener are gone and stay gone. Do not stop an unexpected replacement PID.
3. Remove 10002 only if still the mapping created by this run; compare all
   other tailnet mappings against baseline.
4. Perform T8. **Leave all Shuvcode servers and TUIs stopped.** Restoring old
   service availability is a separate user-authorized operation, not rollback
   performed by this test agent.
5. Retain artifact/test/evidence directories privately and record sizes.
   Do not delete the new default data/state roots (reserved for later L3).
   Never commit copied config, databases, keys, pairing output, or raw logs.

## Report and scoped commit

- Record revision/artifact identity, sanitized preflight/shutdown evidence,
  copied-config deviations, all test results, timings, cleanup evidence,
  and the fact that the old service remains intentionally stopped.
- Record missing Claude/Antigravity support or auth-import readiness as required
  blockers under the owning L6/auth work, referencing existing tasks rather
  than duplicating them. Record runtime regressions separately. No L6 omission
  exempts the required cases in this revised test plan.
- Recheck `jj status` and inspect the documentation diff. Commit only intended
  result/plan paths with `jj commit -m 'docs: record live rewrite test results'
  <explicit-documentation-paths>`. If other changes are present, leave them
  untouched; do not use an unrestricted commit. No push.
- Send a SHark summary with PASS/FAIL/BLOCKED/UNVERIFIED counts, per-provider
  imported-auth/tool-use results, cleanup state, any auth-recovery requirement,
  and intentional old-service downtime. A clean test
  does not authorize migration, cutover, restart, or installation.
