# Upstream V2 merge plan — 2026-08-13

## Goal

Merge `upstream/v2` at `642772e2a5eda3e950f4ac4f01cbe215522e4b87` into the fork's
`integration-v2` at `1c47c7b9f3dbd3ff1d5f56c9c4254039ea69fede`, using the recorded
sync marker `283258e95b0a534edac3efeb9762e65134b4634c` as the common semantic
baseline.

The upstream range contains 208 commits and changes 1,502 files
(+182,661/-19,091). The fork changed 303 files after the marker; 117 paths are
changed on both sides, including 60 under `packages/core`. This is an
architecture merge, not a routine conflict-resolution pass.

The merge is complete when upstream's generic Session inbox, safe-boundary
Session movement, App/TUI lifecycle work, provider/runtime improvements,
embedded Web UI, and Workerd profile are integrated without losing the fork's
database bridge, exact prompt retry identity, structured output, Session tool
policy, Code Mode decline behavior, Claude Pro/Max subscription transport,
auth-status API, systemd lifecycle, Shuvcode identity, or release controls.

This plan does not authorize implementation, push, release, or deployment.

## Current state and safety boundary

- `integration-v2`: `1c47c7b9f3dbd3ff1d5f56c9c4254039ea69fede`
- `upstream/v2`: `642772e2a5eda3e950f4ac4f01cbe215522e4b87`
- `.github/last-synced-tag`: `283258e95b0a534edac3efeb9762e65134b4634c`
- Existing user-owned working-copy changes:
  - `deploy/install-host.sh`
  - `docs/shared-service.md`

Do not start the merge in the current dirty workspace. Create an isolated jj
workspace from `integration-v2` so the two user-owned files remain untouched.
The merge candidate must use a short bookmark such as `sync-v2-aug13`.

At execution time, fetch `origin` and `upstream`, verify all three SHAs above,
and refresh this plan if `upstream/v2` is intentionally advanced. Do not silently
expand the range.

## Fixed decisions

### Upstream behavior adopted

- Adopt the generic `SessionInbox` model as the sole current admission model.
  Do not retain parallel current `SessionPending` and `SessionInbox` APIs.
- Adopt safe-boundary Session movement and durable location-switch history.
- Adopt upstream's stacked manual compaction semantics: multiple admitted
  compactions remain distinct inbox items in FIFO order.
- Adopt per-tab prompt drafts, the full Session-tab activity/context-menu
  series, queued-prompt presentation, and the coherent App server/session
  lifecycle rewrite.
- Adopt upstream provider routing, transport-error preservation, parallel
  Anthropic tool-result batching, Copilot fixes, and explicit `.js`/NodeNext
  import conventions.
- Adopt the server fetch entry, external Workspace provider model, client
  service-discovery improvements, embedded Web UI, Core models snapshot,
  OpenTUI 0.5.2, internalized SQLite adapter, and Merman changes.
- Adopt Workerd as a coherent additive runtime profile, including its probe and
  spike validator. Workerd has a durable data plane and a typed unavailable
  execution plane; it must never evaluate fork Node-only Claude modules.
- Retain `packages/drive` as private QA/simulation tooling, including its
  deterministic rendering assets. It is not part of fork publishing.

### Upstream behavior rejected or deferred

- Reject automatic post-crash provider replay from upstream commit
  `7300e7e10ffb`. An orphaned write-ahead claim must not automatically inject a
  synthetic continuation or resume provider work. Post-crash recovery remains a
  separate design task.
- Omit `packages/lab/catalog`, its generated capture corpus, and
  `.github/workflows/deploy-lab-catalog.yml`. They are upstream-owned internal
  deployment surfaces with upstream repository/domain/Cloudflare assumptions.
- Do not import upstream publish triggers, repository guards, package names,
  macOS signing jobs, Desktop publishing, or update artifacts.
- Do not expand fork publishing to `@opencode-ai/core`, Code Mode, Drive, or
  other upstream packages.
