# Merge upstream V2 through `47f66de8dd`

## Goal

Absorb `upstream/v2` from merge-base `d0a902815d` through `47f66de8dd` (126 commits, 575 files) into `integration-v2` in one merge. Keep Shuvcode identity and bundled plugins. Take upstream behavior everywhere else.

This is the ongoing sync onto the rewrite line, not the abandoned scarred-tree merge in `PLAN-upstream-v2-sync.md`. `integration-v2` already sits on the rewrite pin `d0a902815d` plus fork identity.

## Current

| | Value |
|---|---|
| Bookmark | `integration-v2` at `3635062ab2`; `sync-upstream-v2` already points here |
| Merge-base with `upstream/v2` | `d0a902815d` (`feat(plugin): add experimental WebSocket handshake hook`) |
| Upstream tip (fetched 2026-09-18, refreshed) | `47f66de8dd` (`perf(app): load draft image bytes on demand (#49703)`) |
| Previous pins (superseded) | `0ac458b3b3` then `609044ef0a`; extra since `609044ef0a` is 4 commits including `sync release versions for v2.0.8` |
| Fork CLI version in tree | `2.0.3-shuv.1` (`packages/cli/package.json`) |
| Published npm `latest` | `2.0.3-shuv.4` |
| Upstream CLI version | `2.0.8` (`@opencode/cli`) |
| Uncommitted | Working copy `@` (`luwprtzr` / `f4acffae`) holds only this plan file on `integration-v2`. The `/btw` snipe is gone. |
| jj remote bookmark | `v2@upstream` (git name `upstream/v2`) |

`git merge-tree --write-tree integration-v2 upstream/v2`: 35 overlapping paths (same set as at `0ac458b3b3`), 29 upstream-only adds, 2 upstream deletes. 7 content conflicts (listed below; identical files).

## Locked decisions

- One merge of `upstream/v2` at `47f66de8dd`, not 126 cherry-picks.
- Upstream is authoritative unless this plan names a fork invariant.
- Re-fetch `upstream/v2` at kickoff. If the tip is no longer `47f66de8dd`, stop and refresh this plan.
- Branch name: `sync-upstream-v2` (from `integration-v2`).
- In-tree version becomes `2.0.8-shuv.1` in the merge commit (`packages/cli/package.json`). `packages/script/src/version.ts` restarts the `-shuv.N` counter when the upstream base moves, so the `2.0.3` vs `2.0.8` conflict resolves to `2.0.8-shuv.1`, not bare `2.0.8` and not `2.0.3-shuv.5`. Publishing it is out of scope.
- The `/btw` snipe is already gone from this working copy. Do not `jj restore --from integration-v2` on TUI paths after the merge starts — that reverts upstream `btw.tsx`. Do not `jj abandon @`: that change holds this plan file. Upstream already has `3e3a4ae46b` (`packages/tui/src/feature-plugins/prompt/btw.tsx`).
- Branding is reapplied onto upstream files. Do not restore old fork control flow to recover a string or logo.
- `packages/console`, `packages/web`, `packages/desktop`, `packages/app`, `packages/enterprise`, `packages/stats`, `services/*` stay in the tree and take upstream wholesale. They remain outside fork CI and `publish.yml`.
- After any Protocol or Server `HttpApi` change, run `bun run generate` from `packages/client`. Do not edit generated client files by hand.
- Tests run from package directories, never repo root.
- No push, PR, or release in this plan.

## Scope

### In scope

- All 126 commits `d0a902815d..47f66de8dd`.
- Overlap resolution and identity reapply.
- Public API regeneration (`server.info`, location reload, `fs.write`, permission/policy types).
- Theme token rename `background.surface` → `background.raised` including Night Owl and custom-theme fallback.
- Fork updater: keep npm dist-tags and platform-package detection; take upstream “client-owned updates” (stop polling from `packages/cli/src/server-process.ts`).
- Quota plugin and `$` skill remain default builtins.
- Package-local tests, `bun run check`, focused TUI smoke.

