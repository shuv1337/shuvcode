# Tauri Mobile Support Implementation Plan

**Date:** 2026-01-06  
**Author:** Shuvcode Fork Team  
**Status:** Draft  
**Target:** Android & iOS native apps via Tauri v2

## Executive Summary

This plan outlines the implementation of native mobile app support for the shuvcode fork using Tauri v2's mobile capabilities. The fork already has excellent PWA support with mobile-optimized components. This plan builds on that foundation to create native Android and iOS apps that provide better platform integration, offline support, and App Store/Play Store distribution.

## Current State Analysis

### Existing Mobile Infrastructure (PWA)

The shuvcode fork already has significant mobile-ready infrastructure:

| Component | Location | Purpose |
|-----------|----------|---------|
| `MobileTerminalInput` | `packages/app/src/components/mobile-terminal-input.tsx` | Hidden input bridge for mobile keyboard to terminal WebSocket |
| `PullToRefresh` | `packages/app/src/components/pull-to-refresh.tsx` | Touch gesture detection for iOS-style pull-to-refresh |
| `useKeyboardVisibility` | `packages/app/src/hooks/use-keyboard-visibility.tsx` | Visual viewport API hook for mobile keyboard detection |
| Mobile sidebar | `packages/app/src/context/layout.tsx` | `mobileSidebar` state, drawer-style navigation |
| Mobile tabs | `packages/app/src/pages/session.tsx` | Session/Review tab switcher for mobile |
| Safe area insets | `packages/app/src/index.css` | CSS variables for notch/dynamic island handling |
| PWA manifest | `packages/app/public/site.webmanifest` | Standalone display, portrait orientation |
| Service worker | `packages/app/vite.config.ts` | VitePWA with offline caching |

### Existing Desktop Tauri Infrastructure

The desktop Tauri app provides a solid foundation:

| Component | Location | Purpose |
|-----------|----------|---------|
| `tauri.conf.json` | `packages/desktop/src-tauri/tauri.conf.json` | App configuration, bundle settings |
| `Cargo.toml` | `packages/desktop/src-tauri/Cargo.toml` | Rust dependencies, Tauri plugins |
| `lib.rs` | `packages/desktop/src-tauri/src/lib.rs` | Main app logic, sidecar management |
| `cli.rs` | `packages/desktop/src-tauri/src/cli.rs` | CLI installation, path resolution |
| `window_customizer.rs` | `packages/desktop/src-tauri/src/window_customizer.rs` | Pinch zoom disable (Linux only) |
| Mobile icons | `packages/desktop/src-tauri/icons/prod/android/` | Pre-generated Android mipmap icons |
| iOS icons | `packages/desktop/src-tauri/icons/prod/ios/` | Pre-generated iOS AppIcon assets |
| Platform context | `packages/app/src/context/platform.tsx` | Platform abstraction layer |
| Desktop entry | `packages/desktop/src/index.tsx` | Tauri platform implementation |

### Key Observation: Mobile Entry Point Exists

The codebase already includes the mobile entry point attribute:
```rust
// packages/desktop/src-tauri/src/lib.rs:193
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
```

This indicates the Rust side is partially prepared for mobile builds.

## Technical Challenges

### 1. Sidecar Binary Architecture

**Current Desktop Approach:**
- Desktop app spawns a sidecar binary (`shuvcode-cli`) that runs the server
- Server listens on localhost and WebView connects to it
- Sidecar handles all agent functionality, LSP, MCP, file operations

**Mobile Challenge:**
- iOS does not allow spawning background processes/sidecars
- Android has similar restrictions in recent versions
- Mobile apps run in sandboxed environments

**Solution Options:**

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **A. Remote Server** | Simple, works today | Requires network, no offline | For MVP/testing |
| **B. Embedded Rust Server** | True native, offline capable | Complex FFI, larger binary | Long-term goal |
| **C. WebAssembly Runtime** | Cross-platform, sandboxed | Performance limitations | Experimental |

### 2. Terminal Emulation

**Current State:**
- Uses `ghostty-web` WASM module for terminal rendering
- WebSocket connection to PTY server endpoint
- MobileTerminalInput bridges native keyboard