- Do not ship upstream's `install` script as a Shuvcode installer. Adapting the
  installer to unscoped `shuvcode` packages and fork dist-tags is separate work.
- Do not add deprecated `/pending` HTTP aliases. The V2 prerelease API changes
  to `/inbox`; compatibility is required for persisted rows and durable events,
  not for the current prerelease HTTP spelling.

### Fork invariants preserved

- CLI/package identity is `shuvcode`; repository identity is
  `Latitudes-Dev/shuvcode`; release branch is `integration-v2`.
- `packages/util/src/global.ts` retains `app = "opencode"` for XDG compatibility,
  including Workerd/global-root adaptations.
- The fork-tip database bridge runs before upstream migrations and preserves
  Session, message, event, policy, and pending/inbox data.
- Exact prompt retry reconciliation proves the original durable admission,
  including delivery mode. A projected message alone is insufficient.
- Structured output, Session tool policy, Code Mode limits/declines, and
  tool-settlement persistence semantics remain first-class contracts.
- Native Claude Pro/Max shaping occurs exactly once in its dedicated route
  transport. The loopback proxy remains auth-only and resolves a fresh token per
  request. Explicit Anthropic `baseURL` configuration still wins.
- OAuth refresh remains single-flight per credential and persists rotating
  refresh tokens before later requests resolve them.
- Fork `/api/auth/status` and generated client types remain public.
- Packaged Desktop and CLI paths respect the elected manager-owned systemd
  service and canonical state root; they must not spawn a competing detached
  server.
- Fork publishing remains manual, repository/branch guarded, ownership-checked,
  trusted-publishing based, and limited by `script/publish-plan.ts`.

## Merge strategy

Use a two-parent jj merge candidate in an isolated workspace rather than
rebasing 208 upstream commits or replaying historical V1 ancestry.

1. Create an isolated workspace from `integration-v2`.
2. Record baseline diagnostics and benchmark artifacts outside the repository.
3. Create the merge change with parents `integration-v2` and the pinned
   `v2@upstream` revision.
4. Inventory every textual conflict and every one of the 117 both-modified
   paths. Classify each as:
   - upstream wholesale;
   - manual semantic composition;
   - fork retained/reapplied;
   - generated/rebuilt;
   - intentionally omitted.
5. Resolve handwritten contracts and runtime code before generated code,
   manifests, lockfiles, docs, or release workflows.
6. Keep milestone changes independently reviewable with jj commits. Do not move
   `integration-v2` until all gates pass.

Never resolve whole directories as “ours” or “theirs.” Never hand-merge generated
OpenAPI/client files or `bun.lock`.

## Milestone 0 — preflight, baseline, and isolated candidate

- [ ] Require the main workspace to contain only the two known user changes.
- [ ] Fetch `origin` and `upstream`; verify the three pinned SHAs and remote
  parity for `integration-v2`.
- [ ] Create an isolated jj workspace under a dedicated narrow path, for example
  `/home/shuv/repos/shuvcode-worktrees/sync-v2-aug13`, based on
  `integration-v2`.
- [ ] Create bookmark `sync-v2-aug13`; do not move `integration-v2`.
- [ ] Capture baseline package diagnostics, existing lint fingerprints, CLI
  artifact sizes, and the currently installed/live service state without
  restarting it.
- [ ] Run the App production benchmark/stability suites and record cold/cached
  latest-message paint and history-prepend behavior. Use the same fixture after
  the merge.
- [ ] Record a live TUI baseline against the elected `opencode2` service using a
  fixed set of long Sessions: initial tail render, tab switch latency, and draft
  restoration.
- [ ] Copy a real pre-delta database to a private scratch location for migration
  acceptance. The fixture must contain fork-tip Session/message/event rows,
  policy, structured-output admission, queued and steered prompts, and a pending
  manual compaction. Never operate migration tests on the live database.
- [ ] Create the two-parent merge change and save both textual conflicts and the
  117-path semantic overlap list.

Acceptance:

- User-owned files are untouched in the original workspace.
- The candidate has exactly the two intended parents.
- Baseline evidence is tied to `1c47c7b9f3db` and stored outside tracked paths.
- No service, branch, remote, marker, or live database has been mutated.

## Milestone 1 — repository topology and selected upstream scope

- [ ] Adopt root workspace/catalog/Turbo changes needed by retained packages.
- [ ] Retain the full `packages/merman` delta and its GitGraph/timeline support.
- [ ] Retain `packages/drive` and its fonts/recording assets as private QA
  tooling; preserve its independent version and exclude it from fork release
  version rewriting.
- [ ] Retain `packages/workerd-spike` only with the complete Workerd runtime
  profile and validator.
- [ ] Omit `packages/lab/catalog`, the lab deployment workflow, catalog workspace
  entries, and lab-specific Turbo tasks.
- [ ] Omit committed `.wrangler/state` files everywhere and ensure `.wrangler/`
  remains ignored.
- [ ] Adopt internalization/deletion of the standalone Effect SQLite workspace
  as upstream does.
- [ ] Resolve root `package.json` without losing fork `ajv`/`zod` additions or
  Shuvcode scripts.
- [ ] Defer `bun.lock` until all selected package manifests and patches are
  final.

Acceptance:

- Every upstream-added workspace is explicitly retained or omitted.
- No upstream-only deployment can run in the fork.
- `script/publish-plan.ts` still selects only fork CLI distributions.

## Milestone 2 — database runtime, bridge, and durable inbox migration

Resolve this before Session runtime code so later tests exercise the real upgrade
shape.

- [ ] Adopt upstream's database runtime split, static migration imports, shared
  SQLite adapters, Workerd/Durable Object SQLite, and Core package build shape.
- [ ] Reinsert `DatabaseMigration.bridgeForkTip` before normal migration
  application in `packages/core/src/database/migration.ts`.
- [ ] Preserve fork migrations in chronological order:
  - `20260714225613_mobile_pairing`
  - `20260727074609_drop_mobile_pairing`
  - `20260804035517_session_tool_policy`
  - fork adaptations in `20260804233008_loose_psylocke`
  - Claude legacy credential mapping in
    `20260805200742_import_legacy_credentials`
- [ ] Regenerate `packages/core/src/database/migration.gen.ts` using upstream's
  static `.js` import form. Do not preserve the old dynamic generator output.
- [ ] Extend upstream migration
  `20260812181746_session_inbox.ts` to transactionally migrate all unconsumed
  `session_pending` rows:
  - `id` → `id`
  - `session_id` → `session_id`
  - `type` → `type`
  - `data` → `payload`
  - missing compaction delivery → `queue`
  - `delivery` → `delivery`
  - `admitted_seq` → `enqueued_seq`
  - `time_created` → `time_created`
- [ ] Preserve FIFO and structured-output payloads; verify copied row counts and
  content before dropping or retiring `session_pending`.
- [ ] Keep legacy `session.input.admitted.1` decodable for exact retries while
  new admissions use `session.inbox.enqueued.1`. Read legacy durable rows
  explicitly if the current Bus manifest omits them.
- [ ] Port the fork V1 event-preservation guard into upstream's
  `database/v1-migration.bun.ts`: clear events only when `session_v2` is empty.
- [ ] Preserve `policy` in the final SQL schema, generated schema, migrations,
  create/fork events, and projections.
- [ ] Do not adopt `resume_attempts`, automatic orphan-claim resume, or the
  unconditional server boot sweep. If parts of upstream's claim schema are
  structurally required, keep them inert and prove no provider work resumes.

Acceptance tests:

- A real pre-delta DB copy upgrades with exact Session/message/event counts.
- Every queued, steered, structured, synthetic, and compaction item remains
  visible in FIFO order through `session_inbox`.
- A promoted retry succeeds only when Session, prompt, and original delivery
  match; conflicting delivery/prompt fails with `PromptConflictError`.
