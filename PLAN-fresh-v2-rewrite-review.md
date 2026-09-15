# Review of PLAN-fresh-v2-rewrite.md

Reviewed 2026-09-15 PDT against `integration-v2` (`c9813e253b`) and `upstream/v2`
(`d0a902815d`). Sources: fork delta from merge-base `21adcb4969`, commit bodies
for the 61 fork-only V2 commits, all Latitudes-Dev/shuvcode PRs/issues, the
`fork-v1-final` inventory, and the live host.

Scope of this file: facts about the upstream tree and the cutover that the
plan gets wrong or leaves out. Past fork bug fixes are **not** assumed to be
needed; they live in `PLAN-fresh-v2-rewrite-watchlist.md` with a check each,
and enter the plan only if the check fails at kickoff.

Verdict: architecture holds. Corrections below are to descriptions of the
upstream API, the XDG decision, and the converter.

## 1. Plugin API described by the plan does not exist on `d0a902815d`

- `ctx.catalog.transform` and `@opencode/plugin/effect/catalog` are gone.
  Upstream split them into `ctx.provider` and `ctx.model`
  (`core/src/plugin/host.ts`); the subscription zero-cost pattern is
  `ctx.model.transform` in `core/src/plugin/provider/openai.ts:268`.
  L6 Claude (`catalog.transform: zero cost`) and L6 Antigravity ("copy,
  retarget `@opencode/plugin`") both need rewriting against the new editors.
  Antigravity's `wire.ts` / `index.ts` import `CatalogEditor` and will not
  typecheck as a copy.
- `SessionHttpRequest` carries no `providerID`. Scoping is
  `ModelHookOptions.providerID` at registration
  (`plugin/src/effect/registration.ts:7-24`). Wording only.
- Verified as the plan states: `ctx.integration.transform` with OAuth and
  env methods; mutable `request` / `response` in the HTTP hooks; hooks wrap
  the native Anthropic `httpJson` transport; `ProviderPlugins` registry with
  `-<id>` config disable; `KeyedMutex` absent from `connection.resolve`
  (`integration.ts:675-692`); TUI has no autocomplete, default-theme, or
  integration-sort seam (`theme.tsx:130` `active: "opencode"`,
  `dialog-integration.tsx:29` priority map without `xai`).

## 2. "Do not re-port" list overstates what is upstream

These are statements about the tree, not about whether the bugs matter.
Whether to act is a watchlist question (A1, A2, B1).

- "Max-step guardrail as a synthetic user message" — upstream
  `runner/llm.ts:236` still appends `Message.assistant(MAX_STEPS_PROMPT)`.
- "Gemini tool-schema projection" — the base projector is upstream; the
  fork's optional-object typing and boolean-const handling are not.
- "TUI `catalogReady` / prompt freeze" — present, but it is not the #353
  cold-start fix; `location.tsx:44` still gates catalog sync on SSE.

Verified present and equivalent: durable `session_inbox`,
`http.request`/`http.response`, per-session permission rules.

## 3. XDG decision 8 is under-specified

Live host: data at `~/.local/share/opencode/opencode.db` (898 MB), state at
`~/.local/state/opencode/`, cache at `~/.cache/opencode/`. Config already at
`~/.config/shuvcode/` via the unit drop-in `OPENCODE_CONFIG_DIR` and the
`~/.config/opencode/opencode.json` symlink. No `~/.local/share/shuvcode` exists.

- "Convert the elected Shuvcode DB in place. Do not copy from `*/opencode`"
  contradicts itself: the elected DB is under `*/opencode`. L3 needs a
  relocation step for `opencode.db`, `auth.json`, `mcp-auth.json`,
  `antigravity-accounts.json`, `log/`, state (`frecency.jsonl`, `kv.json`,
  `model.json`, `plugin-meta.json`, `<channel>/tui`), and
  `~/.cache/opencode/skills`.
- `Global.app` moves directories only. Literal after the change:
  `client/src/effect/service.ts:156` `Service.fallback()` →
  `state/opencode/service.json`; default spawn `["opencode","serve","--service"]`
  (`:68`); DB filename `opencode.db`; project `opencode.json` / `.opencode/`;
  global filename `opencode.json`; `~/.claude`, `~/.agents`; theme id
  `"opencode"`; desktop `background-service.ts:43`. State which are the
  OpenCode-format contract and which are identity. `Service.fallback()` is
  the one that silently reconnects a plain client to the wrong app.
- `opencode-local.db` (AGENTS.md dev-channel note) is not in upstream
  `database-path.ts`. Decide whether `dev:live` keeps that overlay.
- Port sites beyond `0xc0de`: `0xc0df` (`local` channel),
  `server/src/process.ts:154` listen fallback `4096`, `github/index.ts:233`,
  docs and e2e fixtures, `cli/test/service.test.ts`.

## 4. Converter (L3) is incomplete

- Drop by name: `form_request`, `permission_request`, `session_dynamic_tool`,
  column `session_v2.policy`. `pairing_device` is already gone.
- Drop or empty any leftover V1 `session` table; renaming is not enough.
  `V1Migration` (`core/src/database/v1-migration.bun.ts:1061`) triggers on
  `sqlite_master name='session'`, deletes `event` rows in batches, re-imports.
- Execute `20260910120000_clear_v1_session_permission` (`UPDATE session_v2
  SET permission = NULL`). Stamping without running leaves V1 blobs where
  upstream now reads a ruleset.
- Keep `20260805200742_import_legacy_credentials` stamped as applied; a
  re-run after the app rename reads a non-existent
  `~/.local/share/shuvcode/auth.json`.
- Clear `time_suspended` and `resume_attempts`.
- If anything renames `session` → `session_v2`, drop the partial indexes on
  `time_suspended` first (`4ea8c1b7ec6d`).
- Keep the `anthropic` → `claude-pro-max` credential method-id mapping.

## 5. Cutover mechanics not in the plan

The live unit carries state that portable `Service.ensure` must re-express
via `shuvcode service set env`, or it is lost at `systemctl --user disable`:

- `BUN_TMPDIR=~/.cache/bun-compile-tmp` + `ExecStartPre` mkdir (watchlist D1).
- `OPENCODE_CONFIG_DIR=~/.config/shuvcode` — redundant after `app = "shuvcode"`.
- `EnvironmentFile=~/.config/shuvcode-bot/discord.env` — shuvbot-discord is
  moving to its own upstream V2 host (`PLAN-SHUVBOT-OPENCODE-V2.md`); confirm
  it is off this host first.
- `KillMode=process` for PTY-daemon survival; verify `service restart`
  keeps terminals with upstream's env-based handoff.
- Bind `<tailscale-ip>:4096`, `tailscale serve` on 10001 → `pair --url`.
- Per-channel `service-*.json` passwords; `~/.config/shuvcode/node_modules`.

goal-plugin is live-loaded from `packages/goal-plugin/src/index.ts` in
`~/.config/shuvcode/opencode.json` and backs the `plannotator-setup-goal`
workflow. It uses only public `@opencode-ai/plugin` + `promise/tool`, and
upstream now has synthetic `metadata`. Either keep it or remove it from the
config at cutover; the plan does neither.

Version scheme: with `nextForkVersion` retired and `shuvcode@2.0.3`
published, there is no valid version for a fork-only fix before upstream
`2.0.4` (`2.0.3-x` sorts below `2.0.3`; npm rejects a `+build` republish).
Choose before the first publish.

## 6. Smaller corrections

- `test.yml`: fork dropped Windows; `typecheck.yml` runs from the repo root
  against AGENTS.md. Decide for L0.
- Root `package.json`: fork removed `packages/console/*` from workspaces;
  plan says keep trees. Follow the plan.
- `launcher.mjs` vs upstream `postinstall.mjs` is an install-model choice
  (PR #347: `bun i -g` blocks postinstall). Name it in L1.
- `package-smoke.ts` asserts `SessionPolicy`; drop with policy.
- Claude `<env>` canary: `instructions/builtins.ts` is byte-identical to the
  fork apart from package names; `normalizeEnv` / `isCanonical` still match.
  Re-verify billing on a real subscription before deleting the proxy.
- Do not bring `auth.status` along when porting the OAuth mutex.

## 7. Reversals worth stating explicitly

- Pairing was removed 2026-07-27 and re-affirmed out in
  `PLAN-upstream-v2-20260830.md`; the plan ships upstream `pair`.
- The SessionRestart prohibition appears in `execution.ts`,
  `specs/v2/session.md`, AGENTS.md, and the Aug 30 plan. No double-charge
  postmortem exists; the `time_suspended` clear is the mitigation.
- systemd was chosen against PR #339 (config clobber), PR #340 (SSH PATH),
  PTY `KillMode`, and upstream `Service.ensure` incident #36688. The
  "must never" is policy, not a disproof of those.