### Out of scope

- Publishing `2.0.8-shuv.1`.
- Restoring curl installer, `opencode` bin, or `app = "opencode"` XDG.
- Redesigning Claude/Antigravity/Codex subscription plugins.
- Independently revocable pairing credentials.
- Activating upstream `script/release.ts` or opencode.ai update service.

## Merge policy

Use jj (colocated). Do not `git checkout --ours/--theirs` across directories.

```text
# working copy holds only this plan; do not restore TUI paths from integration-v2
jj git fetch --remote upstream
# require: git rev-parse upstream/v2 == 47f66de8dd
# sync-upstream-v2 already exists at integration-v2
jj new integration-v2 v2@upstream -m "chore(sync): merge upstream v2 through 47f66de8dd"
# ...resolve, then move the bookmark onto the merge commit:
jj bookmark set sync-upstream-v2 -r @
```

jj resolves the remote bookmark as `v2@upstream`; `upstream/v2` is the git name and only works in `git` commands.

Resolve in three classes:

1. **Upstream wholesale** — TUI features, core/session/codemode, protocol/schema, app/desktop/www, docs.
2. **Manual semantic merge** — the overlap list below.
3. **Fork retained** — identity, publish, quota, `$` skill, Night Owl default, bundled subscription plugins, Code Mode decline/limits.

Regenerate `bun.lock` and `packages/client` generated files. Do not line-merge them.

## Fork invariants

Retain or reapply after the merge:

| Invariant | Where |
|---|---|
| Package/bin `shuvcode` | `packages/cli/package.json` `name`/`bin`; no `opencode` bin |
| Version `<upstream>-shuv.N` | `packages/script/src/version.ts`; after merge `2.0.8-shuv.1` |
| `Global.app = "shuvcode"` | `packages/util/src/global.ts` |
| Default port `0x1337` (`0x1338` local) | CLI/server listen defaults |
| Updater: npm dist-tags on `shuvcode`/`shuvcode-node`; methods `npm\|pnpm\|bun\|yarn`; `installedPackageName` maps `shuvcode-<platform>-<arch>` back to the wrapper | `packages/cli/src/services/updater.ts` |
| Launcher, not postinstall copy | `packages/cli/script/launcher.mjs` |
| Publish guard `Latitudes-Dev/shuvcode`, CLI packages only | `packages/cli/script/publish.ts`, `.github/workflows/publish.yml` |
| Quota sidebar builtin | `@shuvcode/quota-plugin`; last in `packages/core/src/plugin/provider.ts` `ProviderPlugins`; TUI `shuvcode.sidebar.quota` |
| `$` skill autocomplete | `packages/tui/src/feature-plugins/prompt/skill-dollar.ts` |
| Night Owl default | TUI theme default |
| Claude Pro/Max, Antigravity, Codex `codex_cli_rs` | bundled provider plugins |
| TUI logo | `packages/tui/src/shuv-logo.ts` |
| Code Mode decline + `timeout_ms` / `max_tool_calls` / `max_output_bytes` | Decline extraction lives in `packages/core/src/permission.ts`, `packages/core/src/tool/runtime.ts`, `packages/core/src/session/runner/step.ts`, `packages/core/src/session/model-request.ts` (there is no `decline.ts`); limits in `packages/core/src/codemode/tool.ts`, `packages/core/src/tool.ts` |
| Pairing `/pair` + advertised URLs | `packages/tui/src/component/dialog-pair.tsx` (overlap; fork-owned). `packages/tui/src/app.tsx` has no fork changes since merge-base and takes upstream wholesale |

Format literals that stay upstream: project `opencode.json` / `.opencode/`, DB `opencode.db`.

## Overlap inventory

`git merge-tree` overlapping paths (review even when auto-merged):

