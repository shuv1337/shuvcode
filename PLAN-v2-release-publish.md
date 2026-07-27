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

The first 13 names already exist under the expected npm maintainer, `kcrommett`. The six `shuvcode-node*` names are currently unowned and are a human prerequisite: `kcrommett` must manually bootstrap each package using a short-lived granular npm token. Do not use the release workflow to bootstrap names.

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

`packages/cli/script/preflight-publish.ts` queries the maintainer response for all 19 package names and validates the complete set before the workflow creates a draft release. The root publisher repeats the authoritative CLI preflight before git detach, package rewrites, installation, or any other mutation. That preflight also requires every one of the exact 12 Bun and five Node platform manifests to match the requested release version. The CLI then prepares both wrappers, publishes all 17 platform packages, and only after every platform succeeds publishes `shuvcode` followed by `shuvcode-node`.

The release fails closed when the repository is missing or unknown, a package is missing or unavailable, npm returns malformed ownership data, a package response is omitted or duplicated, or `kcrommett` is not a maintainer. The six Node names therefore block every release until the manual bootstrap is complete.

Version idempotence applies only after the complete preflight succeeds. Redispatching the same explicit version, or the same bump while the latest published version is unchanged, reuses an existing fork draft only when its tag name, title, target commit, and any existing tag target exactly match. A published release, a mismatched draft, or an unrelated tag fails without being overwritten. Reused drafts retain their generated notes because the target release is unchanged. npm retries skip exact package versions that already exist, publish missing platform versions, and defer both umbrellas until all platform versions exist.

npm publication is unavoidably non-transactional: a failure can leave an immutable subset of the 19 versions published. After correcting the cause, rerun the same release input so exact versions are reconciled and only missing packages are published; never choose a new version merely to hide a partial publication.

## Release procedure

1. Confirm all 19 package pages list `kcrommett` and authorize the `Latitudes-Dev/shuvcode` + `publish.yml` trusted publisher.
2. Ensure the intended branch and commit have passed normal tests and review.
3. Dispatch `publish.yml` manually with exactly one of `version` or `bump`.
4. Confirm the preflight reports 19 packages before any release or publish step proceeds.
5. Verify all 19 versions and dist-tags on npm, then verify the GitHub tag/release targets the intended commit.
6. If publication stopped after a subset reached npm, resolve the failure and redispatch; never overwrite an immutable npm version or move a published tag.

Local tests must use synthetic npm responses. Do not use tests to call the live registry, publish packages, bootstrap names, or mutate GitHub releases.
