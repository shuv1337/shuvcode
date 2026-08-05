# Upstream V2 sync plan - 2026-08-30

## Goal

Integrate `anomalyco/opencode:v2` at
`106629aa118086be7def6123241a9bf056ba77b6` into Shuvcode's
`integration-v2` line at
`4668dfcd867a33bdb63881731bf977e4c80180de`, applying the approved
fork-decision audit: take current upstream behavior by default, move
provider and UI extensions onto the current V2 plugin seams where those seams
own the complete lifecycle, retain only the fork contracts that cannot be
plugins, and remove stale or unsupported fork surfaces.

The recorded common base and sync marker are
`f282a22d9897d5c9f9f9d7602ba63f85f763e181`. At plan time the upstream range is
638 commits across 1,511 paths. The fork range is 52 commits across 331 paths,
with 158 paths changed on both sides. This is an architecture sync, not a
directory-level ours/theirs merge.

The sync is complete when current upstream Session, runner, plugin, provider,
terminal, client, TUI, SDK, and migration architecture is present without
losing Shuvcode identity, persisted-data compatibility, inert Session claims,
Code Mode safety, dynamic tools, Session policy, auth status, manager-owned
systemd service behavior, or fork release controls.

This plan authorizes no implementation by itself. It does not authorize a
push, PR, release, deployment, or restoration of automatic Session startup
recovery.

## Approved decisions

The Plannotator fork-decision audit was approved on 2026-08-30. The following
decisions are implementation constraints, not suggestions.

### Adopt upstream

- Adopt upstream Session admission, first-admission-wins reconciliation,
  preparation ordering, inbox delivery, immediate user shells, and control
  boundaries.
- Adopt upstream's `runner/step.ts` architecture, retry hook, continuation,
  compaction, instruction epochs, move/revert/fork semantics, and durable/live
  event boundaries.
- Adopt upstream's transformable generic tool registry, request-captured tool
  execution, generic output retention, plugin hook vocabulary, and MCP
  lifecycle.
- Adopt upstream JSON-safe Session creation metadata and inheritance.
- Adopt upstream persistent terminals, terminal panes, reconnect behavior,
  Session tabs, optimistic admission, and Client/TUI architecture.
- Adopt upstream native provider implementations and remove stale fork AI-SDK
  adapters for providers now native upstream.
- Adopt upstream portable service-election behavior underneath Shuvcode's
  manager-owned service path.
- Adopt upstream environment inheritance, markerless directory projects,
  plugin VCS markers, public `Agent.Color` behavior, and nullable Workspace
  binding.
- Adopt upstream's implementation of the premature environment-sync fix in
  place of orphan commit `7825151b`, retaining the regression test.
- Keep `packages/util/src/global.ts` `app = "opencode"`; the upstream
  implementation already satisfies this XDG compatibility contract.

### Migrate to plugins

- Keep `@shuvcode/goal-plugin` exclusively on public plugin interfaces and
  preserve the setup-goal handoff as a plugin concern.
- Move Google Antigravity implementation into a dedicated V2 plugin after its
  remaining private imports and callback-page dependency are removed.
- Move `$skill` completion into a TUI plugin while retaining the narrow prompt
  autocomplete registration seam required to host it.
- Move ChatGPT inference `originator` overlays into a provider-scoped plugin
  after captured Codex CLI traffic establishes the complete identity contract.
  Until then, preserve the current three-site `codex_cli_rs` behavior.
- Migrate Claude Pro/Max model request/response shaping to provider-filtered
  `ctx.session.hook("http.request", ...)` and
  `ctx.session.hook("http.response", ...)` registrations only after
  byte- and stream-equivalence tests pass. Do not delete the current transport
  or proxy before that gate.
- Keep the foreground provider-failure toast as a TUI plugin backstop; durable
  failure settlement remains Core-owned.

### Retain in the fork

- Shuvcode package, binary, repository, TUI, documentation, and release
  identity; `integration-v2`; `.github/last-synced-tag`; and `fork-v1-final`.
- The fork CLI/npm distribution, `shuvcode/client`, manual guarded publishing,
  guarded host installer, fork updater policy, and Discord release notice.
- Persisted `manager: "systemd"`, ownership-verified lifecycle,
  `shuvcode.service`, advertised URLs, and portable fallback.
- Every historical fork migration, the fork-tip `session` to `session_v2`
  bridge, pending-to-inbox conversion, and V1 event-preservation guard.
- Inert write-ahead execution claims. Never restore `SessionRestart` from
  Server, fetch, SDK, or startup layers.
- Immutable, non-widening, deny-by-default Session tool policy.
- Durable Session dynamic-tool definitions and the client request/reply plane.
  Pending calls remain process-owner state and are not replayed after owner
  loss.
- Per-credential OAuth refresh single-flight and secret-safe
  `/api/auth/status`.
- Code Mode limits and the uncatchable user-decline/host-defect tunnel.
- Strict atomic tool-registration validation, bounded JSON metadata,
  after-hook machine-output separation, terminal-publish rollback, and
  drain-level persistence escalation.
- The synthetic user max-step guardrail, Anthropic/Gemini schema projections,
  symlink-safe patch moves, realpath containment, and loopback attachment
  limits.
- Explicit configured-plugin precedence, prompt-autocomplete registration,
  CLI metadata fast path, catalog hydration before SSE, Location degradation
  and retry, bounded well-known fetches, boot-phase telemetry, xAI ordering,
  Night Owl default, configured-agent warning, and generated-API discipline.

### Remove

- Retired structured-output code and stale references.
- Fork-only prompt-cache diagnostics unless an execution-time baseline proves
  a current consumer.
- Fork-only automatic-restart runtime residue. Do not alter the recorded
  `20260811161259_execution_claim_attempts` migration.