**Mobile Challenge:**
- PTY server runs in sidecar (not available on mobile)
- Need alternative for shell access

**Solution:**
- Phase 1: Connect to remote shuvcode server (existing PWA behavior)
- Phase 2: Explore terminal.js alternatives or WebSocket proxy

### 3. File System Access

**Current Desktop:**
- Full filesystem access via Tauri's fs plugin
- Native file/directory pickers

**Mobile Challenge:**
- iOS: Sandboxed app container + Files app integration
- Android: Scoped storage since Android 11

**Solution:**
- Use Tauri's mobile-compatible plugins
- Integrate with system file providers
- In the MVP, rely on the remote server filesystem (no device-local project storage)
- Consider workspace sync via Git or cloud storage

### 4. Server URL Resolution & Persistence

**Current State:**
- `defaultServerUrl` is computed synchronously in `packages/app/src/app.tsx`
- Server selection and persistence live in `ServerProvider` (`packages/app/src/context/server.tsx`)
- `DialogSelectServer` already supports add/switch + health checks

**Mobile Challenge:**
- Mobile needs a remote server URL injected before `App` renders
- Adding a separate mobile server dialog risks divergence

**Solution:**
- Inject `window.__SHUVCODE__.serverUrl` in the mobile entry before render
- Update `defaultServerUrl` to check this value first
- Reuse `DialogSelectServer` for all server changes

## Implementation Plan

### Phase 1: Project Initialization & Configuration

#### 1.1 Initialize Tauri Mobile Targets

- [ ] Run `bun tauri android init` in `packages/desktop`
- [ ] Run `bun tauri ios init` in `packages/desktop`
- [ ] Verify generated files:
  - `src-tauri/gen/android/` - Android Studio project
  - `src-tauri/gen/apple/` - Xcode project

**Files Created:**
```
packages/desktop/src-tauri/
  gen/
    android/
      app/
        build.gradle.kts
        src/main/
          AndroidManifest.xml
          java/ai/shuv/desktop/
            MainActivity.kt
          res/
      build.gradle.kts
      settings.gradle.kts
    apple/
      Shuvcode.xcodeproj/
      Shuvcode/
        Info.plist
        Assets.xcassets/
```

#### 1.2 Configure Mobile Identifiers

- [ ] Update `packages/desktop/src-tauri/tauri.conf.json` with shared mobile identifiers and defaults.
- [ ] Add mobile overrides in `packages/desktop/src-tauri/tauri.android.conf.json` and `packages/desktop/src-tauri/tauri.ios.conf.json` (do not place these at repo root).
- [ ] Update `packages/desktop/src-tauri/tauri.prod.conf.json` so production identifiers and plugin config are correct for mobile (e.g., disable updater on mobile builds).

```json
{
  "identifier": "ai.shuv.shuvcode",
  "bundle": {
    "iOS": {
      "developmentTeam": "YOUR_TEAM_ID",
      "minimumSystemVersion": "13.0"
    },
    "android": {
      "minSdkVersion": 24
    }
  }
}
```

**Reference Files:**
- `packages/desktop/src-tauri/tauri.conf.json:1-43`
- `packages/desktop/src-tauri/tauri.prod.conf.json:1-33`

#### 1.3 Configure App Icons

- [ ] Verify existing icons in `packages/desktop/src-tauri/icons/prod/android/`
- [ ] Verify existing icons in `packages/desktop/src-tauri/icons/prod/ios/`
- [ ] Add dev variant icons for debug builds
- [ ] Run `bun tauri icon` if regeneration needed

**Current Icon Structure:**
```
packages/desktop/src-tauri/icons/
  prod/
    android/
      mipmap-hdpi/
      mipmap-mdpi/
      mipmap-xhdpi/
      mipmap-xxhdpi/
      mipmap-xxxhdpi/
      mipmap-anydpi-v26/
      values/
    ios/
      AppIcon-20x20@*.png
      AppIcon-29x29@*.png
      AppIcon-40x40@*.png
      AppIcon-60x60@*.png
      AppIcon-76x76@*.png
      AppIcon-83.5x83.5@2x.png
      AppIcon-512@2x.png
```

### Phase 2: Rust Mobile Adaptation

#### 2.1 Conditional Compilation for Mobile

