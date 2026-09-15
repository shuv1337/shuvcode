# v2-rewrite watchlist: past fork fixes, verify before re-applying

Companion to `PLAN-fresh-v2-rewrite.md`. Preserve with the implementation
plans for the clean `v2.0.3` line. Nothing here is in scope for the first
alpha by default. An item enters the plan only when its check fails on the
pinned upstream tree at kickoff.

Status legend, as of `upstream/v2` `d0a902815d` (2026-09-15 PDT):

- **code absent** — the fork's fix is not in the tree; the code path it
  patched still has the pre-fix shape. Bug not reproduced.
- **unverified** — only the fork commit and its stated incident are known.

Each entry: symptom, original evidence, fork fix, upstream state, check.

## Gate run 2026-09-15 PDT on `d0a902815d`

Scratch XDG root (`/tmp/opencode/gate-xdg`), OpenRouter key only, dev-mode
`bun run dev` (bun 1.3.14). Provider-native checks need the L6 plugins
(only a `sk-ant-oat` setup-token and Antigravity OAuth exist on this host).

| Item | Result | Evidence |
|---|---|---|
| A1, A2, A3, A4, A5, C2, B7 | **deferred to L6** | need bundled Claude / Antigravity / Codex plugins for native-protocol credentials |
| A6 | **pass → closed** | upstream `provider/openai.ts:292` already caps ChatGPT `limit.context 400_000 / input 272_000` |
| A7, B5, B6, D2, D4 | **closed by rule** | no cheap check / no consumer; not re-opened |
| A8 | decide with Codex plugin | not a bug |
| B1 | **pass → closed** | cold start, no server: home at 3.6s, model in footer at 4.1s |
| B2 | **FAIL → plan item (L5)** | `WellKnown.inspect` against an accept-and-never-respond origin still pending at 15s. Host has no wellknown sources configured, so it cannot bite today; the timeout is a guard, not a fix for a live incident |
| B3 | **pass → closed** | `--continue` reopened the session; `session_v2` count stayed 1 |
| B4 | **pass → closed** | two broken MCP servers (`local` bad command, `remote` dead port); catalog loaded at 3.5s, footer `2 MCP failed` |
| C1 | **pass → closed** | patch `Update File: link.txt` + `Move to:` on a symlink: link removed, real file kept (`file-access.ts:100` resolves lexically now) |
| D1 | **pass → closed** | host bun upgraded to 1.4.2; single-target compiled binary run 13× (`--version`/`--help`) leaves one content-hashed 6.0 MB `.bun-1000-<hash>.so`, reused, not one per call. `BUN_TMPDIR` drop-in is optional now |
| D3 | **carry as notes into L1** | not checkable without the new publish workflow |

Toolchain finding for L0: the tree requires bun ≥ 1.4.2 for `script/build.ts`
(host upgraded to 1.4.2 during the gate). `script/build.ts` also shells out
to `git branch --show-current`; a non-colocated jj workspace has no `.git`,
so set `OPENCODE_CHANNEL` explicitly (D3's detached-HEAD case in a new
form). Dev-mode server
spawn from a project directory needs a `bunfig.toml` preload
(`@opentui/solid/preload`) reachable from that cwd; `dev:live` avoids this.

## A. Provider / model requests

### A1. Max-step guardrail sent as assistant prefill

- Symptom: on the last allowed step, Anthropic models fail the request
  instead of producing a final answer.
- Evidence: PR #356 ("Anthropic rejects synthetic assistant prefills").
- Fork fix: `0ce88dbfa298`; `runner/llm.ts` appends `Message.user(MAX_STEPS_PROMPT)`.
- Upstream: **code absent**. `runner/llm.ts:236` appends `Message.assistant(...)`;
  `anthropic-messages.ts` sends trailing assistant text as a prefill.
- Check: agent with `steps: 2`, Claude with thinking enabled, force a tool
  call on step 1. Pass if step 2 returns text; fail on an Anthropic 400.

### A2. Gemini optional object parameters lose their type

- Symptom: every Gemini tool call 400s (`INVALID_ARGUMENT`) when an MCP tool
  declares `"type": ["object","null"]`.
- Evidence: PR #355.
- Fork fix: `98174c714000`; single non-null `type` kept on the node.
- Upstream: **code absent**. `gemini-tool-schema.ts:77` sets `type: undefined`
  for a one-element non-null array and relies on `nullable`.
