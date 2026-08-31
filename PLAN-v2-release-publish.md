# Fork release runbook

Shuvcode releases are manual and fork-only. Dispatch `.github/workflows/publish.yml` on `integration-v2` in `Latitudes-Dev/shuvcode` with exactly one `version` or `bump` input. The workflow publishes only Shuvcode CLI npm packages and standalone CLI archives. It does not publish internal `@opencode-ai/*` packages, Desktop applications, containers, editor extensions, GitHub Actions, or website deployments.

## Package set

The ownership preflight in `packages/cli/script/preflight-publish.ts` is the source of truth. It must select these 19 packages:

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

The `shuvcode` package also exports the zero-Effect Promise facade at `shuvcode/client`. Internal package names remain `@opencode-ai/*` for source compatibility and are not release products.

## Non-mutating preflight

Before dispatch, run only checks that cannot create tags, releases, commits, or publications:

```sh
bun packages/cli/script/preflight-publish.ts
```

Package-local CLI build, package smoke, and ownership tests may also run when the complete generated client and lockfile are present. Do not use release scripts as a dry run unless their implementation is proven non-mutating.

## Workflow controls

- The `version` job must require `github.repository == 'Latitudes-Dev/shuvcode'` and `github.ref_name == 'integration-v2'`.
- npm publication uses trusted publishing with `id-token: write`; no npm token is stored.
- Release lookup reuses exactly one matching draft and fails closed on ambiguous or published state.
- Uploaded archive names, non-zero sizes, and executable modes are verified before npm publication.
- `notify-discord.yml` runs only after successful publication.
- `.github/last-synced-tag` is an upstream sync marker, not a release input.

## Retry

npm publication is not transactional. If a release stops after publishing a subset, fix the cause and rerun the same release input so exact versions are reconciled and only missing packages publish. Never choose a new version to hide a partial publication or move a published tag.

No release, workflow dispatch, tag, push, or deployment is authorized by this runbook alone.