- Removed captured-output APIs and duplicate Code Mode schema identities.
- The old Effect-tolerant Promise OAuth callback bridge; no current consumer
  exists and the Promise interface requires Promises.
- Built-in administrator-credential pairing: keep the CLI command removed and
  remove the active TUI `/pair` and `/web` surface.
- Inherited upstream workflows, actions, repository tools, and agents that are
  disabled, upstream-targeted, or outside fork product/release scope.
- Stale upstream installer, release, Desktop-update, and repository branding.
- Obsolete client-environment and structured-output plans.

### Closed audit questions

- Provider authorization failures must publish durable `Step.Started` and
  `Step.Failed` rows with `provider.auth`; the toast is only a live backstop.
- Tool terminal-persistence failure must roll back publisher settlement and
  fail the Step/drain through a tagged persistence error. Add a real failing
  publisher test before implementing the port.
- Dynamic-tool definitions are durable. Pending calls support same-owner
  reconnect only; shutdown, process death, or owner eviction terminates them
  without replay.
- Adopt upstream's Promise-first `@opencode-ai/sdk` root and move Effect APIs to
  explicit `/effect` entrypoints. The published `shuvcode/client` facade remains
  unchanged and must pass its package smoke tests.
- Dynamic-tool parameters and inputs are JSON contracts and must use canonical
  Schema-owned `Schema.Json` values across Schema, Core, Protocol, generated
  Client, and SDK re-exports.
- Public `Agent.Color` remains unconstrained for response compatibility;
  `ConfigAgent.Color` remains six-digit hex and regains the contract-hygiene
  test.
- Adopt deterministic per-directory projects and plugin VCS markers for new
  markerless directories. Historical `Project.ID.global` rows are not rewritten.
- Upstream nullable Workspace binding is safe: `session_v2.workspace_id` is not
  a SQL foreign key. Preserve all fork migration IDs while adding it.
- Remove the active TUI pairing surface. Additional clients receive shared
  administrator access only through controlled out-of-band provisioning.
- Retarget ordinary CI to `integration-v2`; remove upstream community and
  deployment workflows that have no fork owner.

### Deferred evidence gates

These gates do not block the generic upstream merge. They block deletion of the
current implementation they replace.

- Claude hook migration: require body/header parity, arbitrary-chunk SSE
  buffering, cancellation, setup-token behavior, request-time token refresh,
  explicit baseURL behavior, and no duplicate shaping.
- ChatGPT identity plugin: capture current Codex CLI traffic to determine User
  Agent, OAuth `originator`, system identity, and tool-name requirements.
- Antigravity extraction: vendor or expose the OAuth callback page, replace
  private Bus/Core imports, and decide how Shuvcode installs the plugin by
  default before removing the internal registration.

## Scope

### In scope

- The exact two-parent sync from `integration-v2` and
  `106629aa118086be7def6123241a9bf056ba77b6`.
- Resolution of the overlap set recomputed by the Milestone 0 commands. The
  plan-time result is 158 paths.
- Reapplication of approved fork contracts onto upstream architecture.
- Migration/schema composition and copied-database verification.
- Public Schema/Protocol/Server reconciliation and generated Client outputs.
- Plugin extraction or seam migration only where the parity gate is defined.
- CI, release, identity, documentation, and stale-workflow cleanup.
- Preservation and post-sync relocation of the current toast and goal-plugin
  stack without committing local `.opencode/goals` state.

### Out of scope

- Automatic startup execution recovery or clustered Session execution.
- Durable replay of dynamic-tool calls after owner/process loss.
- A new per-device pairing or credential-revocation system.
- Rewriting historical `Project.ID.global` rows.
- Compatibility for the retired structured-output surface.
- Publishing, release creation, deployment, bookmark movement of
  `integration-v2`, remote push, or PR creation.
- An upstream PR. The repository is a fork and upstream PRs are prohibited.

## Jujutsu strategy and safety boundary

Do not use the current workspace for the sync. It contains the restored
goal-plugin stack and user/goal state changes. Leave it untouched.

At execution time:

1. Record `jj status`, `jj log -r '@ | @- | @-- | integration-v2'`, and the
   current goal-plugin change IDs from the original workspace.
2. Fetch `origin` and `upstream` with `jj git fetch`. Require
   `integration-v2` to resolve to `4668dfcd867a` and `v2@upstream` to resolve to
   `106629aa1180`. If either moved intentionally, stop and re-audit the added
   range rather than silently expanding this plan.
3. Create an isolated workspace, for example:

   ```sh
   jj workspace add --name sync-v2-aug30 -r integration-v2 \
     /home/shuv/repos/shuvcode-workspaces/sync-v2-aug30
   ```

4. In that workspace, create one two-parent merge change without moving a
   bookmark:

   ```sh
   jj new integration-v2 v2@upstream -m 'chore(sync): merge upstream v2'
   ```

5. Save the conflict list and all 158 semantic-overlap paths outside the
   repository. Classify each as upstream wholesale, manual composition, fork
   reapplication, generated, or intentionally removed.
6. Keep the merge change as the two-parent ancestry anchor. Put independently
   reviewable migration, Session, provider/plugin, client/TUI, and release/docs
   repairs in descendant changes rather than rewriting `integration-v2`.
7. Only after the final approval gate may an executor create or move a short
   candidate bookmark such as `sync-v2-aug30`. This plan does not authorize
   moving `integration-v2`.

Never resolve an entire directory as ours or theirs. Never hand-merge generated
Client/OpenAPI files or `bun.lock`. Never modify or abandon the original
working-copy changes.

## Milestone 0 - preflight and baselines