- V1 migration cannot erase pre-existing V2 admission history.
- Managed boot with an orphaned execution claim performs zero provider calls.

## Milestone 3 — canonical Session inbox and fork Session contracts

- [ ] Replace current `SessionPending`/`session-delivery` definitions with
  upstream `SessionInbox` in Schema, Core, Protocol, Server, Client, SDK, App,
  TUI, ACP, plugins, and simulations.
- [ ] Adopt public vocabulary and routes:
  - `pending` → `inbox`
  - `inputID` → `inboxID`
  - `data` → `payload`
  - `Message` → `Item`
  - `/pending/:inputID` → `/inbox/:inboxID`
  - `session.input.*` → `session.inbox.*`
- [ ] Keep one current durable family: `InboxEnqueued`, `InboxDelivered`,
  `InboxCancelled`, and `InboxDeliveryChanged`.
- [ ] Preserve legacy admission schemas only for replay/retry compatibility; do
  not emit duplicate old and new durable events.
- [ ] Adopt upstream promotion ordering: all available steers, then one queued
  input at the idle boundary, then steers that arrived during promotion.
- [ ] Adopt stacked manual compaction rows and update fork coalescing tests.
- [ ] Preserve fork structured output through admission, stored user payload,
  model request/tool, validation, `Structured.Completed`/`Structured.Failed`,
  Assistant message projection, transfer, SDK, App, and TUI rendering.
- [ ] Preserve Session policy through create/fork narrowing, SQL/event state,
  registry snapshot filtering, final provider-visible names, and sanitized
  denials.
- [ ] Preserve `ToolPersistenceError` and terminal event rollback/precedence in
  `session/runner/publish-llm-event.ts` and `runner/llm.ts`.
- [ ] Preserve fork `InvalidRequestError` behavior for `session.shell`.
- [ ] Adopt `interrupt.continue`; TUI interrupt must send `continue: true` so
  durable inbox work is not stranded.

Primary manual paths:

- `packages/schema/src/session-{event,message,inbox}.ts`
- `packages/schema/src/{structured-output,session-policy,tool}.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session/{inbox,context,model-request,projector,sql}.ts`
- `packages/core/src/session/runner/{llm,publish-llm-event,to-llm-message}.ts`
- `packages/core/src/tool.ts`
- `packages/protocol/src/groups/session.ts`

Acceptance:

- No current source emits `session.input.*` or exposes `client.session.pending`.
- Legacy durable logs still replay.
- Structured-output and policy identity remain exact across Schema/Core/SDK.
- Namespaced plugin/simulation tools are filtered by their final exposed name.

## Milestone 4 — safe Session movement, instructions, tools, and execution

- [ ] Adopt upstream `Session.move` as an inbox barrier and
  `runner/llm.ts::runPendingMove` at steer/idle safe boundaries.
- [ ] Adopt transient `Continuation` so a drain reloads the Session and obtains
  the new Location layer after a move.
- [ ] Adopt `SessionEvent.Moved`, `location-switched` messages, previous model/
  agent selections, and instruction-epoch reset on committed movement.
- [ ] Adopt `ProjectDirectories.Event.Resolved` for pre-project Session adoption;
  resolution is not a move and must not reset history/instructions.
- [ ] Adopt upstream instruction/config observation ownership while keeping
  Session-owned instruction history, entries, state, unavailable-source
  behavior, and explicit composition order.
- [ ] Preserve tool setup ordering:
  1. plugin registrations flush;
  2. MCP tools flush;
  3. registry snapshot using agent permissions and Session policy.
- [ ] Adopt registration-time `ToolDefinition.make` validation.
- [ ] Adopt shell-parse skipping only when shell and external-directory
  permissions both allow all; Session policy must still filter the tool.
- [ ] Keep process-local drains and explicit resume semantics. Do not attach
  automatic crash replay to the accepted safe-move continuation mechanism.

Acceptance:

- Moving during active work waits for a safe boundary and the next step uses the
  new Location exactly once.