- Check: register an MCP tool with an optional object param (cua-driver has
  them), prompt Gemini to call any tool. Pass if the call is accepted.

### A3. Gemini boolean `const` / non-string enum

- Symptom: Gemini rejects schema with `enum: [true]`.
- Evidence: `70ca444f0e14`, #357 follow-up.
- Fork fix: drop boolean `const`, fold other `const` into a string enum.
- Upstream: **code absent**. `gemini-tool-schema.ts:84` emits `enum: [schema.const]`.
- Check: same as A2 with a tool that has `const: true`.

### A4. Anthropic rejects MCP top-level `anyOf` / `oneOf` / `allOf`

- Symptom: every Anthropic request 400s once such a tool is in the catalog.
- Evidence: issue #357 (cua-driver `browser_prepare`), installed binary.
- Fork fix: `70ca444f0e14`, `ToolSchemaProjection.anthropic` hoist.
- Upstream: **code absent**. `tool-schema.ts` has `gemini`, `moonshot`,
  `openAI` only.
- Check: with cua-driver enabled, send any Claude prompt. Pass if accepted.
- Plan status: explicitly "out of this cut". Keep out unless the check fails.

### A5. Provider authorization failure is invisible

- Symptom: expired subscription refresh (Claude) drops the prompt with no
  assistant message; only `session.execution.failed` fires.
- Evidence: `9de8f6022006` body.
- Fork fix: `ProviderAuthorizationError` + `settleAuthorizationFailure`
  (Step.Started/Failed) + `Integration.causeMessage`; TUI toast filter.
- Upstream: **code absent**. `to-session-error.ts:63` maps
  `Integration.AuthorizationError` with an empty message, no Step recorded.
- Check: revoke the stored Claude refresh token, prompt. Pass if the
  transcript shows a failed step with a readable cause.
- Note: relevant to L6 parity tests ("refresh") regardless.

### A6. Codex OAuth context limit

- Symptom: ChatGPT-subscription models advertise public-API context, so
  compaction runs too late.
- Evidence: PR #343 (cap 272k).
- Upstream: **unverified**. Check the `openai` provider plugin's ChatGPT
  model overlay for a context limit before porting into the Codex plugin.

### A7. Tool event persistence failure marks tool settled

- Symptom: if publishing Tool.Success/Failed fails, the durable record says
  settled with no event.
- Evidence: fork comment in `runner/publish-llm-event.ts`; no incident.
- Upstream: **code absent**, **unverified** as a real failure.
- Check: none cheap. Leave out unless it shows up.

### A8. Daybreak Blue catalog overlay (`gpt-daybreak-blue-latest`)

- Not a bug. Fork-only catalog extra in `provider/openai.ts`. Decide with the
  Codex plugin.

## B. Boot / catalog / TUI

### B1. Cold-start catalog waits on the SSE handshake

- Symptom: 4.6–12.4s to first usable model; footer "No provider selected".
- Evidence: issue #351, PR #353 (measured on the live host).
- Fork fix: `49116c8aba8a`; `tui/context/location.tsx` fetches on `set()`
  regardless of SSE; `client/solid/connection.ts` retries the resolved
  endpoint without re-running `Service.ensure`; `dialog-model.tsx` loading state.
- Upstream: **code absent**. `location.tsx:44` still `if (connected) sync()`;
  `catalogReady` (present) only freezes the prompt.
- Check: cold-start the TUI against a stopped service; time to model in
  footer. Pass if under ~1s after the server is up.

### B2. Location boot stalls on wellknown fetch

- Symptom: 16.2s location boot; every request on that location waits.
- Evidence: issue #352, PR #354.
- Fork fix: `00e7c54208f5`; 10s `Effect.timeout` on wellknown inspect/resolve,
  `BootPhase` timing in the boot log.
- Upstream: **code absent**. `wellknown.ts` has no timeout.
- Check: point a project at a wellknown origin that black-holes; open the
  location. Pass if boot completes within ~10s.

### B3. `--continue` opens a placeholder session

- Evidence: `5c8d81ca2c94`.
- Fork fix: remove the `sessionID: "dummy"` initial route; `home.tsx` skips
  auto-submit when continuing.
- Upstream: **code absent**. `app.tsx:372` still routes to `"dummy"`.
- Check: `shuvcode --continue` in a project with sessions. Pass if the last
  session opens with no extra placeholder.

### B4. Location sync aborts on one secondary failure