- [ ] Verify the pinned SHAs, sync marker, and 638/52 commit counts.
- [ ] Recompute path sets with one reproducible, rename-aware Jujutsu method and
      save the exact lists, not only counts:

  ```sh
  jj diff --from f282a22d9897 --to integration-v2 --name-only | sort -u > /tmp/shuvcode-fork-paths
  jj diff --from f282a22d9897 --to v2@upstream --name-only | sort -u > /tmp/shuvcode-upstream-paths
  comm -12 /tmp/shuvcode-fork-paths /tmp/shuvcode-upstream-paths > /tmp/shuvcode-overlap-paths
  wc -l /tmp/shuvcode-fork-paths /tmp/shuvcode-upstream-paths /tmp/shuvcode-overlap-paths
  ```

  At plan time these produce 331, 1,511, and 158. If the pinned trees produce a
  different set, use the recomputed files as authority and record why before
  resolving anything.

- [ ] Save original-workspace `jj status` and identify every goal state file and
      goal-plugin change that must remain untouched.
- [ ] Record current package versions, Bun `1.3.14`, active patches, and
      workspace package list.
- [ ] Discover the elected service and its live channel database rather than
      assuming `opencode.db`: read `shuvcode service status`, read the configured
      manager, obtain the systemd `MainPID` when managed (or registered process PID
      when portable), and inspect that process's open files for the active
      `~/.local/share/opencode/opencode*.db`. Record the exact channel and path.
      Create a transactionally consistent private scratch backup through SQLite's
      online backup mechanism; do not copy only the main file while WAL is active.
      Never migrate the live source or copy refreshed OAuth credentials between
      channel databases. The backup must include
      `session_v2`, legacy `session`, messages, events, execution claims, pending
      inbox work, Session policy, dynamic-tool definitions, historical mobile
      migrations, and Workspace rows.
- [ ] Record baseline checks from the current fork for migration, Session,
      provider, service, Client, TUI, goal-plugin, and release/package-smoke tests.
- [ ] From `packages/app`, run `bun run test:bench` and save the environment,
      revision, pass/skip counts, and output outside the worktree before touching
      Session or timeline code.
- [ ] Capture a live TUI baseline against the elected service without restarting
      it. The pre-sync root script still references the absent `opencode2` helper,
      so use its explicit canonical equivalent for the baseline:

  ```sh
  OPENCODE_TUI_CHANNEL=dev \
    OPENCODE_PASSWORD="$(shuvcode service get password)" \
    bun run dev --server "$(shuvcode service status)"
  ```

  Record initial Session render, catalog availability, tab switch, draft
  restoration, missing-Location UI, and prompt submission. Do not print or save
  the password.

Acceptance:

- The original workspace and live database are unchanged.
- Baseline artifacts identify exact revisions and commands.
- The isolated merge has exactly the intended two parents.
- Every conflicting or overlapping path has a resolution owner.

## Milestone 1 - repository topology and upstream foundation

- [ ] Adopt upstream workspace/package topology, root scripts, Effect version,
      AI/route packages, patches, and build structure needed by retained products.
- [ ] Review every added/removed workspace explicitly. Do not revive upstream
      deploy, Lab, release, signing, container, or update products without a fork
      owner.
- [ ] Adopt upstream generic plugin, Tool, MCP, provider, PTY, terminal, and SDK
      package architecture before reapplying fork overlays.
- [ ] Take upstream native Groq, DeepInfra, Together, Cerebras, Azure, and
      related provider routes; remove stale fork AI-SDK adapters only after their
      native replacements compile and pass provider fixtures.
- [ ] Retain Shuvcode root/package identity and internal `@opencode-ai/*`
      compatibility names. Keep `packages/util/src/global.ts` `app = "opencode"`.
- [ ] Retarget root `dev:live` and the root `AGENTS.md` Live V2 TUI guidance from
      the absent `opencode2` helper to canonical `shuvcode service status` and
      `shuvcode service get password`. Keep the same `dev` TUI storage channel and
      explicit `--server` behavior.
- [ ] Defer `bun.lock` until all package manifests and selected patches are
      final.

Primary paths:

- `package.json`, `bunfig.toml`, `turbo.json`, `patches/`
- `packages/ai/`, `packages/core/package.json`, `packages/plugin/`
- `packages/sdk/`, `packages/tui/`, `packages/client/`

Acceptance:

- Every upstream workspace and patch has an explicit keep/remove decision.
- Runtime dependency direction remains Schema -> Core/Protocol -> Server, with
  Client depending on Schema/Protocol but not Core/Server.
- No upstream deployment or release workflow becomes active.

## Milestone 2 - database, migrations, and persisted compatibility

Resolve migration composition before Session runtime changes.

- [ ] Preserve these fork-only migration IDs exactly:
  - `20260714225613_mobile_pairing`
  - `20260727074609_drop_mobile_pairing`
  - `20260804035517_session_tool_policy` (fork-tip bridge sentinel)
  - `20260812181747_fork_pending_to_inbox`
  - `20260815073846_fork_session_policy`
  - `20260824080928_session_dynamic_tools`
- [ ] Preserve fork adaptations in
      `20260804233008_loose_psylocke` and legacy credential import behavior in
      `20260805200742_import_legacy_credentials`.
- [ ] Add upstream
      `20260823191254_nullable_workspace_binding` without renumbering or deleting
      later fork IDs. Make `WorkspaceTable.binding` nullable and adopt upstream's
      unprovisioned-Workspace creation flow.
- [ ] Keep `DatabaseMigration.bridgeForkTip` before normal migration apply,
      including index drop/recreate and event-preservation behavior.
- [ ] Keep pending-to-inbox conversion transactional and FIFO-preserving.
- [ ] Keep the `session_v2.policy` column and the `session_dynamic_tool` table in
      final Drizzle and generated schema.