- Different Sessions remain concurrent; same-Session resumes still join.
- Instruction updates and retained unavailable values survive the merge.
- No orphaned claim causes provider execution after restart.

## Milestone 5 — providers, Claude subscription, auth, and runtime neutrality

- [ ] Adopt upstream model resolver decomposition (`resolveCatalogModel`,
  `prepareProviderModel`, and `prepareProviderSettings`) and native provider
  routing.
- [ ] Reinsert Claude subscription resolution inside the new direct
  `@ai-sdk/anthropic` path after provider runtime preparation.
- [ ] Preserve Bearer auth, Claude Code headers, billing-canary `<env>`
  normalization, tool-name casing/restoration, and the dedicated
  `AnthropicMessages.route.transport` wrapper.
- [ ] Ensure Vertex Anthropic and non-subscription Anthropic never receive Claude
  Code shaping.
- [ ] Preserve the proxy's request-time credential resolution and explicit
  configured-baseURL precedence.
- [ ] Make fork Claude modules Workerd-safe:
  - use Web Crypto or lazy Node crypto only inside OAuth execution;
  - dynamically import `node:http` only when starting the loopback proxy;
  - keep Buffer/body streaming inside that Node-only branch.
- [ ] Preserve credential refresh gates, re-read-under-permit, rotating-token
  persistence, refresh window, and authorization defect handling.
- [ ] Adopt upstream legacy credential file reading but retain Anthropic
  `methodID` mapping to `claude-pro-max`.
- [ ] Preserve fork ChatGPT browser/headless OAuth and Daybreak model additions
  while adopting upstream's lazy `node:http` behavior.
- [ ] Preserve the complete auth-status Schema/Core/Protocol/Server surface.
- [ ] Adopt Anthropic parallel tool-result batching, transport error
  classification/redaction, Vertex routing, provider factory reuse, and Copilot
  fixes.
- [ ] Apply explicit `.js` imports to all fork-created Core provider/auth files.

Acceptance:

- Concurrent Anthropic refresh requests perform exactly one refresh.
- The proxy uses the newest persisted access token on every request.
- Subscription wire fixtures retain identity, canonical environment, headers,
  tool casing, and response restoration.
- Standard API-key Anthropic and Vertex Anthropic remain unshaped.
- Workerd imports/bundles the provider graph without evaluating Node builtins.
- `/api/auth/status` remains in Promise and Effect clients.

## Milestone 6 — Server, service lifecycle, Workerd, and embedded Web UI

- [ ] Adopt `ServerFetch.make`, route replacement layers, external Workspace
  providers, and the Workerd Server/SDK entrypoints.
- [ ] Preserve Node service registration, Basic auth, advertised URLs, and
  systemd ownership around the new server core.
- [ ] Keep the fork managed lifecycle adapter in
  `packages/cli/src/services/service-lifecycle.ts`:
  configured systemd operations delegate to `shuvcode.service`; portable
  installs retain detached startup.
- [ ] Adopt client service version predicates, shared version matching,
  configurable timings, failed-contender stderr capture, and lifecycle test
  speedups. Keep exact-version policy unless separately changed.
- [ ] Preserve one config read per operation and post-start PID-tree ownership
  convergence.
- [ ] Port embedded Web UI assets through:
  - `packages/cli/script/app-assets.ts`
  - `packages/cli/src/app-assets.ts`
  - `packages/cli/src/services/web-ui.ts`
  - Bun and Node build plugins
- [ ] Preserve `binary = "shuvcode"`, fork platform package names, repository
  metadata, dist names, and executable modes.
- [ ] Adopt Core models snapshot generation and delete old CLI `modelsData`
  imports/defines atomically.
- [ ] Preserve Desktop canonical state-root election and manager-aware
  `service start`/`service get password` for packaged/normal startup.
- [ ] Use upstream direct `Service.ensure(... serve --service)` only for an
  explicit isolated development path. It must not compete with a manager-owned
  service.