- Evidence: `9f7c0b2fee78`.
- Fork fix: `client/solid/data.ts` `Promise.allSettled` for location sync.
- Upstream: **code absent** (`data.ts:1845` `Promise.all`).
- Check: break one MCP server, open the location. Pass if models/agents load.

### B5. Unavailable session location has no retry

- Evidence: `51daab625a05`. Fork adds a retry action + `workspaceID`.
- Upstream: **code absent**. Low priority.

### B6. Configured agent model missing from catalog is silent

- Evidence: `1c47c7b9f3db`, no incident. Fork adds a toast.
- Upstream: **code absent**. Low priority.

### B7. Bundled plugin does not displace a discovered duplicate

- Symptom: a user-installed plugin with the same id as a bundled one is not
  replaced; both may load.
- Evidence: `f02a11e1980a` (no body).
- Upstream: **code absent**. `supervisor.ts:84-88` keys by target path.
- Check: matters only once bundled plugins exist (L6/L7). Install the
  external `opencode-anthropic-oauth` with the same id as the bundled Claude
  plugin; pass if exactly one registers.

## C. Tools / filesystem

### C1. Patch move of a symlink deletes the realpath target

- Evidence: `1d7084732d59`, regression test in `tool-patch.test.ts`.
- Upstream: **code absent**. `tool/plugin/patch.ts:231` removes `change.target.absolute`.
- Check: run the fork's test against the clean tree.
- Plan status: "out of this cut".

### C2. Code Mode swallows a permission decline

- Symptom: decline inside `execute` becomes a catchable "Tool execution
  failed"; model continues.
- Evidence: PR #348 (found building shuvbotta).
- Upstream: **code absent** (`tunnelDefect` not present).
- Check: in Code Mode, decline a permission prompt raised by a tool call.
  Pass if execution aborts.
- Plan status: "out of this cut" (with host limits). The decline half is
  separable from the limits half.

## D. CLI / service / release

### D1. `--version` extracts a 13.7 MB native library per call

- Evidence: PR #350 (measured). Live unit has a `BUN_TMPDIR` drop-in and
  `bun-compile-tmp-cleanup.timer` because of this.
- Upstream: **code absent**. `cli/src/index.ts` inlines the full CLI.
- Check: on a compiled binary, run `shuvcode --version` and watch
  `$TMPDIR`. Pass if no new `libopentui*.so` appears.
- Plan status: "out of this cut".

### D2. CLI ignores `OPENCODE_PERSIST_EVENTS`

- Evidence: `8ace4ee85829`.
- Upstream: **code absent**. Server accepts `events.persist`
  (`server/src/options.ts:23`); CLI never passes it.
- Check: `OPENCODE_PERSIST_EVENTS=true shuvcode serve`, then query
  `/api/experimental/session/:id/log` (if it exists upstream). Only matters
  if any consumer still wants the log.

### D3. Release pipeline failures

Each was a failed fork release; none depend on `nextForkVersion`.

- Artifact download drops executable bits → EACCES (`bf9dfafa5d5d`, `binary-modes.ts`).
- Draft release not visible immediately after create (`986b8896c977`, 5×1s retry).
- Asset name set mismatch until sorted after extension (`f7feecfb5f16`).
- Detached HEAD yields empty channel (`c9813e253b3d`, `resolveChannel` → `"local"`).
- `notify-discord` must be `workflow_call`; `on: release` never fires for
  `GITHUB_TOKEN` publishes (`172ea305893c`).
- Upstream: **unverified** — the rewrite's publish workflow is new; re-hit
  these only if the same GHA shapes are reused.

### D4. Receipts for form / permission replies

- Symptom: replies lost on restart; racing replies both pass.
- Evidence: PR #364 (SHark/SSHuv recovery).
- Plan status: "out of this cut". Consumer (shuvbot-discord) is moving to
  its own upstream V2 host. Re-open only if a fork-hosted consumer needs
  durable replies.

## E. Not on the watchlist

Confirmed present upstream, no check needed: durable `session_inbox`,
`catalogReady` prompt freeze, `http.request` / `http.response` hooks,
per-session permission rules, PTY handoff sidecar, stable Bun publish pin,
`-` plugin disable prefix, `service get password`, `pair --url`, the mistral
patch. Dropped by decision with no remaining consumer: systemd manager,
advertised-urls, session policy, dynamic tools, loopback attach cap,
secret-safe `/api/auth/status`, inert claims, `bridgeForkTip`, V1 TUI
papercuts.
