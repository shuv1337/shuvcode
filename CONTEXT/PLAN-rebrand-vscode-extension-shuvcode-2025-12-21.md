# Plan: Rebrand VS Code Extension from opencode to shuvcode

**Created**: 2025-12-21  
**Status**: Implementation Complete (pending manual validation)  
**Scope**: Rebrand the VS Code extension under `sdks/vscode` for the shuvcode fork, and ensure distribution and CLI integration work correctly.

## Goals

1. Rebrand user-facing extension branding from **opencode** → **shuvcode**.
2. Make the extension work **only** with the `shuvcode` CLI (no `opencode` compatibility).
3. Ensure CLI-driven IDE integration installs the correct shuvcode extension ID.
4. Ship `.vsix` artifacts via GitHub Releases with reliable automation.
5. Accept breaking changes as needed to support fork-only IDE integration improvements.

## Non-Goals

- Implementing a full VS Code Marketplace publishing flow.
- Redesigning the IDE integration protocol.
- Large refactors of the CLI’s IDE subsystem beyond what’s needed for the shuvcode-only behavior in this plan.

## Current Repository Reality (Facts)

### VS Code extension

- Extension manifest is currently branded as `opencode`: `sdks/vscode/package.json`.
- Runtime invokes CLI via terminal text: `sdks/vscode/src/extension.ts`.
- The extension uses env vars:
  - `_EXTENSION_OPENCODE_PORT`
  - `OPENCODE_CALLER`
- The extension probes readiness with `GET http://localhost:${port}/app`.
- The extension appends prompts via `POST /tui/append-prompt`.

### CLI / IDE integration

- CLI IDE detection/installation logic checks `process.env["OPENCODE_CALLER"]` and recognizes `vscode` / `vscode-insiders`.
- CLI install command hardcodes installing the upstream extension ID `sst-dev.opencode`.
- The shuvcode wrapper binary exists at `packages/opencode/bin/shuvcode`.

### Release/versioning reality

- Repo has existing `vscode-v0.0.x` tags.
- Extension manifest currently has `version: "1.0.185-1"` (this will be changed to match `vscode-vX.Y.Z`).
- `sdks/vscode/script/release` and `sdks/vscode/script/publish` only understand tags of form `vscode-vX.Y.Z`.
- Packaging currently uses `--skip-license` and there is no `sdks/vscode/LICENSE*`.

## Critical Constraints (Must Respect)

1. **shuvcode-only**: the extension is allowed to break `opencode` compatibility.
2. **CLI + extension must agree on contracts**: env vars, command IDs, and install IDs must be updated together.
3. **Release workflow must be self-sufficient**: first run should create the GitHub Release if missing before uploading assets.
4. **Breaking changes are acceptable but must be explicit**: document any command ID / extension ID / env var changes.

## Key Decisions (Resolve Before Implementation)

### Decision 1: Extension Identifier (Publisher/Name)

**Decision**: use a new fork-specific extension ID: **`latitudes-dev.shuvcode`**.

**Implications**:

- `sdks/vscode/package.json` will use:
  - `publisher`: `latitudes-dev`
  - `name`: `shuvcode`
- CLI install flow must install this extension (not `sst-dev.opencode`).

### Decision 2: Env Var Contract (Caller)

**Decision (per project direction)**: migrate to `SHUVCODE_CALLER` and update the CLI to recognize it.

**Notes**:

- This is a deliberate breaking change: the CLI currently checks only `OPENCODE_CALLER`.
- Update the CLI’s `Ide.alreadyInstalled()` logic and its tests at the same time.

### Decision 3: CLI command invoked by the extension

**Decision (per project direction)**: invoke `shuvcode` only.

**Notes**:

- The extension does not attempt to fall back to `opencode`.
- Error messaging/README must clearly explain how to install `shuvcode` and ensure it is on `PATH`.

### Decision 4: Version/Tag Source of Truth

**Decision**: stick with the existing strategy: `vscode-vX.Y.Z` tags.

**Implications**:

- Make `sdks/vscode/package.json` `version` match the `vscode-v*` tag version (no prerelease suffix).
- Next release should follow the existing tag series (e.g. `vscode-v0.0.13` given current `vscode-v0.0.12`).
- Keep `sdks/vscode/script/release` and `sdks/vscode/script/publish` working with `vscode-vX.Y.Z`.

### Decision 5: Distribution Channel for Installation

