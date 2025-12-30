# Shuvcode Desktop (Tauri) Follow-ups

- Update the Tauri updater public key to the Shuvcode signing key in `packages/desktop/src-tauri/tauri.prod.conf.json`.
- Confirm the fork’s release workflow uploads `latest.json` and uses the Shuvcode repo endpoint for updater artifacts.
- Ensure the CI artifact name for the sidecar is `shuvcode-cli` (matches `packages/desktop/scripts/prepare.ts`).
- Verify all sidecar binaries exist for targets in `packages/desktop/scripts/utils.ts` (especially Linux arm64).
- Validate bundle naming in CI now that the product name is Shuvcode (script expects `Shuvcode*` in `packages/desktop/scripts/copy-bundles.ts`).
- Check macOS/Windows signing identities and entitlements to match the new bundle identifiers (`dev.shuvcode.desktop`).
- Run a full desktop smoke test: `bun run predev` then `bun run tauri dev`, confirm sidecar launch + update flow.
