# Tauri App Build and Release Workflow Plan - FULL REBRAND

**Created:** 2025-01-09
**Updated:** 2025-12-09
**Goal:** Complete shuvcode fork's Tauri app build and release workflow with full rebrand before upstream sst/opencode releases theirs
**Status:** Reviewed - Ready for Implementation
**Scope:** Full rebrand including own sidecar binaries, signing keys, Apple API credentials

---

## Decisions Made

| Decision        | Value                                   |
| --------------- | --------------------------------------- |
| App name        | `shuvcode` (lowercase)                  |
| Product name    | `shuvcode`                              |
| Bundle ID       | `dev.shuvcode.desktop`                  |
| macOS signing   | Yes - Apple Developer account ready     |
| Windows signing | Yes - implement last                    |
| Sidecar source  | `Latitudes-Dev/shuvcode` (own binaries) |

---

## Executive Summary

This plan covers implementing a complete GitHub Actions workflow to build, sign, and release the **shuvcode** Tauri desktop application for macOS (Intel + ARM), Windows, and Linux. The workflow will:

1. Build and publish shuvcode CLI binaries to GitHub Releases (already working via snapshot.yml)
2. Build Tauri desktop app that bundles the shuvcode CLI as a sidecar
3. Sign all binaries (macOS notarization, Windows code signing)
4. Publish to GitHub Releases with auto-updater support

---

## Current State Analysis

### What Already Exists (Fork-Specific)

| Component           | Location                              | Status                                       |
| ------------------- | ------------------------------------- | -------------------------------------------- |
| CLI binary build    | `packages/opencode/script/build.ts`   | Working - outputs `shuvcode-*` binaries      |
| CLI publishing      | `packages/opencode/script/publish.ts` | Working - publishes to npm as `shuvcode`     |
| GitHub Release      | `script/publish.ts` line 162          | Working - creates releases with CLI binaries |
| Tauri app structure | `packages/tauri/`                     | Complete but branded "OpenCode"              |
| Sidecar scripts     | `packages/tauri/scripts/*.ts`         | Complete but downloads from `sst/opencode`   |

### What Needs Changing

| Item                 | Current Value           | New Value                 |
| -------------------- | ----------------------- | ------------------------- |
| `productName`        | `OpenCode`              | `shuvcode`                |
| `mainBinaryName`     | `OpenCode Desktop`      | `shuvcode Desktop`        |
| `identifier`         | `ai.opencode.desktop`   | `dev.shuvcode.desktop`    |
| Sidecar source       | `sst/opencode`          | `Latitudes-Dev/shuvcode`  |
| Sidecar binary names | `opencode-*`            | `shuvcode-*`              |
| Updater endpoint     | `brendonovich/opencode` | `Latitudes-Dev/shuvcode`  |
| Updater pubkey       | Brendonovich's key      | Your new key              |
| Icons                | OpenCode icons          | shuvcode icons (optional) |

---

## Implementation Tasks

### Phase 0: Prerequisites - Things You Need to Provide

- [ ] **0.1 Apple Developer Account Setup**
  - Export Developer ID Application certificate as .p12
  - Create App Store Connect API key
  - Document:
    - Certificate password
    - API Key ID
    - API Issuer ID
    - .p8 key file contents

- [ ] **0.2 Generate Tauri Update Signing Keypair**

  ```bash
  cd packages/tauri
  bun tauri signer generate -w ~/.tauri/shuvcode.key
  ```

  - Save the public key (for tauri.conf.json)
  - Save the private key (for GitHub secret)
  - Save the password (for GitHub secret)

- [ ] **0.3 (Optional) Windows Code Signing Certificate**
  - If you have one, export as .pfx
  - Document password

- [ ] **0.4 (Optional) Create shuvcode Icons**
  - Replace icons in `packages/tauri/src-tauri/icons/`
  - Required sizes: 32x32, 64x64, 128x128, 128x128@2x, icon.icns, icon.ico

### Phase 1: Rebrand Tauri Configuration

- [ ] **1.1 Update tauri.conf.json**
  - File: `packages/tauri/src-tauri/tauri.conf.json`

  ```json
  {
    "productName": "shuvcode",
    "mainBinaryName": "shuvcode desktop",
    "identifier": "dev.shuvcode.desktop",
    "bundle": {
      "externalBin": ["sidecars/shuvcode"]
    },
    "plugins": {
      "updater": {
        "pubkey": "<YOUR_NEW_PUBLIC_KEY>",
        "endpoints": ["https://github.com/Latitudes-Dev/shuvcode/releases/latest/download/latest.json"]
      }
    }
  }
  ```