**Decision**: GitHub Releases VSIX distribution (Marketplace/OpenVSX later).

**Implications**:

- CLI install flow must download the `.vsix` asset from GitHub Releases and install it via `code --install-extension <file.vsix>`.
- The release workflow must attach a consistently named asset (e.g. `shuvcode-<version>.vsix`).

## Proposed Implementation (Updated)

### Phase 1: Rebrand UI/Docs (Low Risk)

- Update displayName/description/README branding.
- Update repository URLs and issue tracker URLs.
- Make breaking changes explicit in docs (extension ID, command IDs, env vars).

### Phase 2: Runtime Contract Updates (Medium Risk)

- Switch extension env var usage to `SHUVCODE_*` naming.
- Rename VS Code command IDs from `opencode.*` → `shuvcode.*`.
- Add “shuvcode CLI not found” guidance in UX/docs.

### Phase 3: CLI Integration Alignment (High Risk if skipped)

- Update CLI IDE detection to use `SHUVCODE_CALLER`.
- Update CLI IDE install flow to install from GitHub Releases (Decision 5):
  - Resolve the latest release with a tag matching `vscode-vX.Y.Z` from `Latitudes-Dev/shuvcode`.
  - Download the `shuvcode-<version>.vsix` asset to a temp directory.
  - Install via `code --install-extension <downloaded.vsix>`.
  - Handle failure modes explicitly: missing `code` binary, missing release/asset, network errors, and (if repo becomes private) authentication via `GH_TOKEN`.
- Optional: add a `--version`/`--tag` override for deterministic installs (useful for debugging or rollbacks).

### Phase 4: Releases via GitHub Releases

- Package VSIX as an artifact.
- Ensure a GitHub Release exists for the tag.
- Upload VSIX to that Release.

## Detailed Changes (Revised)

### 1) `sdks/vscode/package.json`

**Branding changes**:

- `displayName`: `opencode` → `shuvcode`
- `description`: `opencode for VS Code` → `shuvcode for VS Code`
- `repository.url`: `https://github.com/sst/opencode` → `https://github.com/Latitudes-Dev/shuvcode`

**Identifier changes**:

- `name`: `opencode` → `shuvcode`
- `publisher`: `sst-dev` → `latitudes-dev`
- `version`: align to the `vscode-vX.Y.Z` tag version (drop `1.0.185-1` and continue from existing `vscode-v0.0.x` series).

**Commands**:

- Rename command IDs from `opencode.*` → `shuvcode.*`.
- Update all command titles to say “shuvcode”.
- No alias/compat layer is required (breaking change accepted).

### 2) `sdks/vscode/src/extension.ts`

**Terminal naming**:

- Change `TERMINAL_NAME` to `shuvcode`.

**Env vars (Decision 2)**:

- Change `OPENCODE_CALLER` → `SHUVCODE_CALLER`.
- Change `_EXTENSION_OPENCODE_PORT` → `_EXTENSION_SHUVCODE_PORT`.

**CLI invocation (Decision 3)**:

- Invoke `shuvcode --port ${port}` only.
- If `shuvcode` is not available, fail with a clear message in the terminal/notification and point to installation docs.

**UX improvement**:

- Ensure all disposables are registered (currently `openNewTerminalDisposable` is not added to `context.subscriptions`).

**API contract clarity**:

- Document that the extension expects `GET /app` to indicate server readiness and `POST /tui/append-prompt` to exist.

### 3) `sdks/vscode/README.md`

- Replace references to `opencode.ai` if there is no shuvcode equivalent.
- Update prerequisites to reference `shuvcode` installation.
- Update support URL to `https://github.com/Latitudes-Dev/shuvcode/issues`.
- Add a “CLI installation” section (the extension requires `shuvcode` on `PATH`; no `opencode` fallback).

### 4) `sdks/vscode/script/publish` (Revised scope)

**Decision**: keep `script/publish` focused on packaging the VSIX (no Marketplace/OpenVSX publish).

- `script/publish` should only **build/package** the VSIX to `dist/`.
- GitHub Actions workflow should create a Release (if needed) and upload assets.

Keep `--skip-license` unless a license file is added.

Example packaging step:

```bash
vsce package --no-git-tag-version --no-update-package-json --no-dependencies --skip-license -o "dist/shuvcode-${version}.vsix" "${version}"
```

### 5) `sdks/vscode/script/release`