- [ ] Split `run()` into `run_desktop()` and `run_mobile()` and gate all desktop-only modules/commands (sidecar, window customizer, clipboard, updater, shell/process) with `cfg(not(mobile))` so mobile builds compile cleanly.

```rust
// packages/desktop/src-tauri/src/lib.rs

#[cfg(not(mobile))]
mod cli;
#[cfg(not(mobile))]
mod window_customizer;

#[cfg(not(mobile))]
use cli::{get_sidecar_path, install_cli, sync_cli};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(mobile)]
    {
        // Mobile-specific initialization
        run_mobile();
    }
    
    #[cfg(not(mobile))]
    {
        // Existing desktop code
        run_desktop();
    }
}

#[cfg(mobile)]
fn run_mobile() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        // Note: shell plugin limited on mobile
        // Note: window-state not needed on mobile
        // Note: updater works differently on mobile (app stores)
        .invoke_handler(tauri::generate_handler![
            // Mobile-safe commands only
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Reference Files:**
- `packages/desktop/src-tauri/src/lib.rs:193-330`

#### 2.2 Update Cargo.toml for Mobile

- [ ] Add mobile-specific dependencies:

```toml
# packages/desktop/src-tauri/Cargo.toml

[target.'cfg(any(target_os = "android", target_os = "ios"))'.dependencies]
# Mobile-specific deps
log = "0.4"

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
# Desktop-only deps
gtk = "0.18.2"
webkit2gtk = "=2.0.1"
listeners = "0.3"

[dependencies]
# Common deps - verify mobile compatibility
tauri = { version = "2", features = ["macos-private-api", "devtools"] }
# Note: Remove features not available on mobile
```

- [ ] Remove/conditionally compile desktop-only plugins:
  - `tauri-plugin-updater` - App store handles updates on mobile
  - `tauri-plugin-window-state` - Not applicable to mobile
  - `tauri-plugin-clipboard-manager` - Requires mobile permissions
- [ ] Update `packages/desktop/src-tauri/tauri.prod.conf.json` to ensure updater config remains desktop-only and does not affect mobile builds.

**Reference Files:**
- `packages/desktop/src-tauri/Cargo.toml:1-43`
- `packages/desktop/src-tauri/tauri.prod.conf.json:1-33`

#### 2.3 Add Mobile Commands

- [ ] Create mobile-specific Tauri commands:

```rust
// packages/desktop/src-tauri/src/mobile.rs (new file)

#[cfg(mobile)]
use tauri::command;

#[cfg(mobile)]
#[command]
pub fn get_server_url() -> String {
    // Return configured server URL for remote connection
    std::env::var("SHUVCODE_SERVER_URL")
        .unwrap_or_else(|_| "https://your-server.shuv.ai".to_string())
}

#[cfg(mobile)]
#[command]
pub fn is_mobile() -> bool {
    true
}
```

### Phase 3: Mobile Capabilities & Permissions

#### 3.1 Create Mobile Capabilities File

- [ ] Create `packages/desktop/src-tauri/capabilities/mobile.json`:

```json
{
  "$schema": "../gen/schemas/mobile-schema.json",
  "identifier": "mobile",
  "description": "Capability for mobile platforms",
  "platforms": ["android", "iOS"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "store:default",
    "os:default",
    "notification:default",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "http://*" },
        { "url": "https://*" }
      ]
    }
  ]
}
```

**Reference Files:**
- `packages/desktop/src-tauri/capabilities/default.json:1-29`

#### 3.2 Configure Android Permissions

- [ ] Update `AndroidManifest.xml` (generated, may need customization):

```xml
<!-- Required permissions -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Optional: For notifications -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- Optional: For file access -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

#### 3.3 Configure iOS Permissions

- [ ] Update `Info.plist` (generated, may need customization):

```xml
<!-- For file access -->
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>

<!-- For notifications -->
<key>NSUserNotificationUsageDescription</key>
<string>Notifications for agent completions and errors</string>
```

### Phase 4: Frontend Mobile Platform Implementation

#### 4.1 Create Mobile Platform Context

- [ ] Create `packages/desktop/src/mobile.tsx`:

```tsx
// Mobile platform implementation
import { Platform, PlatformProvider } from "@opencode-ai/app"
import { App } from "@opencode-ai/app"
import { AsyncStorage } from "@solid-primitives/storage"
import { Store } from "@tauri-apps/plugin-store"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { open as shellOpen } from "@tauri-apps/plugin-opener"
import pkg from "../package.json"

const mobilePlatform: Platform = {
  platform: "mobile" as const, // New platform type
  version: pkg.version,

  openLink(url: string) {
    void shellOpen(url).catch(() => undefined)
  },

  storage: (name = "default.dat") => {
    // Reuse the exact AsyncStorage implementation from packages/desktop/src/index.tsx
    // so persisted stores (server.v4, notification.v1, etc.) behave identically.
    const api: AsyncStorage = {
      // ... (copy implementation, no stub)
    }
    return api
  },

  restart: async () => {
    // Mobile apps don't restart - reload webview
    window.location.reload()
  },

  notify: async (title, description, href) => {
    // Use Tauri notification plugin
    // Implementation depends on plugin availability
  },

  // Mobile-specific: No directory picker (use server-side browse)
  // Mobile-specific: No file picker (limited)
  // Mobile-specific: No updater (app store)

  fetch: tauriFetch as typeof fetch,
}

export function MobileApp() {
  return (
    <PlatformProvider value={mobilePlatform}>
      <App />
    </PlatformProvider>
  )
}
```

**Reference Files:**
- `packages/desktop/src/index.tsx:1-207`
- `packages/app/src/context/platform.tsx:1-58`

#### 4.2 Update Platform Type and Branches

- [ ] Update `packages/app/src/context/platform.tsx` to include `"mobile"` in the platform union.
- [ ] Extend the `Window.__SHUVCODE__` type in `packages/app/src/app.tsx` to include `serverUrl?: string` for mobile server injection.
- [ ] Audit platform branches (for example, `platform.platform === "desktop"` in `packages/app/src/pages/session.tsx`) and define mobile behavior. Default to web behavior unless a mobile-specific override is required.
- [ ] Keep directory/file picker APIs undefined on mobile so browse buttons are hidden in `DialogCreateProject`.

```tsx
export type Platform = {
  /** Platform discriminator */
  platform: "web" | "desktop" | "mobile"
  // ... rest unchanged
}

declare global {
  interface Window {
    __SHUVCODE__?: { updaterEnabled?: boolean; port?: number; serverUrl?: string }
  }
}
```

#### 4.3 Create Mobile Entry Point

- [ ] Create `packages/desktop/src/mobile-entry.tsx` that resolves the mobile server URL via `invoke("get_server_url")`, injects it into `window.__SHUVCODE__`, then renders `MobileApp`.
- [ ] Ensure this runs before `App` renders so `defaultServerUrl` can read `window.__SHUVCODE__.serverUrl`.
- [ ] If top-level await is not supported by the current build target, wrap the initialization in an async IIFE before calling `render()`.

```tsx
// Mobile-specific entry point
import { render } from "solid-js/web"
import { invoke } from "@tauri-apps/api/core"
import { MobileApp } from "./mobile"

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) {
  throw new Error("Root element not found")
}

const serverUrl = await invoke<string>("get_server_url").catch(() => "")
if (serverUrl) {
  window.__SHUVCODE__ = { ...(window.__SHUVCODE__ ?? {}), serverUrl }
}

render(() => <MobileApp />, root)
```

#### 4.4 Configure Vite/HTML for Mobile

- [ ] Validate how `@opencode-ai/app/vite` handles entrypoints; prefer reusing `packages/desktop/index.html` to preserve the theme preload script and current meta tags.
- [ ] If a separate HTML entry is required, duplicate `packages/desktop/index.html` to `packages/desktop/mobile.html` and keep the `oc-theme-preload-script` and existing meta tags. Only then update `packages/desktop/vite.config.ts` to point to the alternate HTML.

### Phase 5: Server Connection Strategy

#### 5.1 Remote Server Configuration (reuse existing server flow)

For the initial mobile release, the app will act as a remote-server client and reuse the existing server selection/persistence system:

- [ ] Inject the mobile default server URL via `window.__SHUVCODE__.serverUrl` (set in the mobile entry) and update `defaultServerUrl` in `packages/app/src/app.tsx` to check this before localhost/origin.
- [ ] Reuse `ServerProvider` persistence (`server.v4`) and `DialogSelectServer` for adding/switching servers (no mobile-only server dialog).
- [ ] Confirm health checks and requests use `platform.fetch` so Tauri's HTTP plugin is respected on mobile.

```tsx
// packages/app/src/app.tsx
const defaultServerUrl = iife(() => {
  if (window.__SHUVCODE__?.serverUrl) return window.__SHUVCODE__.serverUrl
  // existing resolution logic...
})
```

#### 5.2 Mobile UX for Remote Filesystem

- [ ] Update copy in `DialogCreateProject` to clarify that browsing/creating projects happens on the connected server filesystem when running on mobile.
- [ ] Keep `platform.openDirectoryPickerDialog` undefined on mobile so the Browse buttons remain hidden (already gated by `Show when={platform.openDirectoryPickerDialog}`).
- [ ] Confirm `StatusBar` is visible on mobile (PWA hiding logic should not apply) so `DialogSelectServer` remains reachable.
- [ ] Document the authentication flow for remote servers (OAuth/deep link if required).

### Phase 6: Build & Test Infrastructure

#### 6.1 Android Development Setup

- [ ] Document Android SDK requirements:
  - Android Studio
  - Android SDK (API 24+)
  - NDK (for Rust compilation)
  - Java 17+

- [ ] Add npm scripts to `packages/desktop/package.json`:

```json
{
  "scripts": {
    "android:init": "tauri android init",
    "android:dev": "tauri android dev",
    "android:build": "tauri android build",
    "android:build:apk": "tauri android build --apk",
    "android:build:aab": "tauri android build --aab"
  }
}
```

#### 6.2 iOS Development Setup

- [ ] Document iOS development requirements:
  - macOS
  - Xcode 14+
  - Apple Developer account
  - iOS Simulator or device

- [ ] Add npm scripts:

```json
{
  "scripts": {
    "ios:init": "tauri ios init",
    "ios:dev": "tauri ios dev",
    "ios:build": "tauri ios build"
  }
}
```

#### 6.3 Rust Target Installation

- [ ] Document required Rust targets:

```bash
# Android targets
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
rustup target add i686-linux-android
rustup target add x86_64-linux-android

# iOS targets
rustup target add aarch64-apple-ios
rustup target add x86_64-apple-ios
rustup target add aarch64-apple-ios-sim
```

### Phase 7: CI/CD Integration

#### 7.1 Android Build Workflow

- [ ] Create `.github/workflows/mobile-android.yml`:

```yaml
name: Android Build

on:
  push:
    tags:
      - 'android-v*'
  workflow_dispatch:

jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
        
      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
        working-directory: packages/desktop
      
      - name: Build Android
        run: bun tauri android build --apk
        working-directory: packages/desktop
      
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: android-apk
          path: packages/desktop/src-tauri/gen/android/app/build/outputs/apk/
```

#### 7.2 iOS Build Workflow

- [ ] Create `.github/workflows/mobile-ios.yml`:

```yaml
name: iOS Build

on:
  push:
    tags:
      - 'ios-v*'
  workflow_dispatch:

jobs:
  build-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Xcode
        uses: maxim-lobanov/setup-xcode@v1
        with:
          xcode-version: latest-stable
      
      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: aarch64-apple-ios,aarch64-apple-ios-sim
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
        working-directory: packages/desktop
      
      - name: Build iOS
        run: bun tauri ios build
        working-directory: packages/desktop
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
```

### Phase 8: Testing Strategy

#### 8.1 Automated Tests

- [ ] Add tests (or a minimal harness) for `defaultServerUrl` resolution and server persistence behavior. If no frontend test harness exists, document why and rely on manual validation.

#### 8.2 Manual Testing Checklist

- [ ] **App Launch**
  - [ ] App launches without crash
  - [ ] Server connection established
  - [ ] Server selection dialog opens and persists choice
  - [ ] Login/authentication works

- [ ] **Session Management**
  - [ ] Create new session
  - [ ] View session list
  - [ ] Switch between sessions
  - [ ] Delete session

