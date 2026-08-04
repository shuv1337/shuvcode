# Fork release runbook

Shuvcode releases are manual and fork-only. Dispatch `.github/workflows/publish.yml` in `Latitudes-Dev/shuvcode` with either a version or bump. The workflow builds and publishes CLI npm packages only; it does not publish `@opencode-ai/*`, desktop applications, containers, AUR packages, or `update.opencode.ai` artifacts.

## npm packages

Every release preflights and publishes exactly these 19 public packages:

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
14. `shuvcode-node`
15. `shuvcode-node-linux-arm64`
16. `shuvcode-node-linux-x64`
17. `shuvcode-node-darwin-arm64`
18. `shuvcode-node-windows-arm64`
19. `shuvcode-node-windows-x64`

All 19 names exist publicly under the expected npm maintainer, `kcrommett`. The six `shuvcode-node*` packages were bootstrapped and are currently published at `2.0.0-alpha-8`. The live ownership preflight passed for all 19 packages on 2026-08-03.

The `shuvcode` umbrella also publishes the version-matched, zero-Effect Promise client at `shuvcode/client`. Consumers should spawn the package's `shuvcode` binary with `serve --stdio`, read its first JSON line for the loopback URL, and use `OpenCode.make(...)` from that client surface. The source-only `shuvcode/server-process` entrypoint is not a supported release API.

After every package exists, configure its npm trusted publisher with these exact values:

| Field             | Value           |
| ----------------- | --------------- |
| Provider          | GitHub Actions  |
| Organization      | `Latitudes-Dev` |
| Repository        | `shuvcode`      |
| Workflow filename | `publish.yml`   |
| Environment       | none            |

The workflow has `id-token: write`, runs Node 24 with npm 11.5.1, and does not set `NODE_AUTH_TOKEN`. GitHub release, generated-note, tag, and push operations use the built-in `github.token`; no OPENCODE_APP credential or AI changelog secret is required.

## Preflight and retry behavior

`packages/cli/script/preflight-publish.ts` queries the maintainer response for all 19 package names and validates the complete set before the workflow creates a draft release. The root publisher repeats the authoritative CLI preflight before git detach, package rewrites, installation, or any other mutation. That preflight also requires every one of the exact 12 Bun and five Node platform manifests to match the requested release version. The CLI then prepares both wrappers and runs an offline pack/install smoke test in an empty temporary project. The smoke test checks declared files and exports, imports the Promise client's health/auth/session/event APIs, and verifies that the installed CLI exposes `serve --stdio`. Only then does publication proceed with all 17 platform packages, followed by `shuvcode` and `shuvcode-node`.

The release fails closed when the repository is missing or unknown, a package is missing or unavailable, npm returns malformed ownership data, a package response is omitted or duplicated, or `kcrommett` is not a maintainer. Package-name bootstrap is complete; release readiness now depends on the normal preflight, validation, and publish workflow.

Two behaviors observed during the `2.0.0-alpha-9` release are worth knowing before the next dispatch:

- Artifact upload/download between the build and publish jobs does not preserve file modes, and platform packages declare no `bin` entry, so the mode recorded in the packed tarball is the only thing that makes an installed platform binary executable. Publication repairs modes with a blanket `chmod -R 755`, but the pack/install smoke verification runs earlier; `packages/cli/script/binary-modes.ts` now restores an exact `0o755` on every platform binary during preparation so verification exercises the modes publication ships.
- `prepareForkDraft` looks a release up with `repos/:owner/:repo/releases/tags/:tag`, which never matches a draft because drafts have no tag. A redispatch after a failed publish therefore creates a _second_ draft with the same name instead of reusing the existing one, and the later `gh release edit --draft=false` can undraft either of them. The tag is pushed before the undraft, so the published release still attaches to the correct commit, but the duplicate draft must be deleted by hand. After any retried release, check for duplicates with the release tag substituted in, for example `gh api "repos/Latitudes-Dev/shuvcode/releases" --jq '.[]|select(.name=="v2.0.0-alpha-9")'`.

Version idempotence applies only after the complete preflight succeeds. Redispatching the same explicit version, or the same bump while the latest published version is unchanged, reuses an existing fork draft only when its tag name, title, target commit, and any existing tag target exactly match. A published release, a mismatched draft, or an unrelated tag fails without being overwritten. Reused drafts retain their generated notes because the target release is unchanged. npm retries skip exact package versions that already exist, publish missing platform versions, and defer both umbrellas until all platform versions exist.

npm publication is unavoidably non-transactional: a failure can leave an immutable subset of the 19 versions published. After correcting the cause, rerun the same release input so exact versions are reconciled and only missing packages are published; never choose a new version merely to hide a partial publication.

## Verified release readiness (2026-08-03)

The corrected v2 implementation has passed local code validation. Release dispatch remains blocked by the release-commit and trusted-publisher gates below:

- The live fork ownership preflight passed for all 19 package names with `GH_REPO=Latitudes-Dev/shuvcode bun packages/cli/script/preflight-publish.ts`.
- Schema, Protocol, Core, Server, Client, SDK Next, CLI, and TUI typechecks passed.
- Schema, Protocol, Client, SDK Next, Core, Server, CLI (177 tests), and TUI (598 tests) passed.
- Protocol, client, and website outputs were regenerated with their official generators. Protocol and website `check:generated` passed, all three OpenAPI copies are byte-identical, and repeated client generation left the generated-file hashes unchanged. The client command's final `git diff --exit-code` remains expected to fail while intentional generated changes differ from `HEAD`; that final guard does not indicate nondeterministic generation.
- Session tool policy is schema-backed and persisted, uses an exact deny-by-default allowlist, intersects the active agent permission baseline, and is enforced again at the captured tool-dispatch boundary. Focused and full Core tests verify allowed reads; denied shell, filesystem-write, git/GitHub-write, secret, memory, malformed, and unknown tool calls; parent/fork inheritance and narrowing; rejected widening; prompt-metadata non-escalation; and sanitized `session.policy.denied` tool failures.
- The generated zero-Effect Promise client accepts `policy` in `client.session.create(...)` and `client.session.fork(...)`. Client tests and the offline installed-package smoke verify that the packed `shuvcode/client` surface contains and sends those contracts.
- The generated clients and packed `shuvcode/client` expose `client.auth.status()` behind normal server authorization. It reports only location-scoped, local credential readiness with `verification: "not_performed"`: configured source/type, structural usability, detectable OAuth expiry, stable reason codes, and storage availability. Schema, Core, Protocol, Server, Client, CLI, and SDK Next validation covered absent, stored, expired, malformed/corrupt, environment, and multi-provider states, serialization stripping, and secret leakage; the offline installed-package smoke invoked the packed API without making a provider or model request.
- The complete 12-target Bun CLI build passed with `OPENCODE_VERSION=2.0.0-alpha-9 OPENCODE_RELEASE=1`.
- The zero-Effect Promise client build passed with `bun run build:promise`.
- Offline pack/install smoke tests passed for the host `shuvcode` package, including `shuvcode/client`, and for the host `shuvcode-node-linux-x64` distribution.
- Root `bun run lint` completed without errors. `bun run lint:effect-patterns` still reports pre-existing repository violations, including `packages/core/src/session.ts:52`; scoped review found no new task-specific Effect-pattern violation.
- `git diff --check` passed.

The combined local `preflightForkPublish` cannot validate a complete release outside the workflow because local builds do not contain all non-host Node matrix artifacts. Its local failure was `ENOENT` for the absent `packages/cli/dist/node` matrix content, not a package or ownership validation failure. The release workflow supplies those matrix artifacts before invoking the authoritative preflight.

No full release dry-run was performed because the available release scripts can create releases, tags, commits, or npm publications. No release, tag, commit, push, workflow dispatch, or npm publication was performed during this readiness pass.

Before dispatch, create and review a release commit containing every intended tracked modification plus these 13 currently untracked release inputs:

- `packages/cli/script/package-smoke.ts`
- `packages/client/tsconfig.promise.json`
- `packages/core/src/database/migration/20260804035517_session_tool_policy.ts`
- `packages/core/src/session/structured-output.ts`
- `packages/core/test/session-structured-output.test.ts`
- `packages/protocol/src/groups/auth.ts`
- `packages/schema/src/auth.ts`
- `packages/schema/src/session-policy.ts`
- `packages/schema/src/structured-output.ts`
- `packages/schema/test/auth.test.ts`
- `packages/schema/test/session-policy.test.ts`
- `packages/schema/test/structured-output.test.ts`
- `packages/server/src/handlers/auth.ts`

Do not include `.pi/`, `PLAN-npm-trusted-publishing.md`, `PLAN-upstream-v2-sync.md`, or the generated host smoke-build outputs under `packages/cli/dist-node-smoke/` in that release commit. After the commit is reviewed, independently confirm that all 19 npm packages have the exact trusted-publisher configuration above. Dispatch remains blocked until both gates are complete.

## Release procedure

1. Create the release commit with all required source, configuration, migration, test, generated, packaging, lockfile, and runbook changes; exclude local plans, `.pi/`, and smoke-build outputs.
2. Ensure the intended branch and release commit have passed normal tests and review.
3. Confirm all 19 package pages list `kcrommett` and verify each package authorizes the exact `Latitudes-Dev/shuvcode` + `publish.yml` trusted publisher configuration above.
4. Dispatch `publish.yml` manually with exactly one of `version` or `bump`.
5. Confirm the preflight reports 19 packages before any release or publish step proceeds.
6. Verify all 19 versions and dist-tags on npm, then verify the GitHub tag/release targets the intended commit.
7. If publication stopped after a subset reached npm, resolve the failure and redispatch; never overwrite an immutable npm version or move a published tag.

Local tests must use synthetic npm responses. Do not use tests to call the live registry, publish packages, bootstrap names, or mutate GitHub releases.