- [ ] Integrate upstream Desktop version, staged-binary cleanup, WSL metadata,
  and isolated-development support into that ownership model.
- [ ] Resolve the current user-owned installer changes only after the final
  embedded-Web-UI build behavior is known. Decide whether host deploy builds the
  Web UI or explicitly passes `--skip-web-ui`; document and test the choice.

Acceptance:

- Workerd health/SDK boot passes with typed unavailable execution facilities.
- Built Bun and Node CLIs serve the embedded Web UI; non-local missing assets
  fail clearly.
- Packaged Desktop attaches to the existing manager-owned service and canonical
  state root without spawning a second listener.
- Credentials never appear in logs or command output.

## Milestone 7 — TUI, App, Desktop, and visible behavior

- [ ] Take per-tab draft stash and keyed Session mounting as one unit. Restore
  text, structured mentions/attachments, extmarks, and cursor per Session.
- [ ] Take the full Session tab, pulse, marquee, context-menu, plus-button, and
  queued-prompt series together.
- [ ] Preserve Shuvcode branding and Pair behavior in TUI application,
  lifecycle, footer, splash, and dialogs.
- [ ] Preserve structured Assistant projection/render/export branches in TUI
  mini transport, subagent stream, Session route, and row resolution.
- [ ] Reapply fork model-dialog correctness after upstream UI resolution:
  undefined catalog means loading, an empty loaded catalog means no models,
  catalog HTTP sync starts before event-stream handshake, and configured-agent
  warnings wait for a loaded catalog.
- [ ] Take upstream App lifecycle commit `154f298fe9a6` as one coherent unit:
  server Session/reducer/sync, catalog/connection sync, transient inbox/forms,
  composer docks, timeline rows, and routing.
- [ ] Preserve fork server-health preview cancellation, replacement-before-tab
  removal, cross-server tab identity, and structured-output projection.
- [ ] Take Solid cleanup, markdown worker startup, settings redesign, CSS, and
  translations as coherent upstream series.
- [ ] Extend Desktop background CLI tests for manager ownership, canonical state,
  isolated dev, source/downloaded version, WSL, and log secrecy.

Acceptance:

- Distinct drafts survive tab switches with attachments/cursor state.
- Queue, steer, delete, interrupt-and-continue, and structured output render
  correctly.
- App tabs across two servers never issue a request to the wrong origin.
- Server replacement cannot destroy tabs before the new connection is ready.
- Fork model loading/empty behavior remains exact.

## Milestone 8 — contracts, SDKs, plugins, simulation, and generation

Resolve handwritten Schema/Protocol code first, then regenerate all derived
surfaces.

- [ ] Final Schema exports upstream `SessionInbox`, global durable event map,
  previous-selection/location messages, plus fork `StructuredOutput`,
  `SessionPolicy`, `Auth`, Code Mode config, and `PolicyDeniedError`.
- [ ] Final Protocol adopts inbox/move/compact/interrupt changes and preserves
  policy create/fork, prompt output, shell error, and Auth group behavior.
- [ ] Final SDK-next exports upstream `Event`, `Workspace`, `SessionInbox`,
  structured logging, workspace-provider options, Workerd, and fork
  `StructuredOutput`. Treat `OpenCode.layer(options)` as a source-breaking API
  and update call sites/tests.
- [ ] Adopt plugin hook failure typing, SkillDraft CRUD, hierarchical slots,
  OpenTUI peer range, and inbox item types. Keep the TUI context property named
  `pending` for plugin source compatibility while changing its element type.
- [ ] Preserve repository plugin activation coverage and compile representative
  fork plugins against new Slot/Skill/OpenTUI contracts.
- [ ] Move the canonical simulation contract to Protocol and retain Simulation's
  compatibility re-export, tool permission/output schemas, namespacing, and
  structured tool output.
- [ ] Regenerate in this order:
  1. Core migration/schema artifacts and models snapshot;
  2. Protocol OpenAPI;
  3. Client Promise/Effect API and generated clients from `packages/client`;
  4. WWW OpenAPI/theme artifacts;
  5. the distinct Code Mode OpenAPI fixture;
  6. retained Drive/simulation generated fixtures.
