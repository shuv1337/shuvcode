# TODO

## Current merge: upstream tag v1.1.23 into `shuvcode-dev`

### Decisions so far

- Keep fork deletion of `.github/workflows/update-nix-hashes.yml`
- Accept upstream `bun.lock`

### Remaining tasks

- [ ] Resolve conflicts in UI + app files (`packages/app/index.html`, `packages/app/package.json`, `packages/app/src/components/session/session-header.tsx`, `packages/app/src/context/global-sync.tsx`, `packages/app/src/pages/layout.tsx`)
- [ ] Resolve conflicts in console/desktop/package files (`packages/console/*/package.json`, `packages/desktop/*`, `packages/enterprise/package.json`, `packages/function/package.json`, `packages/plugin/package.json`, `packages/sdk/js/package.json`, `packages/slack/package.json`, `packages/ui/package.json`, `packages/util/package.json`, `packages/web/package.json`, `sdks/vscode/package.json`)
- [ ] Resolve conflicts in opencode core (`packages/opencode/package.json`, `packages/opencode/src/cli/cmd/tui/component/logo.tsx`, `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`, `packages/opencode/src/cli/cmd/tui/context/theme.tsx`, `packages/opencode/src/cli/cmd/upgrade.ts`, `packages/opencode/src/installation/index.ts`, `packages/opencode/src/provider/models.ts`, `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/tool/grep.ts`, `packages/opencode/src/util/filesystem.ts`, `packages/opencode/test/provider/amazon-bedrock.test.ts`)
- [ ] Resolve conflicts in other assets (`packages/extensions/zed/extension.toml`, `packages/ui/src/components/message-part.css`, `script/changelog.ts`)
- [ ] `git add` all resolved files
- [ ] `git commit -m "sync: merge upstream v1.1.23 into integration"`
- [ ] Update `.github/last-synced-tag` to `v1.1.23` and commit
- [ ] Push to `origin` (`shuvcode-dev`)
- [ ] Monitor `snapshot.yml` workflow results
