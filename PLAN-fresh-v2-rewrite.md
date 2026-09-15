# Fresh v2.0.3 fork rewrite map

Locked 2026-09-15 PDT. Amended the same day after review
(`PLAN-fresh-v2-rewrite-review.md`, approved). Decision map, not an
execution authorization. Does not authorize a bookmark move, push, PR,
release, live-database convert, or deletion of `integration-v2`.

Companion: `PLAN-fresh-v2-rewrite-watchlist.md` holds every past fork bug
fix with a check. None is in scope by default.

## Goal

Stop merging `anomalyco/opencode` `v2` into scarred `integration-v2`. Start
`v2-rewrite` from a clean upstream V2 tree. Re-apply only Shuvcode identity
and bundled plugins. Everything else must earn its way in by failing a
watchlist check on the pinned tree.

## Why not another merge

The next merge into `integration-v2` is ~395 upstream commits, 2649 files,
135 content conflicts, and 161 modify/delete conflicts. The tax is protocol
rewrite + `@opencode-ai/*` → `@opencode/*` inside already-forked files,
re-deleting SST trees, re-homing Claude after upstream deleted Core
`anthropic.ts`, and identity fights in the same files as service/publish.

A rewrite makes each remaining delta a patch on today's architecture.

## Current vs target

| | Current `integration-v2` | New line |
|---|---|---|
| Bookmark | `c9813e253b` | `v2-rewrite` from pinned `upstream/v2` |
| Sync marker | `.github/last-synced-tag` = `21adcb4969` | Recorded after validation |
| CLI | npm `shuvcode` stamp `2.0.0-alpha-20` | `shuvcode@2.0.3-shuv.1`, bin `shuvcode` only |
| Internal packages | `@opencode-ai/*` | `@opencode/*` |
| XDG | `app = "opencode"` + `OPENCODE_CONFIG_DIR` drop-in + config symlink | `app = "shuvcode"` only |
| Default port | host 4096 / upstream `0xc0de` | `0x1337` (4919) |

There is no git tag `v2.0.3`. The version bump is `c5aa7d7e34`. Pin the
rewrite base to **re-fetched `upstream/v2` at kickoff**, not that bump.

Verified 2026-09-15 PDT against `upstream/v2` **`d0a902815d`**
(`feat(plugin): add experimental WebSocket handshake hook`, CLI version
still `2.0.3`). Re-fetch again at kickoff and re-run the watchlist checks.

## Locked decisions

1. **Shape:** identity + bundled plugins on stock V2. No systemd. No
   SessionRestart fork. No carried fork schema.
2. **Ship:** Shuvcode identity, upstream pairing, upstream portable
   `Service.ensure`, upstream SessionRestart, Claude Pro/Max, Antigravity
   (Gemini 3.8 variants), Codex `codex_cli_rs`, `$skill`, Night Owl default,
   xAI popular ordering.
3. **Plugin rule:** if it can be a plugin, it is a plugin, **bundled and
   enabled** (Core `ProviderPlugins` / TUI `builtins`). Disable by config id
   (`-<id>` in `plugins`). Do not require a user `plugins` array for the
   shipped set.
4. **Core may change only for:** identity, default port, XDG app id, one-shot
   DB convert script, OAuth refresh single-flight, host seams plugins cannot
   exist without, and watchlist items whose check **fails** at kickoff.
5. **Bookmark:** `v2-rewrite`. `integration-v2` frozen until cutover.
6. **Version (amended):** `shuvcode@<upstream>-shuv.N`, first release
   `2.0.3-shuv.1`. Always suffixed, so a fork-only fix (`-shuv.2`) sorts
   above the previous fork release and below the next upstream base. Never
   publish a bare upstream version. Updater follows npm dist-tag `latest`.
   Retire `nextForkVersion` / `2.0.0-N`.
