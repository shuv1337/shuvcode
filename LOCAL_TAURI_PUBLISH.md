# Local Tauri Publish (Shuvcode)

This guide is local-only: build, sign, and publish the desktop app without GitHub Actions.

## 1) Prerequisites

- Bun and Rust installed (host triple in `rustc -vV`).
- Tauri CLI available via `bun run tauri` in `packages/desktop`.
- Linux-only bundling dependencies for AppImage:
  - Install `fuse2` (or set `APPIMAGE_EXTRACT_AND_RUN=1` to avoid FUSE).
  - Ensure `glibc`, `gtk3`, `webkit2gtk`, and related system libs are installed.

## 2) Branding + updater config you must own

- Set the updater public key to your Shuvcode key in `packages/desktop/src-tauri/tauri.prod.conf.json`.
- Confirm updater endpoint uses your repo: `https://github.com/Latitudes-Dev/shuvcode/releases/latest/download/latest.json`.
- Ensure bundle identifiers are correct:
  - Dev: `dev.shuvcode.desktop.dev`
  - Prod: `dev.shuvcode.desktop`

## 3) Generate signing keys (one-time)

Run locally:

```bash
bun run --cwd packages/desktop tauri signer generate -w ./shuvcode-private.key
```

- The command prints a public key; copy that into `plugins.updater.pubkey` in `packages/desktop/src-tauri/tauri.prod.conf.json`.
- Store the private key securely. If you set a password, also store it.

## 4) Local build workflow (per release)

```bash
export RUST_TARGET=x86_64-unknown-linux-gnu
bun run --cwd packages/desktop predev
bun run --cwd packages/desktop build
TAURI_SIGNING_PRIVATE_KEY="$(cat ./shuvcode-private.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<if-set>" \
bun run --cwd packages/desktop tauri build
```

Outputs appear in:

- Bundles: `packages/desktop/src-tauri/target/release/bundle/`
- App binary: `packages/desktop/src-tauri/target/release/Shuvcode`

## 5) Publish locally (no CI)

You have two viable local publish paths:

### Option A: GitHub Releases (local upload)

- Create a release and upload bundle artifacts + `latest.json` (updater manifest).
- Use `gh release create --repo Latitudes-Dev/shuvcode` from your machine.

### Option B: Self-hosted updater

- Host the full contents of `bundle/` plus `latest.json` on your own server.
- Update `plugins.updater.endpoints` to your hosting URL.

## 6) Known local issues

- AppImage bundling failed locally with `failed to run linuxdeploy`.
  - Install `fuse2` or set `APPIMAGE_EXTRACT_AND_RUN=1`.
  - Re-run `bun run --cwd packages/desktop tauri build`.

## 7) Validation checklist

- Launch `Shuvcode` binary, verify UI loads.
- Confirm sidecar starts (CLI server is reachable on the injected port).
- Run in-app update check; ensure it hits your Shuvcode release endpoint.
- Verify installed bundle name and identifier for each OS.