```
bun.lock
packages/cli/package.json
packages/cli/script/build.ts
packages/cli/script/publish.ts
packages/cli/script/service-smoke.ts
packages/cli/src/acp/service.ts
packages/cli/src/commands/commands.ts
packages/cli/src/commands/handlers/pair.ts
packages/cli/src/server-process.ts
packages/cli/src/services/updater.ts
packages/cli/test/auth.test.ts
packages/cli/test/debug-config.test.ts
packages/cli/test/mini.test.ts
packages/cli/test/service.test.ts
packages/cli/vite.node.config.ts
packages/client/package.json
packages/client/src/effect/service.ts
packages/client/src/promise/service.ts
packages/codemode/src/tool-runtime.ts
packages/codemode/test/codemode.test.ts
packages/core/package.json
packages/core/src/codemode/tool.ts
packages/core/src/integration.ts
packages/core/src/tool.ts
packages/plugin/src/tui/context.ts
packages/server/src/process.ts
packages/tui/package.json
packages/tui/src/component/dialog-config.tsx
packages/tui/src/component/dialog-pair.tsx
packages/tui/src/mini/theme.ts
packages/tui/src/plugin/builtins.ts
packages/tui/src/plugin/context.tsx
packages/tui/test/app-lifecycle.test.tsx
packages/tui/test/fixture/tui-client.ts
packages/tui/test/mini/theme.test.ts
```

Content conflicts reported by `git merge-tree` (7):

| Path | Resolution |
|---|---|
| `bun.lock` | Do not merge. `bun install` after identity is restored. |
| `packages/cli/package.json` | Keep `name: "shuvcode"`, `bin: { "shuvcode": "./bin/shuvcode.mjs" }`, no `opencode` bin. Take upstream dependency/script edits. Set `version` to `2.0.8-shuv.1`. |
| `packages/cli/script/publish.ts` | Keep the `Latitudes-Dev/shuvcode` repo guard and CLI-only package list. Take upstream publish mechanics. (`publish-aur.ts` exists on both sides and is not a conflict; leave AUR publish inactive.) |
| `packages/cli/src/services/updater.ts` | Keep fork npm dist-tag lookup + `installedPackageName`. Take upstream removal of server-side polling and `#49676` install-progress (`10cac9ab5d`). Fork-only `Updater.pollUpdates` becomes dead once `server-process.ts` and `updater-poll.test.ts` stop referencing it; delete it. |
| `packages/core/src/codemode/tool.ts` | Keep fork decline/limits. Take upstream web/`fetch` exposure (`packages/core/src/codemode/web.ts` is an upstream add). |
| `packages/core/src/tool.ts` | Keep Code Mode integration. Take upstream execute-list / extension-call refactors. |
| `packages/tui/src/plugin/builtins.ts` | Take `PromptBtw`. Keep `SidebarQuota` and `SkillDollar`. |

Upstream deletes to accept: `packages/cli/test/updater-poll.test.ts` (its subject is removed by `#49577`; `updater-install.test.ts` exists on both sides and stays). `packages/ui/src/theme/themes/opencode.json` (unrelated to Night Owl, which loads from `packages/tui/src/theme/assets/nightowl.json`).

Upstream adds to take, including:

- `packages/tui/src/feature-plugins/prompt/btw.tsx`
- `packages/tui/src/routes/session/dialog-execute.tsx`
- `packages/cli/src/commands/handlers/reload.ts`
- `packages/core/src/location-lifecycle.ts`
- `packages/core/src/plugin/identity.ts`
- `packages/core/src/codemode/web.ts`
- `packages/schema/src/location-event.ts`

## What the range contains (for validation, not cherry-pick order)

TUI: `/btw` (`session.generate`, no transcript), `/reload`, execute-call dialog, subagent model label, independent notification/sound toggles, spinner glyph, vertical-tab breakpoint, TPS (reasoning tokens + provider latency), model submit on blank, shell preview limits, plugin target dedupe, MCP sign-in hint, collapsed shell copy, update installation progress (`#49676`), open completed subagent sessions (`#49675`).