- [ ] **1.2 Update Cargo.toml package name**
  - File: `packages/tauri/src-tauri/Cargo.toml`
  - Change `name = "opencode-desktop"` to `name = "shuvcode-desktop"`
  - Update `tauri-plugin-shell` allowed commands if referencing "opencode"

- [ ] **1.3 Update sidecar utility mappings**
  - File: `packages/tauri/scripts/utils.ts`

  ```typescript
  export const SIDECAR_BINARIES = [
    {
      rustTarget: "aarch64-apple-darwin",
      ocBinary: "shuvcode-darwin-arm64",
      assetExt: "zip",
    },
    {
      rustTarget: "x86_64-apple-darwin",
      ocBinary: "shuvcode-darwin-x64",
      assetExt: "zip",
    },
    {
      rustTarget: "x86_64-pc-windows-msvc",
      ocBinary: "shuvcode-windows-x64",
      assetExt: "zip",
    },
    {
      rustTarget: "x86_64-unknown-linux-gnu",
      ocBinary: "shuvcode-linux-x64",
      assetExt: "tar.gz",
    },
  ]

  export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
    await $`mkdir -p src-tauri/sidecars`
    const dest = `src-tauri/sidecars/shuvcode-${target}${process.platform === "win32" ? ".exe" : ""}`
    // ...
  }
  ```

- [ ] **1.4 Update prepare.ts to download from fork**
  - File: `packages/tauri/scripts/prepare.ts`

  ```typescript
  // Line 12: Change repo from sst/opencode to fork
  await $`gh release download --pattern ${sidecarConfig.ocBinary}.${sidecarConfig.assetExt} --repo Latitudes-Dev/shuvcode --skip-existing --dir ${dir}`

  // Line 20: Keep the extracted binary name as 'opencode'
  // (The binary inside the archive is still named 'opencode', only the archive is 'shuvcode-*')
  await copyBinaryToSidecarFolder(`${dir}/opencode${process.platform === "win32" ? ".exe" : ""}`)
  ```

  **Important**: The binary inside the archive is still named `opencode` because `build.ts` outputs to `dist/${name}/bin/opencode`. Only the archive/package name uses `shuvcode-*` prefix.

- [ ] **1.5 Update macOS entitlements if needed**
  - File: `packages/tauri/src-tauri/entitlements.plist`
  - Review for any hardcoded bundle identifiers

- [ ] **1.6 Update Rust sidecar and UI strings (CRITICAL)**
  - File: `packages/tauri/src-tauri/src/lib.rs`
  - This is required for the sidecar to spawn correctly after rebranding

  ```rust
  // Line 61: Update sidecar name to match externalBin in tauri.conf.json
  .sidecar("shuvcode")  // was: .sidecar("opencode")

  // Line 117: Update dialog message
  "shuvcode server is already running, would you like to restart it?"

  // Line 163: Update window title
  .title("shuvcode")  // was: .title("OpenCode")
  ```

- [ ] **1.7 Update predev.ts for local development**
  - File: `packages/tauri/scripts/predev.ts`
  - Update binary path to match new naming convention

  ```typescript
  // Line 10: Update binary path reference
  const binaryPath = `../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`
  // Note: The actual binary inside the archive is still named 'opencode'
  // Only the package/archive name is 'shuvcode-*'
  ```

### Phase 2: Configure GitHub Secrets

Add these secrets to `Latitudes-Dev/shuvcode` repository settings:

- [ ] **2.1 Tauri Update Signing**
      | Secret | Value |
      |--------|-------|
      | `TAURI_SIGNING_PRIVATE_KEY` | Contents of ~/.tauri/shuvcode.key |
      | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you chose when generating |