7. **Bins:** `shuvcode` only. No `opencode`, no `opencode2`, no PATH aliases.
8. **XDG (amended):** `packages/util/src/global.ts` `app = "shuvcode"`.
   Directories move: `~/.config/shuvcode`, `~/.local/share/shuvcode`,
   `~/.local/state/shuvcode`, `~/.cache/shuvcode`, `/tmp/shuvcode`.
   Identity literals that must follow (`Global.app` does not move them):
   `client/src/effect/service.ts` `Service.fallback()` (`state/opencode/...`)
   and default spawn `["opencode","serve","--service"]`; promise twin.
   Format literals that stay: project `opencode.json` / `opencode.jsonc` /
   `.opencode/`, global filename `opencode.json`, DB filenames
   `opencode.db` / `opencode-<channel>.db`, `~/.claude`, `~/.agents`, theme
   id `opencode`. Remove the `~/.config/opencode` symlink, the
   `OPENCODE_CONFIG_DIR` drop-in, and every OpenCode-path fallback. Inherited
   `OPENCODE_*` env *names* stay. Desktop paths out of scope.
9. **Port:** default **`0x1337` (4919)**. Never `0xc0de` (49374). Sites:
   `cli/src/services/service-config.ts` `defaultPort` (`0xc0de`, and
   `0xc0df` for `local` → `0x1338`), `server/src/process.ts` listen
   fallback `4096`, `cli/test/service.test.ts`, fork docs. Ignore
   `github/index.ts`, WWW docs, and app e2e fixtures (out-of-CI trees).
10. **Pair HTTP username:** `opencode` (upstream pair JSON literals it).
11. **Claude:** bundled `@shuvcode/claude-plugin` on `http.request` /
    `http.response`. No loopback proxy. No Core transport wrap.
12. **Code Mode:** take upstream. No host limits. No decline tunnel
    (watchlist C2 may reopen the decline half only).
13. **Night Owl / xAI:** bundled TUI plugins. Add host seams if missing. No
    host one-liners.
14. **Trees:** leave `packages/console`, `web`, `services/*`, enterprise,
    stats, desktop sources in the tree **and in root workspaces**. Ignore
    them in fork CI/publish.
15. **DB:** one-shot convert + relocate of the elected **Shuvcode** channel
    DB. Do not port `bridgeForkTip` or fork-only migration IDs.
16. **goal-plugin (new):** out of the binary. Remove its config entry at
    cutover. Re-enable later as an external plugin retargeted to
    `@opencode/plugin`; tracked outside this map.
17. **Watchlist gate (new):** at kickoff, run every check in
    `PLAN-fresh-v2-rewrite-watchlist.md` against the pinned tree. A failing
    check becomes a named plan item with its own layer; a passing check is
    closed. No fix is ported on the strength of its history.

### Out of this cut

- `@shuvcode/goal-plugin` (decision 16)
- Session tool policy, dynamic-tool, and receipt APIs (stripped by convert)
- CLI metadata fast path (watchlist D1)
- Desktop branding
- systemd unit / `manager: "systemd"` / advertised-urls overlay
- Anthropic tool-schema hoist (A4), symlink-safe patch (C1), loopback attach
  cap, secret-safe `/api/auth/status`, Codex context cap (A6)

### Reversals stated on purpose

- Pairing was removed 2026-07-27 and re-affirmed out in
  `PLAN-upstream-v2-20260830.md`. This map ships upstream `pair`.
- The SessionRestart prohibition is in `execution.ts`, `specs/v2/session.md`,
  AGENTS.md, and the Aug 30 plan. No double-charge postmortem exists; the
  convert's claim clear is the mitigation.
- systemd was chosen against PR #339, PR #340, PTY `KillMode`, and upstream
  `Service.ensure` incident #36688. "Must never" is policy; L2 re-expresses
  the host env it carried.

## Plugin vs Core