- [ ] Never hand-edit generated client directories or copy Protocol OpenAPI over
  the intentionally distinct Code Mode fixture.

Acceptance:

- Generated checks create no diff.
- Promise and Effect clients expose inbox, structured output, policy, auth,
  Workerd-compatible health, move/compact delivery, and interrupt continuation.
- SDK/schema identity tests prove the same canonical values are re-exported.

## Milestone 9 — dependencies, CI, release controls, and documentation

- [ ] Resolve all selected manifests and patches, then regenerate `bun.lock`
  once with Bun 1.3.14. Review removed/added workspaces and patch inventory.
- [ ] Prove a clean `bun install --frozen-lockfile`.
- [ ] Preserve fork `.github/workflows/publish.yml` as authoritative:
  manual dispatch, explicit version, Latitudes/integration-v2 guards, ownership
  preflight, trusted publishing, fork Bun/Node matrices, and no upstream signing
  credentials.
- [ ] Keep `script/publish-plan.ts` limited to CLI distributions and preserve
  `currentRepository`, `publishPlan`, `preflightForkPublish`, package ownership,
  and executable-mode checks.
- [ ] If Drive is retained, exclude its independently versioned manifest from
  release version rewriting and add only the CI dependencies/filters it needs.
- [ ] Fix `test.yml` branch coverage explicitly for `integration-v2`; keep the
  fork's intended platform matrix unless platform support is separately widened.
- [ ] Validate workflow YAML and run publish/package preflight only. Do not
  publish or create a release.
- [ ] Reconcile `AGENTS.md` without accepting upstream's `v2` default-branch
  assumption.
- [ ] Update `docs/shared-service.md` only after final lifecycle/Desktop/build
  behavior is verified; preserve the existing user change and compose around it.
- [ ] Update docs for inbox terminology, API/SDK breaks, Workerd limits,
  embedded Web UI, structured output, Session policy, auth status, and Shuvcode
  commands/URLs.
- [ ] Search touched product surfaces for unintended `opencode2`, upstream npm
  package names, `anomalyco/opencode`, upstream artifacts, `v2` release targets,
  and old `session.pending` vocabulary. Preserve intentional compatibility/XDG
  strings only.

Acceptance:

- Fork release dry-run contains only expected Shuvcode package names.
- CI triggers and artifact names target the fork.
- No workflow depends on upstream-only secrets or deployments.
- Documentation matches tested behavior and preserves user-owned edits.

## Milestone 10 — validation matrix

Run tests only from package directories. Record pass/fail/skip counts and compare
lint fingerprints to both `integration-v2` and `v2@upstream`; baseline-only
diagnostics are not merge regressions.

### Data and Core

From `packages/core`:

- `bun typecheck`
- migration generation/check
- focused tests for database migration, V1 migration, inbox/prompt retry,
  compaction, execution, move, projector, runner, structured output, instruction
  state/discovery, Location, tool registry/persistence/policy, shell, Claude,
  OpenAI/Copilot, credentials/integration, SQLite Bun/Node/Workerd, and service
  boot without crash replay
- full package test suite using an isolated temporary root so ambient `/tmp/.git`
  state cannot falsify repository/watcher tests

### Contracts and runtimes

- `packages/schema`: typecheck, full tests, build
- `packages/protocol`: typecheck, tests, generated check, build
- `packages/client`: typecheck, full tests, generated check, Promise build
- `packages/server`: typecheck; fetch/process/auth/model/health/Workerd tests and
  Workerd probe
- `packages/sdk-next`: typecheck and full tests
- `packages/plugin`: typecheck, tests, build, representative fork plugin compile
- `packages/ai`: typecheck; Anthropic batching and transport-failure suites
- `packages/codemode`: typecheck and tests
- `packages/util`: typecheck and global-root/runtime tests
- `packages/workerd-spike`: test
- `packages/simulation`: typecheck and direct tests
- `packages/drive`: check and tests with required `ffmpeg`
- `packages/merman`: typecheck and tests