- [ ] **2.2 Apple Code Signing**
      | Secret | Value |
      |--------|-------|
      | `APPLE_CERTIFICATE` | Base64-encoded .p12: `base64 -i cert.p12` |
      | `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 file |

- [ ] **2.3 Apple Notarization**
      | Secret | Value |
      |--------|-------|
      | `APPLE_API_KEY` | API Key ID (e.g., `XXXXXXXXXX`) |
      | `APPLE_API_ISSUER` | Issuer ID from App Store Connect |
      | `APPLE_API_KEY_PATH` | Full contents of the .p8 key file |

- [ ] **2.4 (Optional) Windows Code Signing**
      | Secret | Value |
      |--------|-------|
      | `WINDOWS_CERTIFICATE` | Base64-encoded .pfx |
      | `WINDOWS_CERTIFICATE_PASSWORD` | Password for the .pfx |

### Phase 3: Create Tauri Release Workflow

- [ ] **3.1 Create workflow file**
  - File: `.github/workflows/tauri-release.yml`

```yaml
name: Tauri Release

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Version to release (e.g., 1.0.0) - leave empty to use package.json"
        required: false
        type: string
  push:
    tags:
      - "tauri-v*"

permissions:
  contents: write

env:
  # Use the fork repo for sidecar downloads
  SIDECAR_REPO: Latitudes-Dev/shuvcode

jobs:
  # First, ensure CLI binaries exist for this version
  check-cli-release:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Determine version
        id: version
        run: |
          if [ -n "${{ inputs.version }}" ]; then
            echo "version=${{ inputs.version }}" >> $GITHUB_OUTPUT
          else
            VERSION=$(jq -r .version packages/tauri/package.json)
            echo "version=$VERSION" >> $GITHUB_OUTPUT
          fi

      - name: Check CLI release exists
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          VERSION="${{ steps.version.outputs.version }}"
          # Check if release with CLI binaries exists
          if ! gh release view "v$VERSION" --repo ${{ env.SIDECAR_REPO }} >/dev/null 2>&1; then
            echo "::error::Release v$VERSION not found. Run snapshot workflow first."
            exit 1
          fi
          # Verify shuvcode binaries are present
          ASSETS=$(gh release view "v$VERSION" --repo ${{ env.SIDECAR_REPO }} --json assets -q '.assets[].name')
          if ! echo "$ASSETS" | grep -q "shuvcode-"; then
            echo "::error::CLI binaries not found in release v$VERSION"
            exit 1
          fi

  build-tauri:
    needs: check-cli-release
    strategy:
      fail-fast: false
      matrix:
        settings:
          - host: macos-latest
            target: x86_64-apple-darwin
          - host: macos-latest
            target: aarch64-apple-darwin
          - host: windows-latest
            target: x86_64-pc-windows-msvc
          - host: ubuntu-24.04
            target: x86_64-unknown-linux-gnu

    runs-on: ${{ matrix.settings.host }}

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # ===== macOS Code Signing Setup =====
      - name: Import Apple certificate
        if: runner.os == 'macOS'
        uses: apple-actions/import-codesign-certs@v2
        with:
          keychain: build
          p12-file-base64: ${{ secrets.APPLE_CERTIFICATE }}
          p12-password: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}

      - name: Get Apple signing identity
        if: runner.os == 'macOS'
        run: |
          CERT_INFO=$(security find-identity -v -p codesigning build.keychain | grep "Developer ID Application")
          CERT_ID=$(echo "$CERT_INFO" | awk -F'"' '{print $2}')
          echo "CERT_ID=$CERT_ID" >> $GITHUB_ENV
          echo "Found signing identity: $CERT_ID"

      - name: Setup Apple API Key for notarization
        if: runner.os == 'macOS'
        run: |
          mkdir -p ~/private_keys
          echo "${{ secrets.APPLE_API_KEY_PATH }}" > ~/private_keys/AuthKey_${{ secrets.APPLE_API_KEY }}.p8

      # ===== Linux Dependencies =====
      - name: Install Linux dependencies
        if: startsWith(matrix.settings.host, 'ubuntu')
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf

      # ===== Common Setup =====
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.3

      - name: Install dependencies
        run: bun install

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.settings.target }}

      - name: Cache Rust
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: packages/tauri/src-tauri
          shared-key: ${{ matrix.settings.target }}

      # ===== Sidecar Preparation =====
      - name: Download and prepare sidecar binary
        working-directory: packages/tauri
        env:
          RUST_TARGET: ${{ matrix.settings.target }}
          GH_TOKEN: ${{ github.token }}
        run: bun ./scripts/prepare.ts

      # ===== Linux: Use patched Tauri CLI for AppImage fix =====
      - name: Install patched Tauri CLI (Linux)
        if: startsWith(matrix.settings.host, 'ubuntu')
        run: |
          cargo install tauri-cli \
            --git https://github.com/tauri-apps/tauri \
            --branch feat/truly-portable-appimage

      # ===== Build with Tauri Action =====
      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Update signing
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          # macOS signing
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ env.CERT_ID }}
          # macOS notarization
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_PATH: ~/private_keys/AuthKey_${{ secrets.APPLE_API_KEY }}.p8
          # Linux AppImage fix
          TAURI_BUNDLER_NEW_APPIMAGE_FORMAT: ${{ startsWith(matrix.settings.host, 'ubuntu') && 'true' || '' }}
        with:
          projectPath: packages/tauri
          tauriScript: ${{ startsWith(matrix.settings.host, 'ubuntu') && 'cargo tauri' || '' }}
          args: --target ${{ matrix.settings.target }}
          tagName: tauri-v__VERSION__
          releaseName: "shuvcode desktop v__VERSION__"
          releaseBody: |
            ## shuvcode desktop v__VERSION__

            Desktop application for shuvcode AI coding assistant.

            ### Downloads

            | Platform | File |
            |----------|------|
            | macOS (Apple Silicon) | `shuvcode_*_aarch64.dmg` |
            | macOS (Intel) | `shuvcode_*_x64.dmg` |
            | Windows | `shuvcode_*_x64-setup.exe` or `.msi` |
            | Linux | `.AppImage`, `.deb`, or `.rpm` |

            ### Auto-Updates

            This release supports automatic updates. The app will notify you when a new version is available.
          releaseDraft: true
          prerelease: false
          updaterJsonPreferNsis: true