| Want | Home |
|---|---|
| Name, bin, publish, logo, `shuvcode/client`, XDG, port, client fallback path | Overlay (L1) |
| Portable service | Upstream `Service.ensure` |
| Pairing | Upstream `pair` / `/pair` / `/web`, `pair --url` for the tailnet |
| SessionRestart | Upstream |
| One-shot DB convert + relocate | Throwaway script, not a journal migration |
| Claude Pro/Max | Bundled `@shuvcode/claude-plugin` |
| Antigravity + Gemini 3.8 | Bundled `@shuvcode/antigravity-plugin` (ported to `provider`/`model` editors) + Core adapter |
| Codex `codex_cli_rs` | Bundled plugin |
| `$skill` | Bundled TUI plugin + autocomplete seam |
| Night Owl / xAI | Bundled TUI plugins + seams if missing |
| Code Mode fork | Dropped |
| OAuth refresh single-flight | **Required Core overlay.** `connection.resolve` refreshes with no mutex (`integration.ts:675-692` on `d0a902815d`). Do not bring `auth.status` along. |
| Watchlist failures | Named per item after the gate |

Allowed host seams:

- TUI `ui.prompt.autocomplete.register`
- TUI default-theme and integration-sort registration (both hardcoded on
  `d0a902815d`: `theme.tsx:130`, `dialog-integration.tsx:29`)
- One-line Core `ProviderPlugins` adapters for bundled provider plugins

Plugin API facts on `d0a902815d` (verified):

- `ctx.catalog` / `@opencode/plugin/effect/catalog` **do not exist**.
  Catalog editing is `ctx.provider.transform` + `ctx.model.transform`
  (`core/src/plugin/host.ts`). Zero-cost pattern: `provider/openai.ts:268`.
- `ctx.integration.transform` registers OAuth and env methods.
- HTTP hooks are scoped by `ModelHookOptions.providerID` at registration;
  the `SessionHttpRequest` event carries `model`, not `providerID`.
- `request` / `response` are mutable; hooks wrap the native Anthropic
  `httpJson` transport and the websocket fallback.
- Bundled plugins register through `ProviderPlugins` and are disabled with
  `-<id>` in config.

## One-shot DB convert and relocate

The new binary does not understand fork journal IDs and reads
`~/.local/share/shuvcode/`. The elected DB is
`~/.local/share/opencode/opencode.db` today. Convert a clone, then relocate.

1. Stop the old server (`systemctl --user disable --now shuvcode.service`).
   WAL-safe SQLite backup.
2. Convert a clone; open it with the new binary against a scratch XDG root;
   then relocate.
3. Converter must:
   - Keep `session_v2` live. **Drop or empty any leftover V1 `session`
     table**; `V1Migration` (`v1-migration.bun.ts:1061`) triggers on its
     existence, deletes `event` rows, and re-imports.
   - Drop `form_request`, `permission_request`, `session_dynamic_tool`,
     column `session_v2.policy`, and `pairing_device` if present.
   - Rewrite the journal to the upstream ID set. **Execute**
     `20260910120000_clear_v1_session_permission` (`UPDATE session_v2 SET
     permission = NULL`); do not merely stamp it. Keep
     `20260805200742_import_legacy_credentials` stamped as applied; do not
     re-run it after the app rename.
   - If anything still renames `session` → `session_v2`, drop the partial
     indexes on `time_suspended` first (SQLite `RENAME` fails otherwise).
   - Keep sessions, messages, events, credentials; map method id
     `anthropic` → `claude-pro-max`.
   - **Clear `time_suspended` and `resume_attempts`** so SessionRestart does
     not replay turns the fork parked.
4. Relocate into `~/.local/share/shuvcode/`: the converted DB, `auth.json`,
   `mcp-auth.json`, `antigravity-accounts.json`, `log/`. Into
   `~/.local/state/shuvcode/`: `frecency.jsonl`, `kv.json`, `model.json`,
   `plugin-meta.json`, `<channel>/tui`. Into `~/.cache/shuvcode/`: `skills`.
   Config already lives at `~/.config/shuvcode/`.
5. Convert each channel DB separately. Do not copy refreshed OAuth tokens
   between channels.

Throwaway rewrite-workspace script. Not a durable Core migration.

## Do not re-port (verified present upstream on `d0a902815d`)