### Clients and UX

- `packages/cli`: typecheck; service, Web UI, auth/config, ACP, updater,
  package/release ownership tests; host Bun build; Node build; package smoke;
  executable-mode checks; service smoke
- `packages/tui`: typecheck and full tests, including isolated temp root
- `packages/app`: typecheck, E2E typecheck, unit/browser tests, selected Playwright
  cross-server/settings/request/timeline suites, stability, and benchmark
- `packages/desktop`: typecheck, background CLI/updater/WSL tests, build/package
  smoke on available target platforms
- `packages/session-ui` and `packages/ui`: package-local typecheck/tests/build
- `packages/www`: typecheck, validate, generated check, build

### Cross-cutting acceptance

- Frozen install succeeds from a clean candidate.
- Generation produces no unexplained diff.
- App/TUI post-merge benchmark does not regress materially from the recorded
  baseline; investigate any statistically meaningful change before proceeding.
- A live TUI run via `bun run dev:live` verifies tabs/drafts, structured output,
  queue/steer/delete, interrupt continuation, safe movement, and pre-handshake
  model selection against the elected service.
- A scratch standalone server using the migrated DB copy renders historical
  Sessions and completes a structured-output prompt without modifying live data.
- Desktop attaches to the elected manager-owned service and canonical state root
  without spawning a competing listener.

## Milestone 11 — marker, review, integration, and rollback

- [ ] After every mandatory validation gate passes, update
  `.github/last-synced-tag` to
  `642772e2a5eda3e950f4ac4f01cbe215522e4b87` and include it in the merge
  candidate.
- [ ] Confirm the isolated workspace is clean and the original workspace still
  contains exactly the two preserved user changes.
- [ ] Review the full candidate against this plan and the two merge parents.
- [ ] Use Plannotator for the real code/PR review and approval gate.
- [ ] Only after approval, move `integration-v2` to the candidate, push with jj's
  remote lease protection, and require local bookmark, `@origin`, and GitHub
  remote SHA parity.
- [ ] Release and deployment remain separate explicit actions.

Rollback before push:

- Abandon the isolated candidate or use `jj undo`; the original workspace and
  `integration-v2` remain unchanged.

Rollback after push but before deployment:

- Move `integration-v2` back to recorded pre-merge SHA `1c47c7b9f3db` only with
  explicit approval and a verified remote lease.

Deployment rollback:

- Retain the previous SHA-addressed binary and preference target/hash.
- Restore the previous binary, restart the user systemd unit, and verify the
  same authenticated health and ownership gates.

## Deployment gate (separate authorization required)

Do not deploy merely because the merge is pushed. After explicit deployment
authorization and remote parity, require:

- `shuvcode.service` active and enabled with configured manager `systemd`;
- registered PID descended from the unit's `MainPID`;
- sole listener `127.0.0.1:4096`;
- authenticated `/api/health` and `/api/model` HTTP 200 using username
  `opencode` and the retrieved service password without printing it;
- preserved preferences symlink target and hash;
- no new post-restart warnings/errors;
- previous SHA-addressed binary retained for rollback.

## Done when

- The pinned 208-commit range is represented by one reviewed two-parent merge.
- All 117 overlap paths have an explicit disposition.
- Database migration preserves real fork-tip data and current exact-retry
  semantics.
- Generic inbox, safe movement, structured output, Session policy, Code Mode,
  Claude subscription, auth, service ownership, and Shuvcode release identity
  pass focused and full-package validation.
- Selected Workerd/Drive/Merman scope is coherent; Lab and upstream-only release
  surfaces are absent.
- Generated state and lockfile are reproducible.
- The sync marker equals the pinned upstream SHA only after validation.
- The original user-owned working-copy changes remain intact.
- No push, release, or deployment occurs without its corresponding review and
  authorization boundary.
