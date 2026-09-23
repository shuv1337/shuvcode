# Merge upstream V2 through `757e565c23`

## Snapshot

- Prepared 2026-09-23 PDT. `upstream/v2` was fetched at `757e565c23f83b3ce3eab64aa6e35cf6ffbde880`.
- Fork base: `integration-v2` at `c283b6a2f6`. The last merged upstream parent is `68b28bdb98` (`8d4fa6044b` is the prior merge commit).
- 34 upstream commits, 248 changed files, approximately 14.6k additions and 1.1k deletions. The upstream release moves from `2.0.14` to `2.0.15`.
- Work on `sync-upstream-sep23` in `/tmp/shuvcode/sync-upstream-sep23`. This branch starts at the clean fork tip. The original detached checkout has unrelated uncommitted TUI edits; leave it alone.
- No merge has been started. `git merge-tree --write-tree --name-only integration-v2 upstream/v2` reports four content conflicts: `bun.lock`, `packages/cli/package.json`, `packages/cli/src/services/updater.ts`, and `packages/cli/test/updater-install.test.ts`.

## Merge decisions

1. Re-fetch `upstream v2` before merging and repeat the merge-tree check if its tip moves. Merge once, preserving upstream ancestry; do not cherry-pick the 34 commits. Keep the fork's identity and bundled plugins, and take upstream behavior otherwise.
2. Set the CLI version to `2.0.15-shuv.1` (upstream's base plus the fork suffix). Retain package and executable `shuvcode`, with no `opencode` or `opencode2` bin. Preserve the release/publish guard and npm dist-tag updater rather than upstream's curl/update-service distribution.
3. Regenerate `bun.lock` with `bun install` after resolving manifests; do not line-merge its conflict markers.
4. Integrate upstream's Windows running-binary retention for package-manager upgrades/uninstalls into the fork updater and its tests. Review `packages/cli/src/services/retained-image.ts`, `packages/cli/src/server-process.ts`, and `packages/cli/src/commands/handlers/uninstall.ts` together. Its upstream implementation uses `opencode-…` retained-link names and `~/.opencode/bin/opencode.exe`; adapt fork-owned identity and paths while keeping the Windows behavior. Preserve the fork's platform-package detection and `shuvcode` / `shuvcode-node` npm targets.
5. Inspect the auto-merges in `packages/cli/test/debug-config.test.ts`, `packages/cli/test/mini.test.ts`, `packages/client/package.json`, `packages/core/package.json`, `packages/tui/package.json`, and `packages/tui/src/util/error.ts` for both upstream behavior and fork-specific fixtures/copy. Upstream changes to CLI debug config must redact credentials.
6. Upstream's TUI transcript-group, mount-budget, anchor, and backfill changes touch session rendering; verify the fork's sidebar, mini UI, theme, and live session behavior. The large `packages/ai` media expansion is primarily upstream-owned. Protocol and Server `HttpApi` have no changed files in this range, so generated client changes should come only from upstream; regenerate from `packages/client` if the merge changes the public API.

## Execution and verification

1. From the prepared worktree, run `git fetch upstream v2`, confirm the SHA, then `git merge --no-ff upstream/v2`. Resolve the four conflicts and audit the listed auto-merges. Do not land or publish the merge until validation succeeds.
2. Run `bun install`, check `git diff --check`, inspect the manifest/bin, updater, retained-image paths, version, and lockfile. Confirm no unresolved conflict markers.
3. Run affected package tests/typechecks from package directories: `packages/cli` (especially updater-install, retained-image, debug-config, mini), `packages/tui` (session transcript and fork sidebar/mini), `packages/core`, and `packages/ai` as appropriate. Run `bun run check` from the repository root. Verify generated client output if required by a public API change.
4. Smoke-test the TUI with `bun run dev:live` from this worktree, including narrow and wide layouts, session history, sidebar and mini model picker. Confirm the fork's `shuvcode` command, default theme, and update behavior still match the identity contract.
5. Review the merge diff against both parents, then report the result. Push, PR, and release require a separate request; never open an upstream PR implicitly.