- Durable `session_inbox`
- Plugin `http.request` / `http.response`
- Per-session permission **rules** (not fork `SessionPolicy`)
- TUI `catalogReady` prompt freeze (this is **not** the #353 cold-start fix;
  see watchlist B1)
- PTY handoff sidecar, stable Bun publish pin, `-` plugin disable prefix,
  `service get password`, `pair --url`, mistral patch

Removed from this list after review because they are **not** upstream:
max-step guardrail as a user message (A1), Gemini optional-object typing
and boolean-const handling (A2, A3). They are watchlist items, not plan items.

## Must never come back

- systemd as a product requirement
- Inert execution claims
- Fork migration IDs in the new journal
- Claude loopback proxy / Core Anthropic transport wrap
- `pairing_device` / a second pairing protocol
- OpenCode XDG fallbacks or config symlinks
- `opencode` / `opencode2` bins
- Bare upstream version numbers on the `shuvcode` npm package
- Upstream publish/deploy/signing/AUR/desktop-release workflows going live
  on `Latitudes-Dev/shuvcode`

## Layers

Isolated jj workspace. One named change per layer. Copy tests from
`integration-v2` when they still express a locked contract. Rewrite
implementations against the new tree. Do not copy scarred whole files.

### L0 — Workspace and gate

- `jj git fetch --remote upstream`; record the exact SHA
- `jj workspace add` on pinned `upstream/v2`
- Leave the current workspace and live service untouched
- Keep unused upstream packages and root workspaces
- **Watchlist gate run 2026-09-15 PDT** (results in the watchlist):
  B1/B3/B4/C1/A6 pass and are closed; B2 failed and is now an L5 item;
  A1–A5, C2, B7 re-run in L6 once bundled plugins provide native
  credentials; D1 passed on the compiled binary under bun 1.4.2.
- Toolchain: `bun ≥ 1.4.2` (host upgraded to 1.4.2). Build and publish
  scripts must not depend on `git branch --show-current`; the jj workspace
  has no `.git`, so set `OPENCODE_CHANNEL` explicitly.
- Fork CI: `publish.yml`, `test.yml` (Linux only until a Windows runner is
  proven), `typecheck.yml` (per-package, per AGENTS.md),
  `notify-discord.yml` as `workflow_call` (GitHub does not fire
  `on: release` for `GITHUB_TOKEN` publishes)
- Boundary: bin `shuvcode`, `Global.app === "shuvcode"`, port `0x1337`

### L1 — Identity

- `packages/cli` name/bin `shuvcode`, version `2.0.3-shuv.1`
- `launcher.mjs` install model (no postinstall; `bun i -g` blocks it). No
  `opencode.cjs` / `opencode2.cjs`
- `packages/util/src/global.ts` `app = "shuvcode"`
- Client `Service.fallback()` and default spawn command follow the app id
- Default port `0x1337` / `0x1338` at the sites in decision 9
- Updater targets `shuvcode` / `shuvcode-node` via npm dist-tag; never the
  upstream curl installer
- TUI `shuv-logo.ts`
- Guarded CLI-only publish (ownership check `Latitudes-Dev/shuvcode`),
  Discord notify
- `shuvcode/client` Promise facade; `package-smoke.ts` without the
  `SessionPolicy` assertion
- Tests: updater-install, publish-ownership, launcher, logo, version

Internal imports stay `@opencode/*`.

**Done 2026-09-15 PDT.** Notes from the cut:

- The fork's `metadata-binary` test was not ported: it asserts no native
  extraction on `--version`, which bun 1.4.2 does once per content hash
  (watchlist D1). The fast path itself is out of this cut.
- Workspace bin is `bin/shuvcode.mjs`, a one-line shim over
  `script/launcher.mjs`; published packages ship the launcher as
  `bin/launcher.mjs`.
- `packages/cli` self-imports moved to `shuvcode/vite-host` and
  `shuvcode/run` (package self-reference follows the package name).