- [ ] **Chat Interface**
  - [ ] Send message
  - [ ] View AI response
  - [ ] Code blocks render correctly
  - [ ] Markdown formatting works

- [ ] **Mobile UI**
  - [ ] Mobile sidebar works (drawer)
  - [ ] Pull-to-refresh works
  - [ ] Keyboard visibility handled
  - [ ] Safe area insets correct
  - [ ] Orientation changes handled

- [ ] **Offline Behavior**
  - [ ] Graceful error on no connection
  - [ ] Reconnection when network restored
  - [ ] No offline usage in MVP unless embedded server is implemented

#### 8.3 Platform-Specific Testing

**Android:**
- [ ] Back button behavior
- [ ] Recent apps thumbnail
- [ ] Local notifications (non-push)
- [ ] Deep linking

**iOS:**
- [ ] Home indicator handling
- [ ] Dynamic Island compatibility
- [ ] Face ID/Touch ID (if applicable)
- [ ] Local notifications (non-push)

### Phase 9: App Store Preparation

#### 9.1 Android Play Store

- [ ] Create signing keystore
- [ ] Configure `build.gradle.kts` for release signing
- [ ] Prepare Play Store listing:
  - App name: "shuvcode"
  - Short description
  - Full description
  - Screenshots (phone, tablet)
  - Feature graphic
  - Privacy policy URL

#### 9.2 iOS App Store

- [ ] Apple Developer account setup
- [ ] App Store Connect configuration
- [ ] Prepare App Store listing:
  - App name
  - Description
  - Keywords
  - Screenshots (all required sizes)
  - Privacy policy URL
  - App Privacy labels

## External References

### Tauri Mobile Documentation

- https://v2.tauri.app/start/prerequisites/ - Setup requirements
- https://v2.tauri.app/develop/configuration-files/ - Config structure
- https://v2.tauri.app/reference/cli/ - CLI commands (`tauri android`, `tauri ios`)
- https://v2.tauri.app/security/capabilities/ - Mobile capabilities
- https://v2.tauri.app/security/permissions/ - Permission system
- https://v2.tauri.app/develop/plugins/develop-mobile/ - Mobile plugin development
- https://v2.tauri.app/distribute/sign/android/ - Android signing

### Example Tauri Mobile Projects

- https://github.com/tauri-apps/cargo-mobile2 - cargo-mobile2 tool
- https://github.com/jbilcke/latent-browser - Example mobile Tauri app
- https://github.com/readest/readest - Production Tauri mobile app
- https://github.com/EasyTier/EasyTier - Cross-platform including mobile

### Tauri Plugins

- https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins - Official plugins
- Notable mobile-compatible plugins:
  - `tauri-plugin-http` - Network requests
  - `tauri-plugin-notification` - Local/system notifications (non-push)
  - `tauri-plugin-store` - Key-value storage
  - `tauri-plugin-os` - OS information
  - `tauri-plugin-dialog` - File dialogs (limited on mobile)

## Internal File References

### Core Files to Modify

| File | Purpose | Changes Required |
|------|---------|------------------|
| `packages/desktop/src-tauri/src/lib.rs` | Tauri app entry | Split desktop vs mobile boot; gate sidecar/plugins |
| `packages/desktop/src-tauri/Cargo.toml` | Rust deps | Target-specific deps for mobile vs desktop |
| `packages/desktop/src-tauri/tauri.conf.json` | App config | Shared identifiers/defaults |
| `packages/desktop/src-tauri/tauri.prod.conf.json` | Prod config | Desktop-only updater config; avoid mobile |
| `packages/desktop/src-tauri/capabilities/default.json` | Desktop permissions | Keep desktop capabilities separate |
| `packages/desktop/vite.config.ts` | Vite config | Optional entrypoint adjustments (validate plugin) |
| `packages/desktop/index.html` | HTML template | Preserve theme preload if duplicated for mobile |
| `packages/desktop/package.json` | NPM scripts | Mobile build commands |
| `packages/app/src/app.tsx` | App bootstrap | `defaultServerUrl` mobile hook + `__SHUVCODE__` typing |
| `packages/app/src/pages/session.tsx` | Platform layout | Confirm mobile vs desktop branching |
| `packages/app/src/context/server.tsx` | Server state | Reuse persisted server list on mobile |
| `packages/app/src/components/dialog-select-server.tsx` | Server UI | Reuse for mobile server selection |
| `packages/app/src/context/platform.tsx` | Platform types | Add "mobile" type |