```

### Phase 4: Integrate with Existing Snapshot Workflow

- [ ] **4.1 Option A: Trigger Tauri workflow after snapshot**
  - Add to end of `.github/workflows/snapshot.yml`:

  ```yaml
  trigger-tauri:
    needs: publish
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Tauri build
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'tauri-release.yml',
              ref: context.ref
            })
  ```

- [ ] **4.2 Option B: Keep workflows separate (recommended for initial setup)**
  - Run snapshot first to create CLI release
  - Then manually trigger tauri-release

### Phase 5: Testing and Validation

- [ ] **5.1 Local build test**

  ```bash
  cd packages/tauri
  export RUST_TARGET=$(rustc -vV | grep host | cut -d' ' -f2)
  export GH_TOKEN=$(gh auth token)
  bun ./scripts/prepare.ts
  bun tauri build
  ```

- [ ] **5.2 Workflow test on feature branch**
  - Create `feat/tauri-release-workflow` branch
  - Push changes
  - Manually trigger workflow
  - Verify all 4 platforms build

- [ ] **5.3 Artifact validation**
  - Download each platform's artifact
  - Verify app launches
  - Verify sidecar CLI works (`shuvcode desktop` should spawn `shuvcode` process)

- [ ] **5.4 Code signing validation**
  - macOS: `codesign -dv --verbose=4 /Applications/shuvcode.app`
  - macOS: `spctl -a -v /Applications/shuvcode.app`
  - Windows: Right-click .exe → Properties → Digital Signatures (after Windows signing added)

- [ ] **5.5 Auto-updater test**
  - Install v1.0.0
  - Publish v1.0.1 release
  - Verify app detects and installs update

---

## Files to Modify Summary

| File                                       | Changes                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/tauri/src-tauri/tauri.conf.json` | productName, mainBinaryName, identifier, externalBin, updater pubkey/endpoint |
| `packages/tauri/src-tauri/Cargo.toml`      | package name, lib name                                                        |
| `packages/tauri/src-tauri/src/lib.rs`      | **CRITICAL**: sidecar name, dialog text, window title                         |
| `packages/tauri/scripts/utils.ts`          | Binary names (opencode→shuvcode), sidecar path                                |
| `packages/tauri/scripts/prepare.ts`        | Download repo (sst/opencode→Latitudes-Dev/shuvcode)                           |
| `packages/tauri/scripts/predev.ts`         | Binary path reference for local development                                   |
| `.github/workflows/tauri-release.yml`      | NEW FILE                                                                      |
| `.github/workflows/snapshot.yml`           | Optional: trigger tauri workflow                                              |
| `packages/tauri/src-tauri/icons/*`         | Optional: new shuvcode icons                                                  |

---

## GitHub Secrets Required