- User-facing command hints (`shuvcode service set …`, `shuvcode models`,
  exit splash resume line, ACP terminal-auth) follow the bin. Product
  strings elsewhere ("OpenCode" in TUI copy) were left alone.
- `uninstall` lost its curl-only branches (shell PATH cleanup for
  `~/.opencode/bin`); `Updater.removal` stays for package managers.
- `packages/script`: `resolveChannel` tolerates no git; `Script.version`
  reads the base from `packages/cli/package.json`, computes
  `nextForkVersion` from npm `shuvcode/latest`, and rejects an explicit
  `OPENCODE_VERSION` on `latest` that is not `-shuv.N`.
- Publish: `publish-ownership.ts` owns the repository guard (no root
  `script/publish-plan.ts`); `package-smoke.ts` asserts `server.status`,
  `session.list`, `event.subscribe` (the fork's `health` / `auth.status`
  groups no longer exist). `release-assets.ts` / `preflight-publish.ts` not
  ported; the GitHub release is created in `publish.yml`, prerelease iff
  the dist-tag is not `latest`.
- CI: four workflows only. `test.yml` excludes `@opencode/desktop` and
  `@opencode/update` from turbo and drops the `services/www` docs check;
  `typecheck.yml` skips the decision-14 trees. Runners are `ubuntu-latest`.
- Pre-existing upstream test failures on `d0a902815d`, not touched:
  `packages/client` (3: session HTTP contract, DateTime decode, import
  boundaries), `packages/core/test/preload.test.ts` (`OPENCODE_TEST_HOME`
  unset outside turbo), `packages/tui` app-lifecycle plugin-failure width
  cases (4).

### L2 — Service and cutover

- Upstream `Service.ensure`; upstream `pair`, command name `shuvcode pair`
- Preconditions: shuvbot-discord is off this host (its own upstream V2 host
  per `PLAN-SHUVBOT-OPENCODE-V2.md`); goal-plugin entry removed from config
- Cutover: `systemctl --user disable --now shuvcode.service`, remove the
  unit and drop-ins, then `shuvcode service set`:
  `hostname <tailscale-ip>`, `port 0x1337`. `BUN_TMPDIR` is optional
  under bun 1.4.2 (watchlist D1); keep `bun-compile-tmp-cleanup.timer`
  only if tmpfs pressure returns
- Pairing across the tailnet: `shuvcode pair --url
  https://<host>.<tailnet>.ts.net:<port>` after re-pointing `tailscale serve`
- Verify `shuvcode service restart` keeps detached PTY terminals with the
  upstream env-based handoff (the unit used `KillMode=process` for this)
- Rewrite `docs/shared-service.md` for portable service + pair + XDG; drop
  `deploy/`, `docs/design/service-lifecycle.md`

### L3 — DB convert and relocate

Backup, convert clone, verify against a scratch XDG root, relocate, swap.
Per "One-shot DB convert and relocate".

### L4 — Session

Upstream SessionRestart. No policy / dynamic-tool / receipt protocol.

### L5 — Remaining Core

Port OAuth refresh `KeyedMutex` single-flight in
`packages/core/src/integration.ts`.

Admitted by the L0 gate (watchlist B2): bound `WellKnown.inspect` /
`resolve` with a 10s `Effect.timeout` in `packages/core/src/wellknown.ts`.
No `BootPhase` telemetry.

Nothing else.

### L6 — Bundled provider plugins

**Antigravity:** port `packages/antigravity-plugin` to `@opencode/plugin`
**and** to the `ctx.provider` / `ctx.model` editors (`CatalogEditor` is
gone). One-line `ProviderPlugins` adapter.

**Claude (`@shuvcode/claude-plugin`):**

- `ctx.integration.transform`: `claude-pro-max` OAuth + env
  `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` (setup-token prefix)
- `http.request` registered with `{ providerID: anthropic }`:
  `connection.resolve`; skip if not subscription; `shapeRequestBody`;
  Claude Code headers; `Authorization: Bearer`; drop `x-api-key`; do not
  rewrite URL