Core/protocol/server: location reload, `GET /api/info` (`server.info` replaces `server.status`), `POST` fs.write, permission policy enforcement (`packages/core/src/config/plugin/policy.ts`), MCP OAuth resource + authorization-server metadata, subagent model + models tool, provider retry (~84s), serialize MCP startup, recovered-shell notices must not wake idle sessions, plugin identity on system prompts.

CLI: `shuvcode reload`, inline config content, custom Console logins, updates client-owned (no `server-process` poll).

Codemode: host-function extensions, before/after hooks, `fetch` in scripts, `tools.search` builtin, RegExp `lastIndex`, error-boundary cause.

Theme: public token `background.surface.{offset,overlay}` → `background.raised.{offset,overlay}` in `packages/theme/src/tui/{schema,types,defaults,fallback,v1-migrate}.ts` and TUI call sites.

App/desktop/www: take wholesale; not in fork CI. Extra 10 past `0ac458b3b3` are mostly this: QR pairing scanner (`#49699`), attachment streaming (`#49647`, `#49682`), provider metrics debug bar (`#49674`), desktop IPC copy-out (`#49696`), local sessions in project root (`#49668`). Also: client stale-tools settlement (`#49672`), codemode OpenAPI fixture isolation (`#49667`).

Ignore `sync release versions for v2.0.{4,5,6,7,8}` as version authority. Fork version in the merged tree is `2.0.8-shuv.1`.

## Ordered tasks

### 1. Prep

- [x] `jj status` shows only this plan file.
- [x] Do not `jj restore --from integration-v2` on TUI paths. Do not `jj abandon @`; it holds this plan file.
- [x] `jj git fetch --remote upstream`; `git rev-parse upstream/v2` is `47f66de8dd`. Stop if not.
- [x] `sync-upstream-v2` already exists at `integration-v2`; do not recreate it.

Acceptance: `jj status` shows only `PLAN-merge-upstream-v2.md`, correct upstream tip, bookmark exists.

### 2. Merge

- [x] `jj new integration-v2 v2@upstream -m "chore(sync): merge upstream v2 through 47f66de8dd"`.
- [x] Resolve the 7 conflicts per the table. Review the other 28 auto-merged overlaps. Do not ours/theirs a directory.
- [x] Restore fork identity on `packages/cli/package.json`, `packages/cli/script/publish.ts`, `.github/workflows/publish.yml` if the merge touched them. Set `version` to `2.0.8-shuv.1`.
- [x] Re-apply `installedPackageName` in `packages/cli/src/services/updater.ts` if the hunk dropped it. Delete `pollUpdates`.
- [x] Re-register `PromptBtw`, `SidebarQuota`, `SkillDollar` in `packages/tui/src/plugin/builtins.ts`.
- [x] Take upstream `packages/cli/src/server-process.ts` (no updater poll; upstream `#49577` = `37ff501cc6`). Accept the `updater-poll.test.ts` delete.
- [x] Take upstream `packages/tui/src/app.tsx` as-is (no fork changes since merge-base). Keep fork `packages/tui/src/component/dialog-pair.tsx` behavior (`/pair`, advertised URLs) while taking upstream hunks in that overlap.
- [x] `jj bookmark set sync-upstream-v2 -r @`.

Acceptance: merge commit has two parents (`3635062ab2`, `47f66de8dd`). Tree is **not** identical to `integration-v2` (a two-parent commit with the fork tree is a poison merge — abandon it). `rg '<<<<<<<'` empty. `packages/cli/package.json` has `"name": "shuvcode"`, `"version": "2.0.8-shuv.1"`, `"bin": { "shuvcode": ... }`, and `rg '"opencode"' packages/cli/package.json` is empty. Upstream adds (`packages/core/src/codemode/web.ts`, `packages/cli/src/commands/handlers/reload.ts`, `packages/tui/src/feature-plugins/prompt/btw.tsx`) exist on disk.

### 3. Public API regenerate