### Files to Create

| File | Purpose |
|------|---------|
| `packages/desktop/src/mobile.tsx` | Mobile platform implementation |
| `packages/desktop/src/mobile-entry.tsx` | Mobile entry point |
| `packages/desktop/mobile.html` | Mobile HTML template (optional) |
| `packages/desktop/src-tauri/capabilities/mobile.json` | Mobile capabilities |
| `packages/desktop/src-tauri/src/mobile.rs` | Mobile Rust commands |
| `packages/desktop/src-tauri/tauri.android.conf.json` | Android config overrides |
| `packages/desktop/src-tauri/tauri.ios.conf.json` | iOS config overrides |
| `.github/workflows/mobile-android.yml` | Android CI |
| `.github/workflows/mobile-ios.yml` | iOS CI |

### Existing PWA Mobile Components (Reuse)

| File | What to Reuse |
|------|---------------|
| `packages/app/src/components/mobile-terminal-input.tsx` | Terminal keyboard bridge |
| `packages/app/src/components/pull-to-refresh.tsx` | Pull gesture handler |
| `packages/app/src/hooks/use-keyboard-visibility.tsx` | Keyboard detection |
| `packages/app/src/context/layout.tsx` | mobileSidebar state |
| `packages/app/src/pages/session.tsx` | Mobile tabs, mobileReview |
| `packages/app/src/index.css` | Safe area CSS variables |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Sidecar not possible on mobile | High | Certain | Remote server architecture |
| Remote server UX mismatch with local filesystem | Medium | Medium | Update UI copy/flows; hide local browse controls on mobile |
| Server URL resolution/persistence regressions | Medium | Medium | Integrate with `ServerProvider` + add tests for `defaultServerUrl` |
| Performance issues | Medium | Medium | Profile and optimize, reduce bundle |
| App Store rejection | High | Low | Follow guidelines, thorough testing |
| Terminal depends on remote PTY | Medium | Medium | Require healthy remote server; document no offline support |
| iOS signing complexity | Low | Medium | Document process, use CI |

## Success Criteria

1. **MVP (Phase 1-5):**
   - [ ] App builds for Android and iOS
   - [ ] Connects to remote shuvcode server and passes health checks
   - [ ] Server selection persists via `ServerProvider` (`server.v4`)
   - [ ] Basic chat functionality works
   - [ ] Mobile UI renders correctly, with remote filesystem copy in project flows
   - [ ] Offline mode shows clear error messaging (no offline support in MVP)

2. **Beta (Phase 6-7):**
   - [ ] CI builds working
   - [ ] Internal testing complete
   - [ ] Performance acceptable

3. **Release (Phase 8-9):**
   - [ ] All manual tests pass
   - [ ] App Store listings prepared
   - [ ] First public release

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Init | 1-2 days | None |
| Phase 2: Rust | 2-3 days | Phase 1 |
| Phase 3: Capabilities | 1 day | Phase 2 |
| Phase 4: Frontend | 2-3 days | Phase 2 |
| Phase 5: Server | 1-2 days | Phase 4 |
| Phase 6: Build | 2-3 days | Phase 5 |
| Phase 7: CI | 2-3 days | Phase 6 |
| Phase 8: Testing | 3-5 days | Phase 7 |
| Phase 9: Release | 2-5 days | Phase 8 |

**Total Estimate:** 3-4 weeks for MVP, 5-6 weeks for full release

## Future Enhancements

After initial release, consider:

1. **Embedded Server (Long-term)**
   - Compile opencode core to static lib
   - FFI bridge to Rust
   - True offline capability

2. **Git Integration**
   - Clone repos to device
   - Commit and push support
   - SSH key management

3. **Voice Input**
   - Speech-to-text for prompts
   - Hands-free operation

4. **Widgets**
   - iOS widgets for quick access
   - Android app shortcuts

5. **Watch Companion**
   - Apple Watch notifications
   - Wear OS integration