- `http.response`: SSE-event-buffered `restoreToolNames` TransformStream
- `ctx.model.transform`: zero `cost` on subscription models
- No proxy. No `ModelResolver` transport wrap
- Move helpers/tests from
  `packages/core/src/plugin/provider/anthropic-claude-code.ts`
- `instructions/builtins.ts` `<env>` block is byte-identical to the fork's,
  so `normalizeEnv` / `isCanonical` still match; re-verify billing on a real
  subscription before the proxy is deleted

**Codex identity:** bundled plugin, three-site `codex_cli_rs`. Context cap
only if watchlist A6 fails.

### L7 — TUI plugins

- Presentation says `shuvcode`
- Keep upstream pair UI
- Autocomplete register seam + `$skill`
- Night Owl + xAI as plugins; seams first (both defaults are hardcoded)

### L8 — Validation

Package-local, never from repo root:

- Identity / publish / service tests
- Plugin tests in scope, including Claude parity (body/header, SSE restore,
  cancel, refresh, configured `baseURL`)
- Watchlist re-runs: A1–A5, C2, B7 after L6
- `bun typecheck` in `core`, `cli`, `tui`, `server`, `client`
- `packages/cli/script/package-smoke.ts` on a built `shuvcode` artifact
- `bun run dev:live` only after L2, against a **non-elected** convert clone
  in a scratch XDG root
- Do not restart the live host to prove the rewrite

## Claude hook spike (still valid on `d0a902815d`)

Native AnthropicMessages goes through `StreamOptions.http` when any
`session.http.request` / `http.response` hook is registered for that
provider (`packages/core/src/session/model-request.ts:290-317`). Copilot's
"AI SDK bypasses `http.request`" does not apply. Antigravity already uses
this seam. Anthropic is not a websocket route; `experimental.ws.handshake`
is irrelevant.

Request-time `connection.resolve` replaces the loopback proxy. Response
`restoreToolNames` must buffer SSE events, not regex TCP chunks.

Parity tests are required before the plugin is done. Architecture is
locked: hooks only, no Core fallback adapter.

## Git / jj

```sh
jj git fetch --remote upstream
# record exact SHA
jj workspace add --name shuvcode-v2-rewrite -r <pinned-upstream-v2> \
  /home/shuv/repos/shuvcode-workspaces/v2-rewrite
```

Never merge `integration-v2` into this workspace. Never open an upstream PR.
Record `.github/last-synced-tag` only after validation.

## Risks

- New binary against an unconverted or un-relocated fork DB, or convert
  without a WAL-safe backup
- Leftover V1 `session` table triggering `V1Migration` on the converted DB
- SessionRestart replaying old claims if `time_suspended` /
  `resume_attempts` are not cleared
- Two servers if `shuvcode.service` stays enabled
- Client `Service.fallback()` still reading `state/opencode` and attaching
  to the wrong app
- Deleting SST trees and recreating the modify/delete tax
- Copying old Core `anthropic.ts` / `model-resolver.ts` / Antigravity
  `wire.ts` onto the split provider/model registry
- Shipping `opencode` bins, `Global.app = "opencode"`, or a bare `2.0.3`
- Copying a Claude refresh token between channel DBs
- Porting a watchlist item on history alone

## Rollback

Keep using `integration-v2` / the installed binary. The rewrite workspace is
disposable until cutover. The pre-convert backup restores the old host.

## Done when

- Disposable workspace boots `shuvcode` from the pinned upstream V2 tree
- Watchlist gate run; every failing check has a named plan item
- Locked-contract tests pass without wholesale scarred-file copies
- `Global.app === "shuvcode"`, bin `shuvcode`, version `2.0.3-shuv.1`, port
  `0x1337`, client fallback path under `shuvcode`
- Official OpenCode and Shuvcode do not share XDG or the default port
- SessionRestart and pairing present; systemd manager absent
- SST packages still in tree, out of fork CI
- `.github/last-synced-tag` equals the pinned upstream parent
- `integration-v2` untouched