Upstream renames `server.status` / `GET /api/status` to `server.info` / `GET /api/info` (`packages/protocol/src/groups/server.ts`). Location reload and `fs.write` also change Protocol.

- [x] From `packages/client`: `bun run generate` (runs `script/build.ts`).
- [x] Replace the API call `server.status()` → `server.info()` in the four fork-owned callers: `packages/cli/src/services/server-connection.ts:32`, `packages/cli/src/commands/handlers/pair.ts:18`, `packages/tui/src/component/devtools-bar.tsx:57`, `packages/tui/src/component/dialog-pair.tsx:29`.
- [x] Do not touch `packages/sdk/script/verify-package.ts` or `packages/codemode/test/openapi.test.ts`; upstream already converted them and they arrive wholesale.
- [x] Do not touch `server.status` in `packages/cli/src/commands/handlers/mcp/list.ts`, `packages/tui/src/component/dialog-mcp.tsx`, `packages/tui/src/app.tsx:536`. Those read the MCP server status field, not the API.
- [x] Confirm `packages/server/src/handlers/server.ts` handles `server.info`.

Acceptance: `rg 'server\.status\(' packages --glob '!**/gen/**'` is empty. No `server.status` operation id in `packages/protocol` or generated client. Running `bun run generate` a second time produces no diff.

### 4. Theme token rename

Upstream already renamed every `background.surface` call site (`git grep 'background\.surface' upstream/v2 -- packages/theme packages/tui` is empty). No fork-only TUI file (`feature-plugins/sidebar/quota`, `skill-dollar.ts`, `dialog-pair.tsx`, `shuv-logo.ts`) uses the token. This step is verification, not a rename.

- [x] Take upstream `packages/theme/src/tui/{schema,types,defaults,fallback,v1-migrate}.ts` and the renamed TUI call sites (prompt, session-tabs, diff-viewer, mini theme, dialog-select, session route, tests).
- [x] Verify built-in light and dark defaults and custom-theme fallback (`packages/tui/test/theme/v2/{resolve,component,v1-migrate}.test.ts`).
- [x] Confirm Night Owl still loads as the TUI default (`DEFAULT_THEME_NAME = "nightowl"` in `packages/tui/src/theme/v1.ts`).

Acceptance: `rg 'background\.surface' packages/theme packages/tui` is empty except comments/history. Theme tests pass from `packages/tui`.

### 5. TUI / CLI behavior checks

- [ ] `/btw <question>` from a running session: no inbox item, no interrupt, dialog answer, footer spinner, `c` copies. Palette title “Ask a side question”. (needs `bun run dev:live` smoke)
- [x] Slash args expand pasted text before `argumentSlash` (`packages/tui/src/component/prompt/index.tsx`) — file present from upstream.
- [x] `/reload` exists (`packages/cli/src/commands/handlers/reload.ts`) and TUI `session.aside` keybind default is `none`.
- [ ] Blank submit still applies a pending model selection. (needs live smoke)
- [x] Execute tool rows open `packages/tui/src/routes/session/dialog-execute.tsx`.
- [x] Notification vs sound are independent in CLI settings (`packages/tui/src/component/dialog-config.tsx` overlap).

Acceptance: `OPENCODE_STORY` unused unless adding a story. Manual smoke via `bun run dev:live` from a worktree.

### 6. Core / Code Mode

- [x] Keep decline tunneling (`packages/core/src/permission.ts`, `packages/core/src/tool/runtime.ts`, `packages/core/src/session/runner/step.ts`, `packages/core/src/session/model-request.ts`) and Code Mode limits (`packages/core/src/codemode/tool.ts`, `packages/core/src/tool.ts`).
- [x] Take `packages/core/src/codemode/web.ts` (`fetch` in scripts).
- [x] Permission policies still deny providers from `experimental.policies` (`packages/core/src/config/plugin/policy.ts`).
- [x] Recovered shell notices do not wake idle sessions.
- [x] Subagent model selection + models tool present.

Acceptance: `bun typecheck` and `bun test` from `packages/core` and `packages/codemode`.