| Secret                               | Purpose              | How to Get                                     |
| ------------------------------------ | -------------------- | ---------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Sign update packages | `bun tauri signer generate`                    |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Unlock signing key   | Password you choose                            |
| `APPLE_CERTIFICATE`                  | macOS code signing   | Export from Keychain as .p12, then `base64 -i` |
| `APPLE_CERTIFICATE_PASSWORD`         | Unlock certificate   | Password when exporting                        |
| `APPLE_API_KEY`                      | Notarization         | App Store Connect → Keys → Key ID              |
| `APPLE_API_ISSUER`                   | Notarization         | App Store Connect → Keys → Issuer ID           |
| `APPLE_API_KEY_PATH`                 | Notarization         | Contents of .p8 file                           |

---

## External References

| Resource                         | URL                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tauri Action                     | https://github.com/tauri-apps/tauri-action                                                               |
| Tauri v2 Code Signing (macOS)    | https://v2.tauri.app/distribute/sign/macos/                                                              |
| Tauri v2 Code Signing (Windows)  | https://v2.tauri.app/distribute/sign/windows/                                                            |
| Tauri v2 Updater                 | https://v2.tauri.app/plugin/updater/                                                                     |
| Apple Developer - Create API Key | https://developer.apple.com/documentation/appstoreconnectapi/creating_api_keys_for_app_store_connect_api |
| Upstream publish.yml (reference) | https://github.com/sst/opencode/blob/dev/.github/workflows/publish.yml                                   |

---

## What You Need to Do Right Now

1. **Generate Tauri signing keypair**:

   ```bash
   cd packages/tauri
   bun tauri signer generate -w ~/.tauri/shuvcode.key
   ```

   Share the **public key** with me (safe to share). Keep private key and password for secrets.

2. **Get Apple credentials ready**:
   - Export Developer ID Application certificate as .p12 from Keychain Access
   - Create App Store Connect API key if you don't have one
   - Have ready: Key ID, Issuer ID, .p8 file contents

3. **Icons**: Keep OpenCode icons or create new ones? (can do later)

4. **Add secrets** to `Latitudes-Dev/shuvcode` (need admin access)

Once you provide the **public key**, I can start implementing.

---

## Risk Assessment

| Risk                    | Impact                            | Mitigation                                             |
| ----------------------- | --------------------------------- | ------------------------------------------------------ |
| Apple cert issues       | Builds fail or unsigned           | Test cert locally first with `security find-identity`  |
| Sidecar download fails  | Tauri build fails                 | Ensure snapshot workflow runs first                    |
| Notarization fails      | macOS users see "damaged" warning | Check Apple Developer account standing                 |
| Upstream releases first | Lose time advantage               | Prioritize macOS/Linux first, add Windows signing last |
| Windows cert delay      | Windows builds unsigned initially | Build unsigned first, add signing when cert acquired   |

---

## Notes

- The CLI binaries are already being built and published by `snapshot.yml` → `script/publish.ts` → creates GitHub release with `shuvcode-*.zip` and `shuvcode-*.tar.gz`
- The Tauri workflow downloads these pre-built binaries rather than building from source
- This means: **run snapshot.yml first, then tauri-release.yml**

---

## Review Notes (2025-12-09)

### Issues Fixed in This Revision

1. **Added lib.rs to Phase 1** - Critical file that was missing. The `.sidecar("opencode")` call in `lib.rs:61` must be updated to `.sidecar("shuvcode")` to match the `externalBin` in `tauri.conf.json`, otherwise the Tauri app won't be able to spawn the sidecar.

2. **Added predev.ts to Phase 1** - Required for local development to continue working after rebrand.

3. **Fixed binary naming clarification** - The binary inside the archive is still named `opencode` (as output by `build.ts:123`). Only the archive/package names use the `shuvcode-*` prefix. Updated prepare.ts snippet to reflect this.

4. **Removed timeline estimates** - Per project guidelines.

### Remaining Considerations

- **Linux ARM64**: The workflow matrix only includes `x86_64-unknown-linux-gnu`. Consider adding `aarch64-unknown-linux-gnu` if ARM64 Linux desktop support is desired.

- **Environment variable naming**: `lib.rs` uses `OPENCODE_PORT` environment variable. Decide whether to rename to `SHUVCODE_PORT` or keep for backward compatibility.

- **Package name in package.json**: The npm package is `@opencode-ai/tauri` - this could be updated but is internal only.

### Approval Status

**READY FOR IMPLEMENTATION** - All critical issues have been addressed.