- [ ] Compose `packages/core/schema.json` through one controlled snapshot edit.
      This file is the migration generator's baseline and is not regenerated from
      migration files:
  1. start from the fork snapshot so all `session_v2.policy` and
     `session_dynamic_tool` entities remain;
  2. change only the `columns|workspace|binding` entity from
     `"notNull": true` to `false`, anchored on both name `binding` and table
     `workspace`;
  3. set a fresh snapshot UUID and set `prevIds` to the pinned upstream
     snapshot ID `be60f352-8da1-40e1-8d70-dc41121cfbc5`;
  4. preserve DDL entity ordering and every other value.
     This is the only sanctioned manual generated-state composition. Taking either
     parent snapshot wholesale would generate a duplicate migration for the other
     side's already-recorded change.
- [ ] Copy upstream
      `20260823191254_nullable_workspace_binding.ts` verbatim, including
      `foreignKeys: false`. Union-merge upstream Workspace naming and credential
      `label` changes with fork `claude-pro-max` import and policy/idempotency edits.
- [ ] Run `bun run migration --check` from `packages/core` before the mutating
      generator. If it reports ungenerated migrations, the composed snapshot is
      wrong: stop and do not generate. If it reports only stale full schema or
      registry output, run `bun run migration`, then rerun `--check`.
- [ ] Never hand-edit `migration.gen.ts` or `schema.gen.ts`; the generator
      rebuilds them from the 52-file migration union and final Drizzle tables.
- [ ] Add a migration test with a Workspace row and `session_v2.workspace_id`,
      apply nullable binding with foreign keys enabled, and prove both rows and the
      ID survive. Do not add a Session-to-Workspace SQL foreign key.
- [ ] Run the copied real database through the bridge and complete migration;
      compare Session/message/event/inbox/policy/dynamic-tool counts and payloads.

Primary paths:

- `packages/core/src/database/migration.ts`
- `packages/core/src/database/migration/*.ts`
- `packages/core/schema.json` (controlled composition described above)
- `packages/core/src/database/migration.gen.ts` (generated)
- `packages/core/src/database/schema.gen.ts` (generated)
- `packages/core/src/workspace.ts`
- `packages/core/src/workspace/sql.ts`
- `packages/core/test/database-migration.test.ts`
- `packages/core/test/v1-migration.test.ts`
- `packages/core/test/workspace.test.ts`

Acceptance (after the Workspace/Drizzle source reconciliation in this
milestone is complete):

- `bun run migration --check` passes from `packages/core`.
- Empty bootstrap and upgraded databases have the same final schema.
- All historical fork migration IDs remain recorded and idempotent.
- No existing Session, message, event, policy, inbox, or dynamic-tool data is
  lost.

## Milestone 3 - Session admission, execution, and recovery

- [ ] Adopt upstream `SessionInbox.Service`, ID reconciliation before prompt
      preparation, first-admission-wins semantics, and typed lifecycle conflicts.
- [ ] Adopt upstream immediate user-shell scheduling and current steer/queue/
      control-boundary rules.
- [ ] Adopt upstream `runner/step.ts`, retry decision hook, post-output
      continuation, compaction, overflow handling, instruction epochs, and
      move/revert/fork orchestration.
- [ ] Preserve the process-global, Session-ID-based `SessionExecution` and
      Location-scoped runner/model/tools/permissions/filesystem split.
- [ ] Delete or exclude upstream `SessionRestart` wiring from:
  - `packages/core/src/session/execution/restart.ts`
  - `packages/server/src/process.ts`
  - `packages/server/src/fetch.ts`
  - `packages/server/src/routes.ts`
  - `packages/sdk/src/internal/host.ts`
- [ ] Preserve claims on shutdown/process death, release them on completion,
      failure, or user interrupt, and require explicit user input to continue.
- [ ] Rewrite `specs/v2/session.md` to remove startup replay and exact-payload
      pending retry claims. Document inert claims and first-admission-wins.
- [ ] Restore durable pre-stream authorization settlement around upstream
      `runStep`/`context.load`: publish `Step.Started` then `Step.Failed`, map
      `ProviderAuthorizationError` to `provider.auth`, and retain the TUI toast only
      when no transcript row settled.
- [ ] Restore the max-step synthetic user message with retained definitions and
      `toolChoice: "none"`; never append an Anthropic assistant prefill.
- [ ] Preserve max-step, interruption, same-Session join, cross-Session
      concurrency, and no-startup-provider-call tests.

Primary paths:

- `packages/core/src/session.ts`
- `packages/core/src/session/inbox.ts`
- upstream-added `packages/core/src/session/{session,prompt,prompt-node}.ts`
- `packages/core/src/session/execution.ts`
- `packages/core/src/session/run-coordinator.ts`
- `packages/core/src/session/runner/{llm,step,retry,publish-llm-event}.ts`
- `packages/core/src/session/to-session-error.ts`
- `packages/core/test/session-{prompt,execution,run-coordinator,runner,error}.test.ts`
- `packages/server/src/{process,fetch,routes}.ts`
- `specs/v2/session.md`

Acceptance:

- Retrying an admitted user/synthetic ID returns the first admission; cross-
  Session or cross-type reuse fails.
- Prompt preparation hooks do not rerun for an already-admitted ID.
- Boot with an orphaned claim performs zero provider calls and writes no
  continuation message.
- Explicit continuation works without automatic replay.
- Pre-stream auth failure appears durably as `provider.auth` and ACP classifies
  it as auth required.
- One logical Step may retry physically without consuming another agent step.

## Milestone 4 - tools, Code Mode, policy, and dynamic tools

- [ ] Adopt upstream transformable Tool registry and request-captured execution.
- [ ] Reapply strict atomic registration validation, normalized-name collision
      rejection, reserved-name rules, metadata validation/cap, and after-hook
      output separation.
- [ ] Port terminal-publish rollback onto upstream
      `publish-llm-event.ts`.
