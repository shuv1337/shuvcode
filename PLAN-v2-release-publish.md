# PLAN: Cut and publish shuvcode v2.0.0-1

## Goal

Publish the first V2 fork release of `shuvcode` to npm under `latest` and to GitHub at `Latitudes-Dev/shuvcode`, without publishing upstream-owned `@opencode-ai/*` packages or invoking the anomalyco release pipeline.

| Release field         | Locked value                                   |
| --------------------- | ---------------------------------------------- |
| Version               | `2.0.0-1`                                      |
| npm dist-tag          | `latest`                                       |
| GitHub tag/release    | `v2.0.0-1`                                     |
| Product source branch | `integration-v2`                               |
| Product source commit | `17e77b56eb1f00210910628a102bbb301adfe603`     |
| Release trigger       | Manual GitHub Actions dispatch                 |
| npm CI authentication | Trusted publishing with OIDC                   |
| GitHub authentication | Built-in `GITHUB_TOKEN` with `contents: write` |
| GitHub binary assets  | Omitted for this cut                           |

The workflow-restoration commit will land after the locked product source commit. The release workflow must therefore accept and check out the explicit product source SHA rather than implicitly building its own workflow commit.

## Release boundary

### Publish exactly these 13 npm packages

The V2 CLI build creates 12 platform packages. `packages/cli/script/publish.ts` then creates and publishes the umbrella package last.

1. `shuvcode`
2. `shuvcode-linux-arm64`
3. `shuvcode-linux-arm64-musl`
4. `shuvcode-linux-x64`
5. `shuvcode-linux-x64-baseline`
6. `shuvcode-linux-x64-musl`
7. `shuvcode-linux-x64-baseline-musl`
8. `shuvcode-darwin-arm64`
9. `shuvcode-darwin-x64`
10. `shuvcode-darwin-x64-baseline`
11. `shuvcode-windows-arm64`
12. `shuvcode-windows-x64`
13. `shuvcode-windows-x64-baseline`

`shuvcode-linux-x64-baseline-musl` is required even though it was missing from the original credential checklist: the build emits it, the npm wrapper selects it for baseline musl hosts, and npm already contains the V1 package.

### Never use these release paths

