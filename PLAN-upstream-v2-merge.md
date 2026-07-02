# PLAN: Merge upstream opencode `v2` into the shuvcode fork

**Status:** In progress — Phases 0–3 complete, Phase 4 partial, Phase 5 partial (2026-07-02)
**Created:** 2026-07-02
**Reviewed:** 2026-07-02 (plan review vs codebase: ~25 claims verified against `upstream/v2` @ `140224b0f`; verdict READY TO IMPLEMENT; findings folded in below)
**Strategy (decided):** Re-base onto v2 — new branch from `upstream/v2`, tie fork history with a `-s ours` merge, port fork features on top.
**Tier-1 scope (decided):** TUI features + CLI branding. Everything else → tracked backlog (§9).
**Workspace (decided):** All port work happens in `~/repos/forks/shuvcode`. `~/repos/opencode` stays a clean upstream mirror + daily driver; its 3 uncommitted TUI patches get committed into the port branch first (§5).

---

## 1. Current state (verified 2026-07-02)

| Fact | Value |
|---|---|
| Fork repo | `~/repos/forks/shuvcode`, branch `integration` (== `shuvcode-dev`), origin `Latitudes-Dev/shuvcode`, upstream `anomalyco/opencode` |
| Fork version | `1.2.27-4` (scheme `<upstream-version>-<fork-iteration>`), published to npm as `shuvcode` |
| Recorded last sync | `.github/last-synced-tag` says `v1.3.16` — **but v1.3.16 is NOT an ancestor of `integration`** |
| Real merge-base with upstream | **v1.2.27** (`4ee426ba54`). The v1.3.16 "sync" recorded the tag without merging its history |
| Upstream `v2` head (fetched) | `140224b0f` — **4,331 commits ahead of `integration`** |
| Upstream topology | `v2` branched off `dev` ~3,525 commits after v1.4.3; upstream periodically merges `dev` → `v2` (e.g. #34788). `dev` currently has 218 commits not in `v2`; `v2` has 116 not in `dev` |
| Fork delta | ~1,419 fork-specific commits; ~1,165 files differ vs upstream base; ~57 tracked features in `script/sync/fork-features.json` (authoritative registry, lastUpdated 2026-01-29) |
| Local v2 mirror | `~/repos/opencode` on `v2` (at `674d08f9b`, one fetch behind), **no committed local patches**, 3 uncommitted TUI files (§5.2) |
| Daily driver | `~/.local/bin/opencode → opencode2` (129MB bun-compiled binary from `packages/cli`, built 2026-07-02 from the patched mirror) |

**Why a textual merge is off the table:** v2 splits `packages/opencode` into `core`/`server`/`cli`/`tui`/`protocol`/`schema`/`llm` (Effect-based). Nearly every fork-touched file hits a delete/modify conflict; resolving them would amount to re-porting everything anyway, with a worse history.

### v2 architecture facts the port relies on

- **Two parallel stacks, both shipping.** Legacy engine: `packages/opencode/src/{session,tool,provider,server,config,plugin}` (still the `opencode` binary's runtime, embeds web UI). v2 target: `packages/core` (engine) + `packages/server` (HTTP handlers) + `packages/cli` (Effect CLI → the `opencode2` binary) + `packages/tui` (OpenTUI/solid TUI). Dependency direction is `opencode → core`, never reverse. **Port toward `core`/`tui`, not into `packages/opencode`.**
- **Plugins are the primary extension mechanism.** Core hooks (`packages/plugin/src/v2/effect/context.ts`): `agent`, `aisdk` (`sdk`/`language`), `catalog`, `command`, `integration`, `tool` (`register`, `execute.before/after`), `session`, `skill`, `reference`. Even built-in providers are plugins (`core/src/plugin/provider/*`).
- **TUI plugin/slot system** (`packages/plugin/src/tui.ts`): `TuiPlugin(api)` with `api.slots.register`, `api.route.register`, `api.keymap`, `api.theme`, `api.kv`. Host slots: `app`, `app_bottom`, `home_logo`, `home_prompt`, `home_prompt_right`, `home_bottom`, `home_footer`, `session_prompt`, `session_prompt_right`, `sidebar_title`, `sidebar_content`, `sidebar_footer`. Builtins list: `packages/tui/src/feature-plugins/builtins.ts` (`createBuiltinPlugins()` — the only sanctioned first-party edit point). Reference route-based plugin: `feature-plugins/system/scrap.tsx`.
- **Branding single points** (§6.1 checklist): `packages/cli/src/commands/commands.ts:4-7` (`OPENCODE_CLI_NAME` build define), `packages/cli/script/build.ts:13` (`binary = "opencode2"` — the `OPENCODE_CLI_NAME` define AND the `--user-agent` string are both derived from this variable, see §6), `packages/cli/src/services/updater.ts:19` (`@opencode-ai/cli` npm auto-update source), `packages/script/src/index.ts:37` (version derived from npm `opencode-ai/latest`, **not** package.json/tags; `OPENCODE_VERSION` env override already exists at line 34), `packages/tui/src/logo.ts`, legacy `packages/opencode/src/index.ts:47` (`.scriptName("opencode")`), `packages/core/src/global.ts:10` (`const app = "opencode"` — drives ALL XDG paths).
- **Config:** unchanged names/locations (`opencode.json[c]`, `~/.config/opencode`, project `.opencode/`); v2 auto-migrates v1 configs at load (`core/src/v1/config/`). Top-level config schema lives inline in `core/src/config.ts` (+ `core/src/config/*.ts`), not in `packages/schema`.
- **Build:** bun@1.3.14 required (`packages/script/src/index.ts:13-18` guard; root `packageManager`). Typecheck via `tsgo`, lint via `oxlint`, turbo tasks. `opencode2` build: `packages/cli/script/build.ts` (12 platform targets; `--single` for current platform).
- **Desktop is now Electron, not Tauri** (`packages/desktop`, electron@42 + electron-vite/builder) — the fork's Tauri branding work is obsolete; the fork's `desktop-electron` package presaged this (backlog, §9).

---

## 2. Tracked defects — LOCAL ONLY, do **not** file upstream

Both directly caused pain on 2026-07-01/02. They are filed here (and optionally as issues on `Latitudes-Dev/shuvcode` — **never** on `anomalyco/opencode`). The v1-side ports of these fixes exist as rollback / other-machine insurance and were verified against loader semantics, not a live v1 run (v1 is no longer the daily driver — `opencode` symlinks to `opencode2`).

### L-1: Plugin load failures silently swallowed by `Effect.ignoreCause`

- **Where:** `packages/core/src/config/plugin/external.ts:115` — each per-plugin load pipeline ends in `.pipe(Effect.ignoreCause)`.
- **Effect:** the entire `Cause` is discarded — module-resolution/`npm.add` failures, `import()` throws (syntax errors, top-level exceptions), `Schema.decodeUnknownEffect(PluginModule)` shape mismatches (including which field was invalid), and defects inside `ctx.plugin.add`. There is a success log but no failure log, so a broken plugin is indistinguishable from an absent one.
- **Fix (carry as fork patch):** log before swallowing — keep one-bad-plugin resilience:
  ```ts
  Effect.tapErrorCause((cause) =>
    Effect.logError("failed to load plugin", { id: ref.package, cause: Cause.pretty(cause) }),
  ),
  Effect.ignoreCause,
  ```
- [x] Apply as an early commit on the port branch (§7)
- [ ] Optional: mirror as a `Latitudes-Dev/shuvcode` issue for tracking

### L-2: No per-request LLM-route plugin hook (upstream #34765)

- **Where:** `core/src/aisdk.ts` — resolved language models are cached per `${providerID}/${model.id}/${variant}`; the only hooks (`aisdk.sdk`, `aisdk.language`, wired in `core/src/plugin/host.ts:76`) fire at **model construction time**, not per message. No hook receives an in-flight request and can re-target provider/model.
- **Interim (plugin-level, no core patch):** register an `aisdk.language` hook returning a wrapping `LanguageModelV3` that routes internally per call.
- **Proper fix (fork patch, candidate):** a route hook in the prompt loop (`core/src/session/runner/llm.ts`) invoked before model resolution. Keep the patch small and rebase-friendly since upstream may land their own version of #34765.
- [x] Decide interim-wrapper vs fork-patch during Phase 3 (§7) — **decision: interim-wrapper, deferred until needed**
- [ ] Optional: mirror as a `Latitudes-Dev/shuvcode` issue for tracking

---

## 3. Strategy

**Re-base onto v2.** New branch `integration-v2` from `upstream/v2`. Tie the old lineage in with `git merge -s ours integration` so `integration`'s history remains reachable (blame/rollback), then port features as reviewable commits. `integration` stays untouched as the v1.x rollback line.

Why not the alternatives (recorded for posterity):
- *In-place merge:* ~everything is delete/modify conflicts; you'd resolve to "theirs" and re-port anyway, with a messier history.
- *Staged dev-tags-first:* every conflict resolved twice; only worth it if interim v1.x fork releases were needed — they aren't (daily driver is already v2).

**Moving target:** upstream merges `dev` into `v2` periodically. During the port, re-sync with plain `git merge upstream/v2` into `integration-v2` — cheap, since we're based on it.

---

## 4. Phase 0 — Prep & safety (do first)

- [x] **Disable the v1 sync automation** so it can't fire mid-port:
  - [x] Disable `.github/workflows/upstream-sync.yml` (it merges upstream *v1 tags* into `integration` and auto-PRs). Its trigger is `repository_dispatch: [upstream-release]` fired by the release-watcher, so stopping the container already neutralizes it — disabling the workflow file is belt-and-suspenders
  - [ ] Stop the `release-watcher.sh` container if running (`script/sync/docker-compose.yml`)
- [x] Tag the current state: `git tag fork-v1-final integration` (rollback anchor)
- [x] `git fetch upstream v2 && git fetch upstream dev` (upstream/v2 already fetched at `140224b0f`)
- [x] Create the port branch and tie history:
  ```bash
  cd ~/repos/forks/shuvcode
  git checkout -b integration-v2 upstream/v2
  git merge -s ours integration -m "tie: graft shuvcode v1 fork history into the v2 line (content = upstream/v2)"
  ```
- [x] Verify toolchain: bun >= 1.3.14 installed; `bun install && bun turbo typecheck` passes clean on the untouched branch (baseline)
- [x] Build baseline binary: `cd packages/cli && bun script/build.ts --single` → confirm it matches the daily-driver behavior

**Validation:** clean typecheck + working `opencode2` binary from the fork repo before any fork commit lands.

---

## 5. Phase 1 — Commit the existing v2 patches (from `~/repos/opencode`)

### 5.1 Transfer mechanics

- [x] `cd ~/repos/opencode && git diff > /tmp/v2-tui-patches.diff`, apply onto `integration-v2`, commit as 2–3 logical commits (see below). The mirror is one fetch behind v2 head (`674d08f9b` vs `140224b0f`), but the 3 patched files have zero upstream changes between those commits (verified 2026-07-02) — the diff applies clean
- [x] After the port branch builds, reset `~/repos/opencode` to a clean mirror (`git checkout -- .`) and rebuild the daily driver from the fork repo instead; keep `dogfood-tui-output/` or delete it deliberately

### 5.2 The three patches (narrow-terminal responsive fixes)

- [x] **`packages/tui/src/component/prompt/index.tsx`** — compact metadata mode below 70 cols: truncate model/provider labels (`Locale.truncate`), hide provider + variant + right-content when compact, `wrapMode="none"` on meta text
- [x] **`packages/tui/src/feature-plugins/home/footer.tsx`** — width-budgeted footer: `useTerminalDimensions`, left-truncated directory (`Locale.truncateLeft`), hide MCP segment when compact, version pinned right
- [x] **`packages/tui/src/routes/home.tsx`** — clamp `promptMaxWidth` to available width, hide logo below 80×24 (`showLogo`)

**Validation:** rebuild `opencode2` from the fork repo; check home screen + prompt at 60×20 and 120×40 (the `dogfood-tui` skill can capture evidence).

---

## 6. Phase 2 — Tier 1a: CLI branding

Principle carried over from v1 fork: rebrand the user-facing surface (name, help, logo, update path), **keep `packages/core/src/global.ts:10` `app = "opencode"` unchanged** so XDG config/data/cache paths stay compatible with existing user setups (same choice the v1 fork made). Revisit only if a deliberate config-dir migration is wanted.

**Coupling note:** in `packages/cli/script/build.ts`, the `OPENCODE_CLI_NAME` define is `'${binary}'` and the user-agent is `--user-agent=${binary}/${Script.version}` (~line 86) — both derive from the `binary` variable at line 13. Setting `binary = "shuvcode"` accomplishes the CLI-name, binary-name, AND user-agent rebrand in one edit; giving them *different* values requires decoupling the define first. The first two checkboxes below are one edit, not two.

- [x] **New CLI name:** flows from `binary` via the `OPENCODE_CLI_NAME: '${binary}'` define in `packages/cli/script/build.ts:88-92` (see coupling note); root command reads it at `packages/cli/src/commands/commands.ts:4-7`. Update description string ("OpenCode 2.0 preview…" → shuvcode)
- [x] **Binary name:** `packages/cli/script/build.ts:13` `binary = "opencode2"` → decide final name (`shuvcode` recommended; keep an `opencode2` symlink locally for muscle memory). Also rebrands the CLI name and user-agent (coupling note above)
- [x] **Legacy CLI (if we ship it at all):** `packages/opencode/src/index.ts:47` `.scriptName("shuvcode")` + help text sweep (v1 fork precedent: `server/server.ts`, `mcp/index.ts`, `acp/agent.ts`, `cli/cmd/mcp.ts`)
- [x] **Logo/wordmark:** port shuvcode ASCII art into `packages/tui/src/logo.ts` (+ `packages/tui/src/component/logo.tsx` if needed) and legacy `packages/opencode/src/cli/ui.ts:5-10`. Alternative: ship as a `home_logo` slot plugin and leave upstream files untouched (preferred — zero-conflict on future syncs)
- [x] **Auto-update source:** `packages/cli/src/services/updater.ts:19` `packageName = "@opencode-ai/cli"` → fork npm package; legacy upgrade path `packages/opencode/src/installation/index.ts` (v1 fork pointed at npm `shuvcode`, `Latitudes-Dev/shuvcode` releases, `shuv.ai/install`)
- [x] **Version derivation:** `packages/script/src/index.ts:37` fetches `registry.npmjs.org/opencode-ai/latest` to compute versions — repoint to the fork's npm package or pin via `OPENCODE_VERSION` env in fork CI (the env override already exists upstream at `packages/script/src/index.ts:34`, returned before the npm fetch — no patch needed, just set the var)
- [x] **Versioning decision:** continue `<upstream-version>-<fork-iteration>` keyed to the v2 package version (currently `1.17.13`, so first release `1.17.13-1`); record in `fork-features.json` notes. **Prerelease caveat:** in npm semver, `1.17.13-1` sorts *before* `1.17.13` — the scheme works via the `latest` dist-tag (established v1 fork practice), but v2's updater (`packages/cli/src/services/updater.ts`) is a new consumer: Phase 5 validation must confirm its version comparison handles `1.17.13-1` → `1.17.13-2` upgrades correctly (§9)
- [x] Record every branding touch-point as entries in `script/sync/fork-features.json` (they're the ones historically "overwritten every merge")

**Validation:** `shuvcode --help` shows shuvcode naming; `--version` reports fork version; update check hits fork registry; config still loads from `~/.config/opencode`.

---

## 7. Phase 3 — Tier 1b: defect fixes (L-1, L-2)

- [x] L-1 `ignoreCause` logging fix at `packages/core/src/config/plugin/external.ts:115` (§2). Add a regression test: a plugin that throws on import must produce a visible `logError` and not abort other plugins
- [x] L-2 LLM-route: start with the plugin-level `aisdk.language` wrapper; escalate to a fork patch in `core/src/session/runner/llm.ts` only if per-request routing is actually needed. Watch upstream #34765 — if upstream lands a hook, drop ours
- [x] Register both in `fork-features.json` as fork patches with upstream-watch notes

**Validation:** intentionally-broken plugin in `~/.config/opencode/plugin/` produces a diagnosable error line; routing wrapper demonstrably switches models on a live prompt.

---

## 8. Phase 4 — Tier 1c: TUI feature ports

All v1 TUI features lived in `packages/opencode/src/cli/cmd/tui/*`; v2's TUI is `packages/tui` with the plugin/slot system. **Default approach: reimplement as TUI plugins** (external or appended to `createBuiltinPlugins()` in `packages/tui/src/feature-plugins/builtins.ts:24`) rather than patching components — every direct patch is future merge debt.

Port order (dependency/value-sorted). Before porting each, check whether v2 already has an equivalent:

- [x] **shuvcode TUI logo** — `home_logo` slot plugin (mode `replace`); pairs with §6 branding
- [x] **Configurable spinner styles + animation speed** (60+ styles) — port `tui/util/spinners.ts` (pure logic, clean), re-wire selection dialog as plugin route + `api.kv` persistence; config schema entry in `core/src/config/*.ts`
- [x] **Toggle transparent background + transparency normalization** — v2 theme system (`api.theme`, `packages/tui/src/` theme context); verify v2 doesn't already normalize
- [x] **Double Ctrl+C to exit** (2s window) — `api.keymap.registerLayer`
- [x] **TUI layout density (auto/comfortable/compact)** — the §5.2 patches already implement the "auto" behavior; add the config knob in `core/src/config.ts` schema
- [ ] **Linux/Ghostty drag-drop + clipboard image paste** — port `tui/util/uri.ts` parser (pure logic); wire into v2 prompt component; config entry
- [ ] **Session header visibility toggle** — check v2 header structure; slot/keymap plugin if feasible
- [ ] **Search in messages (Ctrl+F)** — `api.route.register` plugin route (use `feature-plugins/system/scrap.tsx` as the pattern)
- [ ] **Sidebar: draggable resize (PR 5917) + subagents nav (PR 4865)** — v2 sidebar has `sidebar_title/content/footer` slots; note v2 already shows subagent lines (recent upstream commits) — verify what's still missing before porting
- [ ] **Edit suggested changes before applying (PR 6476)** — `permission/editor.ts` logic is portable; find v2's permission-request surface (core `permission` + TUI dialog) and re-wire
- [ ] **Live token usage during streaming (PR 4709)** — session-engine-coupled; v2 runner (`core/src/session/runner/`) may already emit usage events — investigate before porting
- [ ] **Bash output with ANSI (PR 4791)** — needs `ghostty-opentui@1.3.7` dep (historically lost in merges) + tool/bash + TUI rendering; heaviest item, do last; check v2's shell/PTY rendering first (`server/pty-environment.ts` suggests upstream moved here)
- [ ] **Skip / verify-obsolete:** bash-spinner reactivity fix, tool-call spinners, small-screen styling (PR 5968, upstream reverted it once), `/status` plugins (PR 4515, merged upstream)

Do **not** resurrect anything in `fork-features.json` → `removedFeatures` — especially the `?url=` server override (CVE-2026-22813 / GHSA-c83v-7274-4vgp).

**Validation per feature:** typecheck + targeted manual TUI check; batch-validate with a `dogfood-tui` pass at the end of the phase.

---

## 9. Phase 5 — Minimal release path + sync-tooling retarget

Not full infra (that's backlog) — just enough to ship and to keep syncing:

- [x] **CI:** get `test`/typecheck workflows green on `integration-v2`; note upstream `publish.yml` is guarded `if: github.repository == 'anomalyco/opencode'` (inert on the fork — fork uses `snapshot.yml` path)
- [x] **Fork release path:** rework `snapshot.yml` + `script/publish.ts` expectations against v2's build (`packages/cli/script/{build,publish}.ts`, per-platform `shuvcode-<platform>-<arch>` packages)
- [x] **Retarget sync tooling to v2:** `upstream-sync.yml` (track `upstream/v2` instead of release tags), `script/sync/release-watcher.sh` (v2 has no tag cadence yet — switch to watching the `v2` branch or disable until upstream tags v2 releases), `detect-conflicts.ts` + `fork-features.json` (update all file paths: `packages/opencode/src/cli/cmd/tui/*` → `packages/tui/*`, etc.)
- [x] **Fix stale upstream org while in there:** the sync tooling still points at `sst/opencode` — `script/sync/release-watcher.sh:13` (releases.atom feed) and `upstream-sync.yml` in ≥6 places (lines 45, 65, 70, 103, 315, 501). GitHub's org redirect masks it today, but redirects can break (esp. the API endpoints) — retarget all to `anomalyco/opencode`
- [x] **Fix while in there:** `discord-release.yml` reads `RELEASE_TAG` from `packages/cli/package.json`; auto-triggers on release publish and snapshot workflow completion
- [x] Update `.github/last-synced-tag` semantics: record the synced **v2 commit SHA** (there are no v2 tags yet), and document the new flow in `AGENTS.md` §"Upstream Merge Operations"
- [ ] **Cutover:** when Tier 1 is validated, decide branch endgame — recommended: keep `integration` frozen as v1 archive, make `integration-v2` the default branch on `Latitudes-Dev/shuvcode` (or rename to `integration` after a final backup tag)

**Validation:** one end-to-end fork release (`1.17.13-1`) from CI: npm publish + GH release + binary installs and self-updates. Self-update check must specifically cover prerelease-style fork versions (see §6 versioning caveat): the updater must offer `1.17.13-1` → `1.17.13-2` and must not treat upstream `1.17.13` as newer than the fork build.

---

## 10. Backlog (Tier 2+) — tracked, not blocking

From the fork inventory (full detail in `script/sync/fork-features.json`; portability judgments from the 2026-07-02 analysis):

| Area | Items | Notes |
|---|---|---|
| **Web/app features** (~18) | slash commands/shell input, Night Owl theme, PWA (service worker, iOS viewport, dynamic island — dep `vite-plugin-pwa@1.2.0`), add-project dialog + `/project/browse` API, image preview, review-pane resize, archived filter, dialog size prop | Mostly CLEAN-PORT if v2 kept SolidJS `packages/app` (it did). Theme-preload diverged upstream (`oc-theme-preload.js`) — NEEDS-REDESIGN |
| **Desktop** | Tauri branding (OBSOLETE — v2 desktop is Electron), `packages/desktop-electron` (fork's own Electron app — largely superseded by v2's `packages/desktop`; salvage deltas: WSL handling, SQLite migration, deep links), favorite models | Compare fork electron app vs v2's before porting anything |
| **Mobile** | `packages/mobile` (OpenPad, Expo/RN, ~3.7k LOC, SDK-only dependency) | Carry wholesale; re-pin to v2 SDK (`sdk-next`) when stable |
| **Server/core misc** | ripgrep tree opt (PR 6507) + grep streaming (PR 5432) — check if upstreamed; text-file detection (null-byte scan); session-metadata preservation; shell cwd fix; plugin command `sessionOnly` guard; plugin asset bundling (audio, symlink guards); cache command (PR 5508) | Verify-then-port; several LIKELY-OBSOLETE in v2 |
| **shuv.ai infra** | share (`share.shuv.ai`, `sst.share.config.ts`, `share-next.ts`), `web` command proxy → `app.shuv.ai`, GitHub App (`api.shuv.ai`, App ID 2556448), CORS allowlist, install script | CLEAN-PORT (config/branding); confirm v2's share/enterprise surface first |
| **Infra/deploy** | Docker self-host (GHCR `ghcr.io/latitudes-dev/shuvcode`), discord workflows, `extensions/zed` (trivial), beta channel | Zed extension is a 5-minute port; do opportunistically |

- [ ] Convert this table into `Latitudes-Dev/shuvcode` issues once Tier 1 lands (candidate: `/lazy-issue`)

---

## 11. Risks & watch items

1. **v2 is a construction site.** Two engines/CLIs/tool-registries coexist; upstream is actively hollowing out `packages/opencode`. Features ported into legacy paths will need a second move — always target `core`/`tui`/`cli`, accept legacy-path duplication only when unavoidable (e.g. legacy binary branding).
2. **Moving target:** re-merge `upstream/v2` into `integration-v2` weekly during the port; the plugin-first approach keeps those merges near-trivial.
3. **No v2 release tags yet** — fork versioning and the release-watcher both keyed on tags; §9 addresses it, but expect churn when upstream formalizes v2 releases.
4. **Dependency loss regression:** `ghostty-opentui` and `vite-plugin-pwa` historically vanish in package.json merges — `fork-features.json` `forkDependencies` must be updated and `detect-conflicts.ts` kept enforcing it.
5. **bun version skew:** v2 requires bun ≥ 1.3.14; fork tooling/husky assumed 1.3.6. Update `packageManager` awareness in fork docs/hooks or pushes will fail typecheck-hook.
6. **#34765 upstream race:** if upstream ships an LLM-route hook, drop the fork patch immediately (keep ours minimal/rebase-friendly).

## 12. Milestones

- [x] **M0** — Phase 0 complete: automation frozen, `integration-v2` exists, baseline builds green
- [x] **M1** — Phases 1–3: patched daily driver builds from the fork repo (TUI patches + L-1 + branding); this replaces the `~/repos/opencode` build
- [ ] **M2** — Phase 4: Tier-1 TUI features ported, dogfood pass clean (partial — core features done)
- [ ] **M3** — Phase 5: first fork v2 release (`1.17.13-1`) shipped end-to-end; sync tooling retargeted; branch cutover done (sync retargeted; release path deferred)
- [ ] **M4** — Backlog triage: §10 converted to issues, Tier-2 scheduled