- [ ] Add a red test that forces `SessionEvent.Tool.Success` and `Tool.Failed`
      publication failure with valid tool content. Then restore a tagged persistence
      error in upstream `runner/step.ts`: fail unsettled tools, fail the assistant,
      fail the drain, and preserve provider-failure precedence.
- [ ] Retain `packages/core/src/decline.ts`, Code Mode limits, the defect tunnel,
      and current docs/tests under `packages/codemode`.
- [ ] Retain immutable Session policy across create/fork narrowing, SQL/events,
      shell bypass protection, tool snapshot filtering, and final dispatch.
- [ ] Retain dynamic-tool definitions, fork inheritance, replace-all behavior,
      Session overlay, HTTP request/reply endpoints, and Client surface.
- [ ] Make initial Session creation/fork plus initial dynamic-tool definitions
      transactional. Add rollback tests for failed tool-definition insertion.
- [ ] Specify pending dynamic calls as process-owner state:
      same-owner reconnect may list calls; shutdown/owner loss cancels them; late
      replies conflict; startup never replays them.
- [ ] Change dynamic-tool `parameters`, invocation `input`, events, and Drizzle
      types from `unknown` to canonical `Schema.Json` where the values cross JSON or
      storage boundaries.

Primary paths:

- `packages/core/src/tool.ts`
- `packages/core/src/decline.ts`
- `packages/core/src/codemode/tool.ts`
- `packages/core/src/session/dynamic-tool.ts`
- `packages/schema/src/{tool,session-policy,session-dynamic-tool,session-event}.ts`
- `packages/protocol/src/groups/session.ts`
- `packages/server/src/handlers/session.ts`
- `packages/codemode/`
- focused Core/Schema/Protocol/Server tests

Acceptance:

- Invalid registration batches are atomic and do not change visible tools.
- Persistence failure cannot produce a completed Step with an unpersisted tool
  outcome.
- Code Mode cannot catch or suppress a user decline, including an un-awaited
  declined call.
- Session policy cannot widen and applies to shell and final dispatch.
- Dynamic definitions survive restart; pending calls do not replay after owner
  loss.
- JSON contract tests reject functions, symbols, and other non-JSON values.

## Milestone 5 - providers and plugin migration

### Generic provider adoption

- [ ] Take upstream provider resolver decomposition, native routes, retry/error
      classification, WebSocket transport, provider catalog updates, and current
      OAuth port fallback.
- [ ] Preserve the Core refresh `KeyedMutex`; re-read the credential under the
      lock and persist rotating refresh tokens before waiters continue.
- [ ] Preserve Anthropic/Gemini tool-schema projections in the native AI
      protocol layer and their fixture-first tests.
- [ ] Fix Antigravity's existing unfiltered `http.request`/`http.response`
      registrations first by passing `{ providerID: Provider.ID.google }`; this
      makes `PluginHooks.has(...)` false for unrelated providers and prevents the
      `model-request.ts` HTTP-middleware branch from disabling OpenAI WebSocket
      transport. Keep the callback's model guard as defence in depth and add a test
      proving an OpenAI request remains WebSocket-eligible. Audit all other
      `http.*` registrations; GitHub Copilot is already provider-filtered at the
      pinned fork.

### Antigravity plugin

- [ ] Create proposed package `packages/antigravity-plugin/` only after the
      generic provider merge is green.
- [ ] Move `google-antigravity.ts`, `google-antigravity-oauth.ts`, and
      `google-antigravity-wire.ts` into the package implementation.
- [ ] Replace private Bus subscription with `ctx.event.subscribe()` filtered to
      `integration.connection.updated` for Google.
- [ ] Import canonical Credential, Integration, and Provider contracts from
      Schema/plugin public entrypoints.
- [ ] Vendor the small OAuth callback success/error page or expose a public
      plugin-owned callback helper; do not import Core `OauthCallbackPage`.
- [ ] Keep current filesystem/network requirements explicit, including Bun
      SQLite import of existing credentials.
- [ ] Port all Antigravity tests. Replace the internal `ProviderPlugins`
      registration assertion with an installed-plugin activation assertion.
- [ ] Keep one narrow Shuvcode default-activation adapter until a configured
      package install proves `/connect` availability. Remove the internal provider
      implementation only after that test passes.

### Claude Pro/Max

- [ ] First preserve the current transport/proxy and make it compile against
      upstream. Ensure shaping occurs exactly once and explicit `baseURL` behavior
      remains unchanged.
- [ ] Build the hook migration behind tests in the current internal
      `AnthropicPlugin`: provider-filtered request and response hooks, per-request
      connection resolution, API-key removal/Bearer injection, body shaping, and a
      boundary-buffering SSE `TransformStream`.
- [ ] Compare every current wire fixture between transport and hook paths:
      system identity, `<env>` normalization/canary, headers, tool names, stream
      restoration, arbitrary chunking, cancellation, errors, setup tokens, and
      refreshed credentials.
- [ ] If and only if parity passes, remove the resolver transport import and
      auth-only loopback proxy. Update `AGENTS.md` to name the plugin hooks as the
      sole shaping owner.
- [ ] If parity fails, retain the current transport/proxy for this sync and
      record the failing case; do not run both paths.

### ChatGPT identity

- [ ] Preserve all current `codex_cli_rs` sites during the sync.
- [ ] Capture real Codex CLI OAuth and inference traffic before relocating the
      behavior. Determine User Agent, OAuth `originator`, request `originator`,
      system identity, and tool-name requirements.
- [ ] After evidence, move inference catalog/header behavior to a provider-
      scoped `model.request` plugin, not `http.request`, so OpenAI WebSockets remain
      eligible. Retain the authorize-URL edit only if capture proves it required.

Primary paths:

- `packages/core/src/model-resolver.ts`
- `packages/core/src/integration.ts`
- `packages/core/src/plugin/provider/{anthropic,anthropic-claude-code,anthropic-claude-code-proxy,google-antigravity,openai}.ts`
- `packages/core/src/session/model-request.ts`
- `packages/ai/src/protocols/` and `packages/ai/src/route/`
- `packages/plugin/src/{effect,promise}/`
- proposed `packages/antigravity-plugin/`

Acceptance:

- Normal Anthropic API key and Vertex traffic receive no subscription shaping.
- Concurrent rotating-token refresh performs exactly one refresh.
- Provider-filtered hooks do not disable OpenAI WebSockets globally.
- Antigravity behavior is implemented in the plugin package and remains
  available through the intended Shuvcode installation path.
- Claude shaping has one owner, selected by the parity gate.
- No provider live call runs in tests unless recording is explicitly enabled.

## Milestone 6 - Schema, Protocol, SDK, and generation

Resolve authored contracts before generated outputs.

- [ ] Adopt upstream public Schema modules and event manifests, preserving fork
      `Auth`, `SessionPolicy`, dynamic tools, Code Mode config, and policy errors.
- [ ] Preserve one canonical Schema identity for every fork contract. Core,
      Client, SDK, and Plugin must re-export the exact Schema values rather than
      wrapping or duplicating them.
- [ ] Keep public `Agent.Color = Schema.String`; restore the contract-hygiene
      assertion against hex-only `ConfigAgent.Color`.
- [ ] Adopt upstream Promise-first `@opencode-ai/sdk` root and explicit Effect
      entrypoints. Update current internal consumers and tests. Do not overload one
      `OpenCode.create` with Promise and Effect semantics.
- [ ] Keep `shuvcode/client` Promise facade, package exports, health/auth/session/
      event APIs, and offline package smoke behavior.
- [ ] Correct SDK/Workerd docs that promise eviction or startup execution
      recovery.
- [ ] Preserve `/api/auth/status`, Session policy, and dynamic-tool endpoints in
      authored Protocol and Server handlers.
- [ ] Run generation in this order:
  1. `bun run migration` from `packages/core`;
  2. `bun run generate` from `packages/protocol`;
  3. `bun run generate` from `packages/client` as required by root guidance;
  4. existing WWW OpenAPI generation/check.
- [ ] Treat
      `packages/codemode/test/fixtures/opencode-v2-openapi.json` as a deliberately
      hand-maintained test fixture, not a generated copy. Leave it unchanged unless
      an operation exercised by `packages/codemode/test/openapi.test.ts` changed;
      then update only the affected fixture operations, document the intentional
      difference from Protocol OpenAPI in the test, and run the Code Mode tests.
- [ ] Never copy Protocol OpenAPI over Code Mode's intentionally distinct
      fixture and never edit Client generated directories directly.

Primary paths:

- `packages/schema/src/`
- `packages/protocol/src/`, `packages/protocol/openapi.json`
- `packages/server/src/handlers/`
- `packages/client/src/{promise,effect}/generated/`
- `packages/sdk/src/`, `packages/sdk/package.json`
- `packages/www/openapi.json`, `packages/www/public/openapi.json`

Acceptance:

- Schema identity tests prove Core, Client, SDK, and Plugin expose the canonical
  values.
- Promise and Effect generated clients expose auth status, policy, JSON-safe
  metadata, and dynamic tools with equivalent wire shapes.
- `bun run check:generated` passes from Protocol and Client with no unexplained
  diff after a second generation run.
- `shuvcode/client` pack/install smoke remains zero-Effect for Promise users.

## Milestone 7 - Server, service lifecycle, and pairing removal

- [ ] Adopt upstream Server/fetch layers, portable election, persistent PTY,
      terminal ticket, and reconnect behavior.
- [ ] Compose the fork authorization-layer service provision and advertised URLs
      into upstream route wiring.
- [ ] Keep `manager: "systemd"` delegation and ownership verification in
      `packages/cli/src/services/service-config.ts` and `service-lifecycle.ts`.
- [ ] Ensure managed start/stop/restart/status never races a detached portable
      server and persistent PTYs are shut down during replacement.
- [ ] Keep `deploy/install-host.sh`, `deploy/systemd/shuvcode.service`, preference
      target/hash checks, and canonical XDG state root.
- [ ] Remove TUI pairing end to end:
  - `packages/tui/src/component/dialog-pair.tsx`
  - `server.pair` and `/pair`/`/web` registration in `packages/tui/src/app.tsx`
  - credential prop threading and keybind/config/docs/tests
  - do not restore `packages/cli/src/commands/handlers/pair.ts`
- [ ] Keep authenticated `GET /api/server` because it returns non-secret URL
      metadata. Add tests proving unauthenticated access is `401` and authenticated
      output contains no password or authorization value.
- [ ] Keep both historical mobile-pairing migrations.
- [ ] Rewrite `docs/shared-service.md`: loopback bind, tailnet HTTPS proxy, one
      shared administrator principal, global rotation, no built-in pairing, and no
      per-device revocation.

Acceptance:

- Managed Desktop/TUI/CLI clients attach to the unit-owned server and do not
  create a second listener.
- Portable installs still start and reconnect without systemd.
- `shuvcode pair`, TUI `/pair`, `/web`, and `server.pair` are absent.
- Server URL metadata never returns credentials.
- Installer `--check` leaves preferences and service state untouched.

## Milestone 8 - TUI, Client, App, and goal plugins

- [ ] Adopt upstream Session tabs/status, persistent terminal pane, resizing,
      reconnect, optimistic compaction, rename animation, diff review, timeline,
      Markdown/Mermaid/LaTeX, and active-Session hydration changes as coherent
      series.
- [ ] Reapply Shuvcode logo, terminal title, splash, resume/error copy, Night Owl
      default, and xAI priority onto upstream structures without restoring old
      control flow.