| Path                            | Reason                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/publish.yml` | Jobs are gated to `github.repository == 'anomalyco/opencode'` and target upstream release surfaces.                           |
| Root `script/publish.ts`        | Publishes schema, protocol, client, CLI, SDK, plugin, and UI packages, including upstream-owned `@opencode-ai/*` names.       |
| `script/release`                | Dispatches the upstream-only `publish.yml`.                                                                                   |
| Root tests                      | Repo guard intentionally rejects tests from the root. Run tests from package directories or through the existing CI workflow. |

The safe build and publish entrypoints are:

- `packages/cli/script/build.ts`
- `packages/cli/script/publish.ts`

## Validated current state

The following facts were rechecked on 2026-07-13 before this plan was revised:

| Check                          | Current result                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `origin/integration-v2`        | `17e77b56eb1f00210910628a102bbb301adfe603`                                                             |
| npm `shuvcode@latest`          | `1.2.27-4`                                                                                             |
| npm owners                     | `kcrommett` is the sole maintainer of all 13 packages                                                  |
| Local `npm whoami`             | `403`; the local credential is unusable                                                                |
| GitHub default branch          | `integration`, the frozen V1 line                                                                      |
| Latest GitHub release          | `v1.2.27-4`; no V2 tag/release exists                                                                  |
| Current product SHA checks     | No GitHub check rollup exists                                                                          |
| Last `integration-v2` test run | Ran against older commit `8d9b20b6d`; unit jobs failed                                                 |
| Local Bun                      | `1.3.11`                                                                                               |
| Required Bun                   | `^1.3.14` from root `packageManager`                                                                   |
| Local npm / Node               | npm `10.9.7`, Node `22.22.2`                                                                           |
| OpenShuv host                  | Active and authenticated `/api/health` reports `2.0.0-1`                                               |
| Blacksmith                     | Successfully ran this repo in March and July 2026; current availability still requires a real dispatch |

GitHub exposes the `NPM_TOKEN` and `PAT_TOKEN` secret names but not their values or validity. This plan does not treat secret age as proof that either credential works.

## Version and channel invariants

`packages/script/src/index.ts` derives the channel from the branch unless an environment override is present. On `integration-v2`, an unconfigured build becomes a preview:

```text
CHANNEL=integration-v2
VERSION=0.0.0-integration-v2-<build-number>
```

The release workflow must set both values explicitly:

```yaml
env:
  OPENCODE_CHANNEL: latest
  OPENCODE_VERSION: 2.0.0-1
```

`packages/script/src/version.ts` and `packages/script/test/version.test.ts` confirm that an unpinned latest release would also calculate `1.2.27-4 -> 2.0.0-1`, but the first cut must remain pinned to avoid registry races and ambiguity.

## Authentication decisions

### npm: trusted publishing is primary

npm recommends trusted publishing for GitHub Actions. It removes the long-lived npm write token from the primary release path and uses a short-lived OIDC identity tied to the repository and workflow filename.

The npm maintainer must configure a trusted publisher separately for all 13 packages with:

| Trusted publisher field | Value             |
| ----------------------- | ----------------- |
| Provider                | GitHub Actions    |
| Organization            | `Latitudes-Dev`   |
| Repository              | `shuvcode`        |
| Workflow filename       | `snapshot.yml`    |
| Environment             | None for this cut |
| Allowed action          | `npm publish`     |

Trusted publishing requires:

- workflow permission `id-token: write`
- npm CLI `>=11.5.1`
- Node `>=22.14.0`
- no `NODE_AUTH_TOKEN` in the OIDC publish job

Primary reference: https://docs.npmjs.com/trusted-publishers/

### npm: granular token is local fallback only

If a local publish fallback must remain available, `kcrommett` may create a granular token with:

- read/write package access
- bypass 2FA enabled for automated publishing
- all 13 packages included
- the shortest practical expiration

Store that token locally in `~/.npmrc`. Do not add it to GitHub unless OIDC is unavailable and the plan is deliberately switched to token-based CI.

Legacy or “automation” tokens are not an option; npm supports granular access tokens and has removed legacy access tokens. References:

- https://docs.npmjs.com/about-access-tokens/
- https://docs.npmjs.com/using-private-packages-in-a-ci-cd-workflow/

### GitHub: use the built-in token

The release job only needs to read the source and create a tag/release in the same repository. Use:

```yaml
permissions:
  contents: write
  id-token: write
```

Set `GH_TOKEN: ${{ github.token }}` for `gh`. Do not require `PAT_TOKEN` for checkout, tagging, or release creation.

A PAT is only justified later if an event created by the release must trigger another workflow. Discord notification is out of scope for this cut, so it does not justify PAT rotation now.

Reference: https://docs.github.com/en/actions/tutorials/authenticate-with-github_token

## Workflow topology decision

The first V2 release is manual-only.

Do not add `workflow_run` publishing yet because:

1. GitHub requires the triggered workflow file to exist on the default branch.
2. The default branch is the frozen V1 `integration` line.
3. The default-branch `snapshot.yml` still describes the V1 `integration` release.
4. Current `.github/workflows/test.yml` does not push-trigger on `integration-v2`.
5. A privileged `workflow_run` publish would add avoidable default-branch and untrusted-checkout complexity.

The existing `snapshot.yml` registration on default branch `integration` must remain until the default branch or workflow topology is deliberately migrated. Once the V2 workflow is restored on `integration-v2`, manual dispatch with `--ref integration-v2` can select that branch’s workflow implementation.

References:

- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow-dispatch
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow-run

## Implementation order

### Milestone 0: Human npm authorization

#### 0.1 Configure trusted publishing

- [ ] Sign in to npm as `kcrommett`, the current sole maintainer.
- [ ] Configure the `snapshot.yml` trusted publisher on each of the 13 packages listed in this plan.
- [ ] Select `npm publish` as the allowed action.
- [ ] Do not configure an npm environment name for this cut.
- [ ] Record completion without copying tokens or sensitive npm account data into the repo.

**Done when:** all 13 npm package settings pages authorize `Latitudes-Dev/shuvcode` + `snapshot.yml` for `npm publish`.

#### 0.2 Optional local fallback credential

- [ ] Decide whether a local emergency publish path is actually required.
- [ ] If required, create a granular read/write token with bypass 2FA for all 13 packages.
- [ ] Store it in local `~/.npmrc`, never in the plan or repository.
- [ ] Verify identity:

  ```bash
  npm whoami
  # expected: kcrommett
  ```

- [ ] Verify the account still owns all packages:

  ```bash
  npm view shuvcode maintainers --json
  npm view shuvcode-linux-x64-baseline-musl maintainers --json
  ```

`npm publish --dry-run` validates packing behavior; it is not accepted as definitive proof that a real registry publish will be authorized.

**Done when:** OIDC is configured; local token work is complete only if the fallback was explicitly retained.

### Milestone 1: Restore a guarded manual release workflow

Restore `.github/workflows/snapshot.yml` on `integration-v2`. Use historical content only as reference:

- `git show 8d9b20b6d:.github/workflows/snapshot.yml`
- `git show origin/integration:.github/workflows/snapshot.yml`

The restored workflow must not copy their V1 or incomplete V2 behavior blindly.

#### 1.1 Trigger and inputs

- [ ] Use `workflow_dispatch` only.
- [ ] Add required string input `release_sha`.
- [ ] Add required string input `confirm_version`.
- [ ] Add boolean input `publish`, defaulting to `false`.
- [ ] Use a fixed concurrency group and never cancel an active release:

  ```yaml
  concurrency:
    group: shuvcode-v2-release
    cancel-in-progress: false
  ```

- [ ] Reject the run unless:
  - `release_sha == 17e77b56eb1f00210910628a102bbb301adfe603`
  - `confirm_version == 2.0.0-1`
  - the resolved commit is contained by `origin/integration-v2`

The fixed SHA checks are intentional for the first cut. Subsequent releases must revise the plan/workflow rather than silently accepting a new commit.

#### 1.2 Runner and checkout

- [ ] Use `blacksmith-4vcpu-ubuntu-2404` initially.
- [ ] Document `ubuntu-latest` as a manual edit-and-redispatch fallback if the Blacksmith job cannot acquire a runner.
- [ ] Checkout `inputs.release_sha`, not the workflow run SHA.
- [ ] Use `fetch-depth: 0` and fetch tags.
- [ ] Use the built-in GitHub token; do not pass `PAT_TOKEN` to checkout.
- [ ] Verify that product code after the locked SHA differs from the workflow-prep branch only in approved release-plan/workflow/docs paths before proceeding.

#### 1.3 Toolchain and permissions

- [ ] Grant only:

  ```yaml
  permissions:
    contents: write
    id-token: write
  ```

- [ ] Run `.github/actions/setup-bun`; it pins Bun from root `packageManager` and sets up Node 24.
- [ ] Install or select npm 11 and verify requirements:

  ```bash
  npm install --global npm@11
  node --version
  npm --version
  # Node must be >=22.14.0; npm must be >=11.5.1
  ```

- [ ] Set:

  ```yaml
  env:
    OPENCODE_CHANNEL: latest
    OPENCODE_VERSION: 2.0.0-1
    GH_REPO: Latitudes-Dev/shuvcode
    GH_TOKEN: ${{ github.token }}
  ```

- [ ] Do not set `NODE_AUTH_TOKEN` on the OIDC path.

#### 1.4 Pre-publish registry guard

- [ ] Before building, fail if any of these already exist:
  - npm `shuvcode@2.0.0-1`
  - Git tag `v2.0.0-1`
  - GitHub release `v2.0.0-1`
- [ ] Print current `shuvcode` dist-tags and the locked source SHA.
- [ ] Fail if npm `latest` is no longer `1.2.27-4`; a changed registry baseline requires a new review.

#### 1.5 Build and validate all artifacts

- [ ] Run only the CLI build:

  ```bash
  bun ./packages/cli/script/build.ts
  ```

- [ ] Verify `packages/cli/dist` contains exactly the 12 expected platform package directories.
- [ ] Verify every platform `package.json` has:
  - a package name from the locked list
  - version `2.0.0-1`
  - repository `git+https://github.com/Latitudes-Dev/shuvcode.git`
  - expected `os` and `cpu` metadata
- [ ] Run `bun pm pack` or `npm pack --dry-run` on representative glibc, musl, macOS, and Windows packages.
- [ ] Reconfirm from `packages/cli/script/publish.ts` that the umbrella manifest derives its optional dependencies from the scanned platform manifests and that the umbrella publish remains after all platform publishes.

The workflow’s `publish=false` run stops after platform build/package checks and uploads no GitHub release assets. It must not invoke `packages/cli/script/publish.ts`, because that script has no non-publishing mode.

#### 1.6 Publish and create the exact release

Only when `inputs.publish == true`:

- [ ] Run only:

  ```bash
  bun ./packages/cli/script/publish.ts
  ```

- [ ] Confirm logs show platform packages first and umbrella `shuvcode` last.
- [ ] Verify all 12 platform packages now exist at `2.0.0-1` before creating the GitHub release.
- [ ] Generate manual V2 release notes that mention:
  - first V2 fork release
  - install command `npm i -g shuvcode@latest`
  - binary name `shuvcode`
  - source commit
- [ ] Create the tag and release against the explicit source SHA:

  ```bash
  gh release create v2.0.0-1 \
    --repo Latitudes-Dev/shuvcode \
    --target "$RELEASE_SHA" \
    --title "v2.0.0-1" \
    --notes-file "$RELEASE_NOTES"
  ```

- [ ] Do not create the release before specifying the target.
- [ ] Do not separately push a conflicting local tag after `gh release create`.
- [ ] Do not upload raw `dist/*/bin/*` files. Their repeated `shuvcode` and `shuvcode.exe` basenames collide as GitHub release assets.

GitHub binary assets are omitted because npm platform packages are the supported distribution surface for this cut. A later release may attach uniquely named archives such as `shuvcode-linux-x64.tar.gz` and `shuvcode-windows-x64.zip`.

**Done when:** the workflow supports a safe build-only dispatch and a separately confirmed publish dispatch, both pinned to the locked source and version.

### Milestone 2: Local plan validation, no registry writes

#### 2.1 Upgrade the local Bun toolchain

- [ ] Upgrade local Bun from `1.3.11` to a version satisfying `^1.3.14`.
- [ ] Verify the script import no longer fails:

  ```bash
  bun --version
  cd packages/script
  bun -e 'await import("./src/index.ts")'
  ```

- [ ] Run the focused version tests from their package directory:

  ```bash
  cd packages/script
  bun test test/version.test.ts
  ```

#### 2.2 Single-platform packaging smoke

From repo root:

```bash
export OPENCODE_CHANNEL=latest
export OPENCODE_VERSION=2.0.0-1

bun ./packages/cli/script/build.ts --single
cat packages/cli/dist/shuvcode-linux-x64/package.json

cd packages/cli/dist/shuvcode-linux-x64
bun pm pack
npm publish *.tgz --dry-run --access public --tag latest
```

- [ ] Build succeeds for the current platform.
- [ ] Manifest name and version are correct.
- [ ] Tarball contents contain the compiled `bin/shuvcode` and expected metadata.
- [ ] Treat the dry run as package-shape evidence only, not registry authorization evidence.

#### 2.3 Full build-only CI dispatch

After the workflow commit is on `origin/integration-v2`:

```bash
gh workflow run snapshot.yml \
  --ref integration-v2 \
  --repo Latitudes-Dev/shuvcode \
  -f release_sha=17e77b56eb1f00210910628a102bbb301adfe603 \
  -f confirm_version=2.0.0-1 \
  -f publish=false
```

- [ ] Record the exact run ID.
- [ ] Require successful checkout, toolchain, registry guard, full cross-build, and manifest/package validation.
- [ ] If Blacksmith cannot acquire the job, change the runner to `ubuntu-latest`, commit the change, and repeat the build-only dispatch.

**Done when:** local single-platform packaging and CI full-build validation both pass without registry or release writes.

### Milestone 3: Current-tree test gate

The locked product commit itself has no GitHub check rollup. Before publishing, validate the release-prep branch that contains the same product code plus approved workflow/plan/docs changes.

- [ ] Verify the only changes after the locked product commit are release workflow, plan, release notes, or documentation changes:

  ```bash
  git diff --name-only 17e77b56eb1f00210910628a102bbb301adfe603..origin/integration-v2
  ```

- [ ] Manually dispatch the existing test workflow:

  ```bash
  gh workflow run test.yml \
    --ref integration-v2 \
    --repo Latitudes-Dev/shuvcode
  ```

- [ ] Record the run ID and tested commit.
- [ ] Require all current unit, generated-client, and e2e jobs to pass.
- [ ] Do not accept the older failed `8d9b20b6d` run as evidence for the release.
- [ ] If CI fails, diagnose and resolve the failure before publishing; do not bypass checks or hooks.

**Done when:** current `integration-v2` release-prep HEAD is green and its product-code diff from the locked release SHA is empty.

### Milestone 4: Real publish

#### 4.1 Final preflight

- [ ] Reconfirm npm `latest` is still `1.2.27-4`.
- [ ] Reconfirm `shuvcode@2.0.0-1` does not exist.
- [ ] Reconfirm `v2.0.0-1` does not exist as a tag or GitHub release.
- [ ] Reconfirm the build-only workflow run passed.
- [ ] Reconfirm the current-tree test run passed.
- [ ] Reconfirm trusted publishing is configured for all 13 packages.
- [ ] Review and finalize release notes.

#### 4.2 Publish through CI

```bash
gh workflow run snapshot.yml \
  --ref integration-v2 \
  --repo Latitudes-Dev/shuvcode \
  -f release_sha=17e77b56eb1f00210910628a102bbb301adfe603 \
  -f confirm_version=2.0.0-1 \
  -f publish=true
```

- [ ] Capture the exact run ID instead of watching an arbitrary recent run.
- [ ] Watch that run to completion.
- [ ] Stop on any unexpected attempt to publish `@opencode-ai/*`.
- [ ] Accept `already published` only when retrying after a confirmed partial platform-package publish.
- [ ] Never force-push or move `v2.0.0-1`.

#### 4.3 Local fallback, only if CI publishing is unavailable

The local fallback requires the optional granular token from Milestone 0 and must use the same locked SHA/version.

```bash
export OPENCODE_CHANNEL=latest
export OPENCODE_VERSION=2.0.0-1

bun ./packages/cli/script/build.ts
bun ./packages/cli/script/publish.ts
```

Then create the release with the explicit target:

```bash
gh release create v2.0.0-1 \
  --repo Latitudes-Dev/shuvcode \
  --target 17e77b56eb1f00210910628a102bbb301adfe603 \
  --title "v2.0.0-1" \
  --notes-file RELEASE-NOTES-2.0.0-1.md
```

- [ ] Do not use the local fallback merely because CI takes longer than expected.
- [ ] If CI partially published platform packages, inspect registry state first; the publish script skips versions that already exist and can safely retry missing packages before the umbrella.

**Done when:** npm and GitHub both contain the intended immutable release from the locked source SHA.

### Milestone 5: Verification

#### 5.1 Verify all npm packages

```bash
npm view shuvcode version
npm view shuvcode dist-tags --json
npm view shuvcode optionalDependencies --json
npm view shuvcode-linux-x64-baseline-musl version
```

- [ ] `shuvcode` reports `2.0.0-1`.
- [ ] `latest` points to `2.0.0-1`.
- [ ] The umbrella contains exactly 12 optional platform dependencies at `2.0.0-1`.
- [ ] Every package in the locked 13-package list exists at `2.0.0-1`.
- [ ] No `@opencode-ai/*` package version was published by this workflow.

#### 5.2 Verify GitHub tag and release

```bash
gh release view v2.0.0-1 \
  --repo Latitudes-Dev/shuvcode \
  --json tagName,isDraft,isPrerelease,targetCommitish,url

gh api repos/Latitudes-Dev/shuvcode/git/ref/tags/v2.0.0-1
```

- [ ] Release is published, not draft, and not prerelease.
- [ ] Tag resolves to `17e77b56eb1f00210910628a102bbb301adfe603`.
- [ ] Release notes contain the install command, binary name, and source SHA.
- [ ] No duplicate or raw binary assets were attached.

#### 5.3 Install into an isolated prefix

Do not overwrite the working global installation during the first smoke:

```bash
tmp="$(mktemp -d)"
npm install --prefix "$tmp" shuvcode@2.0.0-1
"$tmp/node_modules/.bin/shuvcode" --version
```

- [ ] Installation selects a compatible platform package.
- [ ] Binary reports `shuvcode v2.0.0-1`.
- [ ] Basic non-mutating CLI help/version commands run.

#### 5.4 Verify the existing wrapper and shared host

The shared host already reports `2.0.0-1`. Treat it as a post-release consistency check, not a reason to restart a healthy service.

```bash
readlink -f "$(command -v shuvcode)"
shuvcode --version
systemctl --user status shuvcode.service --no-pager

set -a
source ~/.config/openshuv/shuvcode.env
set +a
curl -fsS \
  -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  http://<tailscale-ip>:4096/api/health
```

- [ ] Wrapper resolves to a real binary and reports `2.0.0-1`.
- [ ] Authenticated health remains 200 and reports `2.0.0-1`.
- [ ] Local TUI attaches without `Failed to start server`.
- [ ] Do not restart the unit or rewrite registration files unless the installed binary or authentication state is intentionally changed.

**Done when:** registry, tag, release, isolated install, wrapper, and shared-server checks all agree on `2.0.0-1`.

### Milestone 6: Post-release follow-ups

These are separate from the first release and must not delay it after all success criteria pass.

- [ ] Document the fork release procedure in repo guidance so future operators never use root `script/publish.ts` or upstream `publish.yml`.
- [ ] Decide whether future `2.0.0-N` releases should remain manually pinned or use `nextForkVersion` against npm latest.
- [ ] Decide whether `integration-v2` should eventually become the default branch or whether a release workflow should be installed on the existing default branch.
- [ ] Only after that topology decision, reconsider automatic `workflow_run` publishing.
- [ ] Keep the default-branch `snapshot.yml` registration until manual V2 dispatch no longer depends on it.
- [ ] If GitHub binary assets become desirable, add uniquely named archives and checksums rather than raw repeated basenames.
- [ ] If Discord notification is restored, decide whether to use a PAT/GitHub App so the release event can trigger downstream automation; keep it non-blocking.
- [ ] Revisit fork-scoped publication of shared SDK packages separately; never publish upstream-owned package names.
- [ ] Source-control the OpenShuv systemd unit in its owning dotfiles/setup repository if it must survive reprovisioning.

## Failure and retry behavior

`packages/cli/script/publish.ts` publishes platform packages concurrently, waits for them, and publishes the umbrella package last. Before each publish it checks whether that exact package version already exists.

Consequences:

- A failed run can leave a subset of platform packages published.
- npm versions are immutable; there is no rollback of an already published package version.
- A retry may safely skip packages already at `2.0.0-1` and publish missing platform packages.
- The umbrella should not publish until every platform publish in the current run succeeds.
- If a bad umbrella package ships, do not move or overwrite `2.0.0-1`; prepare `2.0.0-2` under a new reviewed plan.

## Risk register

| Risk                                              | Impact                                          | Mitigation                                                                          |
| ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Trusted publisher missing on one package          | Partial platform publish                        | Configure and check all 13 package settings before the real dispatch.               |
| Missing baseline-musl package authorization       | Linux baseline musl installs fail               | Keep `shuvcode-linux-x64-baseline-musl` in every package list and validation.       |
| Missing channel/version env                       | Preview version published under wrong tag       | Pin both `OPENCODE_CHANNEL` and `OPENCODE_VERSION`.                                 |
| Workflow builds its own prep commit               | Tag source differs from approved product source | Require `release_sha` and checkout the locked SHA explicitly.                       |
| GitHub release tags default branch                | V2 tag points to frozen V1                      | Always pass `--target "$RELEASE_SHA"`.                                              |
| Raw asset basename collisions                     | GitHub release creation/upload fails            | Omit assets for this cut; later archive with unique platform names.                 |
| No current CI evidence                            | Broken release reaches npm                      | Require a build-only dispatch and a green manual test run before publishing.        |
| Blacksmith unavailable                            | Job remains queued                              | Commit a runner change to `ubuntu-latest` and repeat build-only validation.         |
| Concurrent real dispatches                        | Duplicate/partial registry work                 | Fixed concurrency group, `cancel-in-progress: false`, explicit confirmation inputs. |
| Partial platform publish                          | Registry temporarily inconsistent               | Inspect package state and retry; umbrella remains last.                             |
| Force-moving a tag                                | Release history corruption                      | Never move `v2.0.0-1`; issue `2.0.0-2` for shipped defects.                         |
| Restarting healthy OpenShuv service unnecessarily | Avoidable operator outage                       | Verify first; restart only after an intentional binary/auth change.                 |

## Key file references

| Path                                   | Role                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| `packages/script/src/index.ts`         | Channel/version resolution and Bun version guard         |
| `packages/script/src/version.ts`       | Fork `2.0.0-N` counter                                   |
| `packages/script/test/version.test.ts` | Focused version behavior tests                           |
| `packages/cli/script/build.ts`         | Produces 12 platform package directories                 |
| `packages/cli/script/publish.ts`       | Creates/publishes platform packages and umbrella package |
| `packages/cli/bin/shuvcode.cjs`        | Resolves platform packages, including baseline-musl      |
| `.github/actions/setup-bun/action.yml` | Pins Bun from root metadata and installs dependencies    |
| `.github/workflows/test.yml`           | Existing manual current-tree test gate                   |
| `.github/workflows/snapshot.yml`       | Missing V2 manual release workflow to restore            |
| `.github/workflows/publish.yml`        | Upstream-only workflow; excluded                         |
| `script/publish.ts`                    | Multi-package upstream publisher; excluded               |
| `script/version.ts`                    | Reference for creating a release with an explicit target |
| `script/release`                       | Upstream publish dispatcher; excluded                    |
| `.github/last-synced-tag`              | V2 upstream sync commit marker, not a release tag        |
| `AGENTS.md`                            | Fork boundaries, branch rules, hooks, and test guidance  |

Historical references:

- `8d9b20b6d`: earlier V2 snapshot/Discord workflow draft
- `655a3d6aa`: V2 fork release-readiness changes
- `17e77b56e`: locked first-release product source and V2 counter
- `origin/integration:.github/workflows/snapshot.yml`: last working V1 publish workflow

## Out of scope

- Publishing desktop, app, mobile, container, or package-manager artifacts
- Publishing any upstream-owned `@opencode-ai/*` package
- Uploading raw GitHub binary assets
- Automatic publishing after `test`
- Moving the repository default branch
- Restoring Discord notifications
- Upstream synchronization or merge work
- Changing `packages/core/src/global.ts` from `app = "opencode"`
- Transferring npm package ownership away from `kcrommett`
- Restarting or rewriting the healthy OpenShuv service without an intentional deployment change

## Success criteria

1. All 13 npm packages exist at `2.0.0-1`.
2. `npm view shuvcode dist-tags.latest` resolves to `2.0.0-1`.
3. The umbrella package has exactly 12 optional platform dependencies at `2.0.0-1`.
4. GitHub tag `v2.0.0-1` resolves to `17e77b56eb1f00210910628a102bbb301adfe603`.
5. GitHub release `v2.0.0-1` is published, non-draft, and contains correct V2 notes.
6. An isolated `npm install shuvcode@2.0.0-1` runs `shuvcode v2.0.0-1`.
7. No new `@opencode-ai/*` version was published by this effort.
8. The existing wrapper and authenticated shared-server health remain functional at `2.0.0-1`.
9. The release can be retried safely after a partial platform-package publish without moving the tag or republishing immutable versions.
