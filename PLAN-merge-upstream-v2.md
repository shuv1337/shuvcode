# Merge upstream V2 through `68b28bdb98`

## Goal

Merge `upstream/v2` into `integration-v2` in one merge commit. The range runs from merge-base `ceace24a3e` through `68b28bdb98`: 49 commits and 321 files. Keep Shuvcode identity and the bundled plugins. Take upstream behavior everywhere else. Delete superseded plan files in the same change.

This replaces the executed `47f66de8dd` plan (merged as `99dbb4f115`) and the follow-up sync through `ceace24a3e` (`06d7828a15`).

## Current

| | Value |
|---|---|
| Branch | `integration-v2` at `75239eba8d` (clean). `sync-upstream-v2` sits at `06d7828a15` (the previous sync) |
| Merge-base | `ceace24a3e` (`chore: update nix node_modules hashes`) |
| Upstream tip (fetched 2026-09-22 PDT) | `68b28bdb98` (`fix(codemode): coerce match/search patterns…`, #50802) |
| Fork CLI version | `2.0.12-shuv.3` |
| Upstream version | `2.0.14` (releases `v2.0.13` and `v2.0.14` are in the range) |
| Fork-only commits since last sync | 7: sidebar drag-resize, compact sidebar context, subagents sidebar, Claude 5 identity, publish guard, 2 version bumps |

`git merge-tree --write-tree integration-v2 upstream/v2` reports **2 content conflicts**: `bun.lock` and `packages/cli/package.json` (version). Eight more files changed on both sides, and git auto-merges all of them with disjoint hunks:

| File | Fork hunk | Upstream hunk | Check after merge |
|---|---|---|---|
| `packages/cli/src/commands/handlers/pair.ts` | `shuvcode service set hostname` hint | QR now encodes a `/connect#<base64 creds>` link and prints `Link` | Hint still says `shuvcode`; QR/link renders |
| `packages/core/src/integration.ts` | `refreshLocks` KeyedMutex + `shuvcodeAuthImport: access-only` guard | connection list adds `method: credential.value.type`; formatting | Both present |
| `packages/server/src/process.ts` | port `0x1337`, `shuvcode service restart` | compression/transform moved to serve-time; `NodeHttpServer.layerHttpServices` | Port and copy retained |
| `packages/tui/src/theme/index.ts` | `DEFAULT_THEME_NAME` export and system fallback | `parseThemeDocument` replaces the local decoder | Night Owl remains default |
| `packages/cli/test/auth.test.ts` | `shuvcode auth …` usage strings | fixtures add `method: "key"` | Both present |
| `packages/client/package.json` | `build:promise` script | version | Script kept |
| `packages/core/package.json` | `#antigravity-plugin` import + `@shuvcode/*` deps | version, `gitlab-ai-provider` 6.16.0 | Both present |
| `packages/tui/package.json` | `@shuvcode/quota-plugin` dep | version | Dep kept |

## Locked decisions

- One merge of `upstream/v2` at `68b28bdb98`, not 49 cherry-picks. Re-fetch at kickoff. If the tip moved, re-run `merge-tree` and take the new tip if it is still only the two conflicts. Otherwise stop and refresh this plan.
- Upstream wins unless a fork invariant below says otherwise.
- The version becomes `2.0.14-shuv.1`. The `-shuv.N` counter restarts because the upstream base moved. Publishing is out of scope.
- Regenerate `bun.lock` with `bun install`. Do not line-merge it.
- `packages/client` generated output comes from upstream. The fork has no Protocol/HttpApi changes in this range, so run `bun run generate` only to confirm a no-op.
- Upstream "OpenCode" strings in this range are product names (`OpenCode Console` integration, test fixture project names). Do not rebrand them.
- No push, PR, or release.

## Fork invariants

| Invariant | Where |
|---|---|
| Package/bin `shuvcode`; no `opencode` bin | `packages/cli/package.json` |
| Version `<upstream>-shuv.N` → `2.0.14-shuv.1` | `packages/cli/package.json`, `packages/script/src/version.ts` |
| `Global.app = "shuvcode"` | `packages/util/src/global.ts` |
| Default port `0x1337` (`0x1338` local) | `packages/server/src/process.ts` |
| npm dist-tag updater, platform-package detection | `packages/cli/src/services/updater.ts` |
| Publish guard `shuv1337/shuvcode`, CLI packages only | `packages/cli/script/publish.ts`, `.github/workflows/publish.yml` |
| Quota sidebar, `$` skill, subagents sidebar, compact context, drag-resize sidebar | `packages/tui/src/feature-plugins/sidebar/*`, `prompt/skill-dollar.ts`, `plugin/builtins.ts`, `routes/session/sidebar.tsx`, `component/session-frame.tsx` |
| Night Owl default | `DEFAULT_THEME_NAME` in `packages/tui/src/theme/v1.ts` |
| Claude Pro/Max (Claude 5 identity), Antigravity, Codex | `packages/{claude,antigravity,quota}-plugin`, `packages/core/src/integration.ts` |
| TUI logo | `packages/tui/src/shuv-logo.ts` |
| Pairing dialog | `packages/tui/src/component/dialog-pair.tsx` uses the upstream `/connect#…` link format; only the `shuvcode service` hint is fork copy |

## Upstream changes to verify against fork code

These files have no textual overlap, but they touch areas the fork builds on:

- **Theme schema: dynamic hue names** (`8683406690`) and **derived bright palette** (`cdccde7408`). `HueName` becomes any non-empty string, and `v1-migrate.ts` changes. Night Owl, the mini-runtime fallback (`packages/tui/src/mini/theme.ts`), and custom-theme fallback must still resolve.
- **Composer import-cycle refactor** (`18eeb3201d`) and changes to `routes/session/index.tsx`. Verify the fork sidebar drag-resize and subagents panel still mount.
- **API error messages in toasts/CLI** (`2e4abeb25d`, `740072694d`, `d56ce74373`). The fork edited `packages/tui/src/util/error.ts` and `test/plugin-toast.test.tsx`. Confirm fork copy survives and upstream messages show.
- **Media foundation** (`60c78ed8ab`, packages/ai). The fork plugins import only `@opencode/plugin` and `@opencode/schema`, so typecheck should be enough.
- **New migration** `20260923013825_project_time_active` (projects ordered by activity). The fork adds no migrations, so the registry comes from upstream.
- **Session metadata updates** (`5c53cfc342`): new public API. The regenerated client should already match.
- **Transcript export** (`cf4b4c2312`) and **worktrees out of projects** (`2f06f9d58b`): TUI smoke only.

## Plan file cleanup

Delete in the merge commit:

| File | Why |
|---|---|
| `PLAN-upstream-v2-sync.md` | Abandoned scarred-tree merge (`16b247f756..85ea15e56d`) |
| `PLAN-npm-trusted-publishing.md` | Self-marked superseded. Trusted publishing is restored (`41bf4e3b00`), and the guard targets `shuv1337/shuvcode` |
| `PLAN-fresh-v2-rewrite-review.md` | Review of the rewrite plan, approved and executed 2026-09-15 |
| `PLAN-live-test-v2-rewrite.md` | One-off pre-cutover live test. The global cutover is recorded as done (`0ca61cf7f9`) |
| `PLAN-live-test-v2-rewrite-results.md` | Results of the above |

Keep:

- `PLAN-fresh-v2-rewrite.md`. `AGENTS.md` names it as "the map" for fork identity. Deleting it would also require editing `AGENTS.md` (see Unresolved choices).
- `PLAN-fresh-v2-rewrite-watchlist.md`. It still holds open verify-before-reapply items (A1–A5, B1, B2, B4…).
- `V2_HTTP_API_AUDIT.md`. It is an audit, not a plan.
- This file. It stays as the current sync plan.

Before deleting, run `rg -l 'PLAN-(upstream-v2-sync|npm-trusted|fresh-v2-rewrite-review|live-test)'` and fix any remaining links in the kept files.

## Ordered tasks

### 1. Prep

```text
git fetch upstream v2
git rev-parse upstream/v2                     # expect 68b28bdb98…
git merge-tree --write-tree --name-only integration-v2 upstream/v2   # expect bun.lock, packages/cli/package.json
jj bookmark set sync-upstream-v2 -r integration-v2 --allow-backwards
jj new integration-v2 v2@upstream -m "chore(sync): merge upstream v2 through 68b28bdb98"
```

### 2. Resolve

- `packages/cli/package.json`: set `"version": "2.0.14-shuv.1"` and keep everything else from the fork.
- `bun.lock`: take either side, then run `bun install` from the root to regenerate it.
- Spot-check the 8 auto-merged files against the table above.

### 3. Plan cleanup

Delete the 5 files listed above and fix any dangling references.

### 4. Generate and install

```text
bun install
cd packages/client && bun run generate      # expect no diff beyond upstream
```

### 5. Checks

```text
rg '<<<<<<<|>>>>>>>' -g '!bun.lock'                     # empty
rg '"opencode"' packages/cli/package.json              # empty
rg 'opencode service' packages/cli/src packages/server/src   # empty (fork copy says shuvcode)
cd packages/core && bun typecheck && bun test
cd packages/cli && bun typecheck && bun test
cd packages/tui && bun typecheck && bun test
cd packages/theme && bun test
cd packages/codemode && bun typecheck && bun test
cd packages/quota-plugin && bun test
cd packages/claude-plugin && bun test
# repo root
bun run check
```

### 6. Live smoke (`bun run dev:live`)

- Night Owl is active on a fresh config. Switching themes works, and a custom v1 theme still loads.
- Session sidebar: quota, subagents, and compact context render, and drag-resize works.
- `$` skill autocomplete works. `/btw` works.
- `shuvcode pair` prints the QR, the `Link`, and the `shuvcode service set hostname` hint.
- An API error (for example a bad key) shows the upstream message in a toast.
- The open dialog lists projects in recent-activity order, with no worktrees.
- Narrow and wide terminal widths.

### 7. Land

Move `integration-v2` to the merge commit (`jj bookmark set integration-v2 -r @`). Push and release need a separate go-ahead.

## Risks

- **Theme schema loosening** could hide a Night Owl migration regression. Check it with the `theme` package tests plus `test/mini/theme.test.ts` and `test/cli/tui/theme-mode.test.tsx`.
- **`server/process.ts` restructure**: upstream now applies `transform` and compression at serve time. The fork only changes the port and copy, but confirm that `shuvcode serve` still binds `0x1337`.
- **Lockfile**: `pacote` patch moves to `21.5.1`. If `bun install` reports a missing patch file, take upstream `patches/`.
- **jj detached HEAD** (#361): build channel detection returns empty under jj. Run the `dev:live` smoke from a git-checked-out worktree or pass the channel explicitly.

## Rollback

`jj abandon` the merge change, then `jj bookmark set sync-upstream-v2 -r 06d7828a15 --allow-backwards`. `integration-v2` does not move until step 7.

## Unresolved choices

1. **`PLAN-fresh-v2-rewrite.md` / watchlist.** Default: keep both. Alternative: fold the identity facts (already in `AGENTS.md` → "Shuvcode Fork"), delete both, and drop the `AGENTS.md` pointer.
2. **TUI `/pair` QR format.** Decided 2026-09-22: align with upstream. `dialog-pair.tsx` encodes the same `/connect#<base64 {username,password}>` link that `shuvcode pair` and desktop produce, and shows the link text. The app scanner still accepts legacy JSON.