### 7. Quota and credentials

- [x] `QuotaPlugin` remains last in `ProviderPlugins`.
- [x] TUI quota still prepends `sidebar.content`.
- [x] Claude SKU still reads `rate_limit_tier`; Codex still maps `prolite` / JWT `chatgpt_plan_type` to `Pro 20x`.
- [x] `packages/core/src/integration.ts` overlap keeps OAuth refresh single-flight.

Acceptance: `bun test` from `packages/quota-plugin`. Sidebar still lists ChatGPT/Claude/xAI/Google when those credentials exist.

### 8. Install, lockfile, check

- [x] `bun install` to rewrite `bun.lock`.
- [x] `bun run check` from repo root.
- [x] Package tests: `packages/cli`, `packages/tui`, `packages/core`, `packages/server`, `packages/codemode`, `packages/quota-plugin`. Core/codemode/quota/server green after identity test fixes. CLI service tests polluted by `OPENCODE_CONFIG_DIR` in this environment. TUI: 13 remaining failures (blank-frame timeouts + Night Owl color assertions) — not resolved in this merge.
- [x] Do not run tests from repo root.

Acceptance: check green. Updater tests still detect platform packages. No `opencode` bin in `packages/cli/package.json`.

## Validation commands

```text
git rev-parse upstream/v2          # 47f66de8dd at kickoff
jj log -r sync-upstream-v2 -n 3
rg '<<<<<<<'                       # empty
rg 'server\.status\(' packages --glob '!**/gen/**'   # empty
rg '"opencode"' packages/cli/package.json              # empty
cd packages/client && bun run generate && jj diff --stat   # second run: no diff
cd packages/core && bun typecheck && bun test
cd packages/cli && bun typecheck && bun test
cd packages/tui && bun typecheck && bun test
cd packages/quota-plugin && bun test
cd packages/codemode && bun typecheck && bun test
# from repo root
bun run check
```

`/btw` smoke: `bun run dev:live` in a worktree, open a session, `/btw what is the current task`, confirm the main run continues.

## Risks

- **`server.status` → `server.info`** breaks the four fork-owned API callers listed in Step 3. A repo-wide `rg server\.status` also matches MCP `server.status` field reads (`mcp/list.ts`, `dialog-mcp.tsx`, `app.tsx`) and upstream-converted files; use `rg 'server\.status\('` and only edit the four.
- **Updater overlap** can drop `installedPackageName` and reintroduce curl or `@opencode/cli` package names. Diff `packages/cli/src/services/updater.ts` against `7bb5fea2a1` after the merge.
- **`publish.ts` conflict** can drop the `Latitudes-Dev/shuvcode` guard or widen the package list beyond CLI packages.
- **`builtins.ts`** can drop quota or `$` while adding `/btw`.
- **Theme rename** breaks custom themes that still say `surface`. Upstream `v1-migrate.ts` must map it; verify fallback tests.
- **Code Mode `tool.ts`** is a two-hunk conflict. Losing decline extraction (see Fork invariants for the real files) makes user denies look like tool errors.
- **Version strings** in package.json files will try to become `2.0.8`. The CLI package is `2.0.8-shuv.1`; keep `-shuv.N` everywhere that publishes.
- **Working-copy discard** via `jj abandon @` would delete this plan file. Keep the plan on a change of `integration-v2` until the merge exists.
- **Poison merge** — a two-parent commit whose tree equals `integration-v2` plus this plan. `jj new` without resolving conflicts, or restoring TUI paths from the fork after merge, produces this. Verify upstream adds exist on disk before moving the bookmark.

## Rollback

```text
jj undo                 # immediately after a bad merge step
jj abandon -r sync-upstream-v2   # drop the branch; integration-v2 unchanged
```

Do not `jj git push` this bookmark in this plan.

## Unresolved choices

None. In-tree version is `2.0.8-shuv.1` in the merge commit (see Locked decisions); publishing it is out of scope.