- Update to create a tag format that matches the chosen version strategy (Decision 4).
- Ensure tag creation is non-interactive and fails clearly.

### 6) Update CLI IDE installer to target shuvcode extension

**File**: `packages/opencode/src/ide/index.ts`

- Replace hardcoded `sst-dev.opencode` with the shuvcode extension identifier (Decision 1).
- If distributing via GitHub Releases (Decision 5B), implement VSIX download+install instead of `--install-extension <id>`.
- Keep it fork-specific; configurability is optional.

## GitHub Workflow (Revised)

**New workflow**: `.github/workflows/release-vscode-extension.yml`

Must:

- Checkout with full history and tags.
- Run `sdks/vscode/script/release` to create and push a tag.
- Build the VSIX.
- Create a GitHub Release if it doesn’t exist.
- Upload VSIX asset.

**Important**:

- Ensure `gh release upload` won’t fail due to missing release.
- Ensure `vsce` is available (either install it or use `npx @vscode/vsce`).

## Testing & Rollout Considerations

### Required acceptance criteria

- Command(s) open/focus terminal correctly (existing terminal detection still works).
- CLI launches successfully with `shuvcode` installed and on `PATH`.
- `POST /tui/append-prompt` works (no regressions).
- Release workflow produces a Release with a downloadable VSIX asset.
- CLI install flow installs the correct shuvcode extension ID.

### Suggested testing strategy

- Update CLI tests to assert `SHUVCODE_CALLER` is recognized (and update/remove `OPENCODE_CALLER` assertions as appropriate).
- Smoke test VSIX installation on at least one platform.

### Migration / rollback

- If extension ID changes, document migration explicitly:
  - uninstall old extension ID
  - install new VSIX
- If command IDs change, document the new command IDs and shortcuts; no alias period is required.

## Updated Implementation Tasks

### Phase 0: Decisions

- [x] Extension ID: `latitudes-dev.shuvcode`
- [x] Env var contract: use `SHUVCODE_CALLER` (breaking change)
- [x] CLI invocation: `shuvcode` only (breaking change)
- [x] Version/tag: keep `vscode-vX.Y.Z`
- [x] Distribution: GitHub Releases VSIX

### Phase 1: Core Rebranding

- [x] Update `sdks/vscode/package.json` branding + identifier + version fields
- [x] Rename command IDs from `opencode.*` → `shuvcode.*`
- [x] Update `sdks/vscode/src/extension.ts` terminal name and shuvcode-only behavior
- [x] Update `sdks/vscode/README.md`

### Phase 2: CLI Integration Alignment

- [x] Update `packages/opencode/src/ide/index.ts` to install the shuvcode extension ID
- [x] Update CLI checks + tests to use `SHUVCODE_CALLER`

### Phase 3: Release Automation

- [x] Update `sdks/vscode/script/release` per chosen version/tag strategy
- [x] Update `sdks/vscode/script/publish` to build/package only (keep `--skip-license`)
- [x] Add `.github/workflows/release-vscode-extension.yml` that creates release + uploads VSIX

### Phase 4: Validation

- [x] Local: `bun install`, `bun run check-types`, `bun run lint`, package VSIX
- [ ] Install VSIX locally and verify shortcuts
- [ ] Trigger workflow and verify Release + VSIX asset

## Risks & Mitigations (Revised)

| Risk                                                  | Likelihood | Impact | Mitigation                                                |
| ----------------------------------------------------- | ---------: | -----: | --------------------------------------------------------- |
| Breaking CLI IDE detection by renaming caller env var |     Medium |   High | Update CLI to use `SHUVCODE_CALLER` + update tests        |
| CLI installs upstream extension ID                    |       High |   High | Update `packages/opencode/src/ide/index.ts` to correct ID |
| Release upload fails due to missing GitHub Release    |     Medium |   High | Create release if missing before upload                   |
| VSIX packaging fails due to license check             |     Medium | Medium | Keep `--skip-license` or add license file                 |
| Users’ keybindings break due to command ID rename     |     Medium | Medium | Accept break; document changes                            |
| CLI install fails without GitHub access/token         |        Low | Medium | Use public Releases; if private, require `GH_TOKEN`       |

## Notes

- This plan intentionally broadens scope slightly to include the **CLI installer fix**; without it, the rebrand will be incomplete (users will keep installing the upstream extension).
- This plan assumes shuvcode-only behavior; compatibility layers are intentionally omitted.