- [ ] Keep prompt-autocomplete registration as a narrow public TUI plugin seam;
      move `$skill` into a plugin consumer.
- [ ] Preserve catalog HTTP hydration before SSE, one bounded initial handshake
      retry, successful secondary-resource hydration, and workspace-aware missing-
      Location retry. Adapt these to upstream's current connection/error types.
- [ ] Preserve configured-agent warnings and provider-auth toast backstop without
      duplicating durable transcript errors.
- [ ] Apply upstream's environment-sync race fix and retain the fork regression
      test; do not replay the orphan commit implementation if upstream differs.
- [ ] Rebase or transplant the current goal-plugin stack only after the plugin
      API settles. Preserve it as separate changes and exclude `.opencode/goals/**`
      runtime state.
- [ ] Compile and test `packages/goal-plugin` against the final Promise plugin
      interface. Preserve continuation, completion evidence, lifecycle ownership,
      storage, and setup-goal handoff.
- [ ] From `packages/app`, rerun the exact production benchmark baseline and
      investigate any material Session/timeline regression.

Primary paths:

- `packages/client/src/solid/`
- `packages/tui/src/app.tsx`
- `packages/tui/src/component/`
- `packages/tui/src/context/`
- `packages/tui/src/feature-plugins/`
- `packages/app/src/`, `packages/session-ui/src/`
- `packages/goal-plugin/`, `specs/v2/goal-plugin.md`

Acceptance:

- Tabs, drafts, status, terminals, and reconnect match upstream behavior.
- Initial catalog/models can render before the event stream connects.
- One failed secondary Location resource does not discard successful resources
  and identifies the failed resource.
- Environment sync never races optimistic Session creation.
- Goal-plugin tests, typecheck, and dry-run pack pass against final plugin APIs.
- Post-sync App benchmarks have no unexplained material regression.

## Milestone 9 - project identity, filesystem, and diagnostics

- [ ] Adopt upstream deterministic hashed projects for exact markerless
      directories and plugin-declared VCS markers.
- [ ] Keep historical `Project.ID.global` rows and projector stale-ID handling;
      do not rewrite old rows during this sync.
- [ ] Preserve symlink-safe patch move: authorization follows realpath, but move
      deletion removes the lexical source path rather than the resolved target.
- [ ] Preserve `FilesImpl.realpath` semantics across local, exec, and memory
      environments.
- [ ] Preserve loopback-only HTTP attachment ingestion, redirect denial, timeout,
      content-length check, and streaming byte cap.
- [ ] Retain well-known timeouts and port boot-phase telemetry to upstream's new
      Instance/Location seam.
- [ ] Remove `prompt-cache-diagnostics` only after searching the final merged
      tree and confirming no runtime/test/docs consumer.

Acceptance:

- Two distinct markerless directories receive stable distinct project IDs.
- Existing global rows still adopt a real VCS project when resolved.
- Moving an escaping symlink never deletes the target.
- Oversized, redirected, or non-loopback attachments fail closed.
- Unresponsive well-known origins cannot stall Location boot indefinitely.

## Milestone 10 - CI, release controls, identity, and documentation

- [ ] Keep `.github/workflows/publish.yml` and
      `notify-discord.yml`; preserve `Latitudes-Dev/shuvcode`, `integration-v2`,
      trusted publishing, package ownership, exact draft reuse, asset verification,
      and CLI-only release scope.
- [ ] Retarget and re-enable `typecheck.yml` and `test.yml` for
      `integration-v2` only after their current failures pass locally. Fix stale
      `dev`/`v2` conditions and committer identity.
- [ ] Re-enable `shuvbot.yml` only after pinning `shuv1337/shuvbot@v0` to an
      immutable SHA.
- [ ] Decide whether fork WWW deployment is owned. If yes, retarget
      `deploy-www.yml` to `integration-v2`; otherwise remove it.
- [ ] Remove upstream-owned community, close/triage/review, deploy, container,
      GitHub-action release, VS Code publish, Storybook deploy, Nix deploy, stats,
      `docs-update.yml`, `docs-locale-sync.yml`, and upstream GitHub App
      workflows/actions with no fork consumer.
- [ ] Remove `.opencode/plugins/github-triage.ts`,
      `.opencode/plugins/github-pr-search.ts`, their upstream-targeted agents, and
      redundant disabled tool config. They hardcode `anomalyco/opencode` and have no
      retained workflow consumer.
- [ ] Review `.opencode/glossary/` after docs-locale workflow removal. Add
      `.opencode/goals/` to ignore policy and never commit local goal ledgers/state.
- [ ] Rewrite CODEOWNERS, team references, issue-template links, PR template,
      README/install guidance, package metadata, and visible repository URLs for the
      fork. Preserve intentional `opencode` compatibility names only.
- [ ] Keep `PLAN-v2-release-publish.md` aligned with final package topology and
      run only non-mutating preflight/package smoke commands.
- [ ] Update `AGENTS.md` and specs for final Session recovery, Claude shaping
      owner, Antigravity plugin location, dynamic-call no-replay, systemd ownership,
      pairing removal, and generated API boundaries.

Acceptance:

- Default-branch PRs and pushes have working typecheck/test gates.
- No active workflow can write to `anomalyco/opencode` or depend on upstream-only
  secrets/actions.
- Release preflight selects only the approved Shuvcode package/archive set.
- Product docs contain no unsupported pair, upstream installer, Desktop update,
  or retired structured-output claims.

## Milestone 11 - dependency lock and validation matrix

Resolve final manifests and patches, then regenerate `bun.lock` once with Bun
1.3.14. Run tests only from package directories.

### Core data and Session

From `packages/core`:

- `bun run migration --check`
- `bun typecheck`
- `bun test test/database-migration.test.ts test/v1-migration.test.ts`
- focused tests for Session admission, inbox, execution, restart exclusion,
  runner Step/retry, compaction, instructions, move/revert/fork, policy, dynamic
  tools, tool persistence, project identity, Workspace, filesystem/symlink,
  well-known, Claude, Antigravity, OpenAI, credentials, and integration
- full `bun test`

Expected signals:

- Zero provider calls during orphan-claim boot.
- Real copied database retains all counted rows and payloads.
- Tool-publish failure fails assistant and drain.
- No test relies on live provider traffic.

### Contracts and generated surfaces

- `packages/schema`: `bun typecheck`, focused/full `bun test`, `bun run build`
- `packages/protocol`: `bun typecheck`, tests, `bun run check:generated`, build
- `packages/client`: `bun typecheck`, `bun test`, `bun run check:generated`,
  `bun run build:promise`
- `packages/server`: `bun typecheck`, `bun test`, `bun run probe:workerd`, build
- `packages/sdk`: `bun typecheck`, `bun test`, build
- `packages/plugin`: `bun typecheck`, `bun test`, build
- `packages/codemode`: `bun typecheck`, `bun test`, build
- `packages/ai`: `bun typecheck`, provider/protocol tests, build

Expected signals:

- A second generation run produces no diff.
- Schema identities are referentially identical across public re-exports.
- Promise SDK root and Effect entrypoints compile independently.
- Dynamic-tool wire values reject non-JSON input.

### CLI, TUI, App, Desktop, and plugins

- `packages/cli`: `bun typecheck`, focused service/release/updater tests, full
  `bun test`, host Bun/Node builds, package smoke, non-mutating publish preflight
- `packages/tui`: `bun typecheck`, pairing-absence/config tests, full `bun test`
- `packages/app`: typecheck, E2E typecheck, unit/browser tests, selected
  Playwright Session/timeline suites, stability, exact benchmark comparison
- `packages/desktop`: typecheck, manager/service tests, build/package smoke on
  available host target
- `packages/goal-plugin`: `bun typecheck`, `bun test`, `bun run pack:check`
- proposed `packages/antigravity-plugin`: typecheck, tests, dry-run pack
- `packages/session-ui`, `packages/ui`, `packages/www`: package-local
  typecheck/tests/build/generated checks

### Repository checks

- Frozen install from a clean candidate: `bun install --frozen-lockfile`.
- Root `bun run lint`, `bun run lint:effect-patterns`, and
  `bun run lint:effect-simplifications`; compare fingerprints to both parents
  rather than treating baseline findings as new regressions.
- Workflow YAML validation and static search for `anomalyco/opencode`,
  `sst/opencode`, stale runtime `opencode2`, stale `dev`/`v2` branch guards,
  mutable action
  tags, `session.pending`, `SessionRestart`, structured output, and Pair.
  Preserve intentional `opencode` XDG/protocol compatibility strings, but no
  runtime path should depend on the absent `opencode2` binary after the sync.
- `jj diff --check` equivalent formatting/whitespace review and full
  `jj diff --from integration-v2` review.

### Live smoke without restart

- Run the corrected `bun run dev:live` from the isolated workspace against the
  elected service. Do not restart the app or managed server.
- Exercise narrow and wide terminal sizes, tabs/drafts, terminal pane, catalog
  before SSE, missing Location retry, prompt admission, queue/steer, compaction,
  dynamic-tool same-owner reconnect, and provider-auth durable error display.
- Use a scratch standalone server and copied database for migration and startup
  checks. Never point development migrations at the live database.

Acceptance:

- Every mandatory check passes or has a reviewed parent-baseline exception.
- Generated files and lockfile are deterministic.
- App/TUI performance has no unexplained material regression.
- The live managed service and original workspace were not mutated.

## Milestone 12 - marker, review, and rollback

- [ ] Update `.github/last-synced-tag` to
      `106629aa118086be7def6123241a9bf056ba77b6` only after all mandatory gates pass.
- [ ] Verify the final candidate descends from the intended two-parent merge and
      the marker matches the upstream parent.
- [ ] Verify the original workspace still contains all pre-existing goal-plugin
      and goal-state changes and no sync edits.
- [ ] Open the final candidate in Plannotator code review and resolve findings.
- [ ] Do not move `integration-v2`, push, open a PR, release, or deploy without a
      separate explicit authorization.

Rollback before publication:

- Abandon the isolated workspace/change or use `jj undo`; the original workspace
  and `integration-v2` remain unchanged.
- If a provider plugin parity gate fails, retain the current implementation and
  abandon only the migration descendant; never leave both shaping paths active.
- If copied-database migration fails, discard the copy, fix the candidate, and
  restart from the untouched source copy. Never reverse-migrate live data.

Rollback after an explicitly authorized future push but before deployment:

- Move the fork bookmark back only with explicit approval and remote lease
  verification. Prefer a forward revert change when others may have fetched the
  sync.

Deployment rollback remains outside this plan. Preserve the previous
SHA-addressed binary, preferences target/hash, service registration, and
manager-owned unit for any later deployment procedure.

## Done when

- The pinned upstream target is represented by one reviewed two-parent Jujutsu
  merge ancestry.
- Every path in the recomputed overlap file has a documented disposition
  (158 at plan time).
- Approved upstream behavior is adopted without parallel legacy implementations.
- Approved plugin migrations use public seams and pass their parity gates before
  old implementations are removed.
- All retained fork contracts pass focused and package-level validation.
- Real copied fork data upgrades without loss, and orphaned claims perform zero
  startup provider work.
- Built-in pairing and upstream-targeted automation are absent.
- Generated contracts and `bun.lock` are reproducible.
- `.github/last-synced-tag` equals the upstream parent only after validation.
- The original working copy, live service, live database, bookmarks, and remotes
  remain unchanged by plan execution until separately authorized.
