## Plan Overview
Address two open bugs: PWA safe-area/scroll regressions (issue #264) and plugin audio asset bundling (issue #266). This plan captures current code context, decision points from issues, external references, and a sequenced task list with validation steps.

**Revision Note (v1):** This plan has been revised based on codebase review to address CSS selector mismatches, missing implementation details, and PWA detection gaps.

**Revision Note (v2 - 2026-01-06):** Plan reviewed against codebase. Added explicit directory creation, single-file plugin handling, PullToRefresh refactor details, and additional audio formats.

## Source Issues
| Issue | Title | Link | Acceptance Criteria (abridged) |
| --- | --- | --- | --- |
| #264 | fix(pwa): Menu button hidden behind Dynamic Island and viewport scrolling not locked on iOS PWA | https://github.com/Latitudes-Dev/shuvcode/issues/264 | Menu buttons visible below Dynamic Island; session viewport locked; consistent PWA behavior; no desktop regressions; works on Dynamic Island + notch devices; Android pull-to-refresh regression noted in comment. |
| #266 | Plugin bundling doesn't copy audio files (.wav) breaking opencode-notifier sounds | https://github.com/Latitudes-Dev/shuvcode/issues/266 | Bundling copies audio assets; sounds work; assets discoverable relative to bundled plugin dir; likely include other audio formats. |

## Context Capture and Decisions
### Issue #266 (Plugin audio assets)
- Bundled plugins are built with `Bun.build()` in `packages/opencode/src/bun/index.ts`.
- Non-JS assets are copied via `copyPluginAssets()` but only for a limited extension list (no audio).
- `copyPluginAssets()` currently flattens paths via `path.basename(entry)` which drops subdirectory structure (`bun/index.ts:235`).
- `@mohak34/opencode-notifier` resolves sounds via `__dirname/../sounds/*.wav`, so flattening + missing `.wav` results in missing files after bundling.
- Bundled assets are copied to both the package bundle directory and `Global.Path.cache` for runtime resolution.
- **GAP IDENTIFIED:** Local plugin bundling in `packages/opencode/src/plugin/index.ts:25-79` (`bundleLocalPlugin()`) does NOT call any asset copy logic after bundling.
- **GAP IDENTIFIED:** Local plugin bundling only has an entry file path; asset copying needs a reliable plugin root (for `sounds/` and similar directories).

Decisions:
- Expand `assetExtensions` to include audio formats (`.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`) AND video/font formats for future-proofing (`.mp4`, `.webm`, `.woff`, `.woff2`, `.ttf`).
- Preserve plugin directory structure when copying assets (use the relative entry path, not `basename`).
- Ensure the copy logic creates parent directories before writing nested files using `Bun.$\`mkdir -p\``.
- **CONFIRMED:** Local `file://` plugins MUST also get asset copying. Extract `copyPluginAssets()` to a shared utility at `packages/opencode/src/util/asset-copy.ts`.
- Resolve a local plugin root before copying assets (walk up from the entry file to the nearest `package.json`, fallback to `path.dirname(filePath)`).
- Copy local plugin assets into both the bundled-local output directory and `Global.Path.cache` to preserve `__dirname/..` resolution parity with npm bundles.
- Guard against unsafe paths or symlinks in asset copying (skip entries that escape `pluginDir` or are symlinks, if detectable).
- Collision risk: assets are copied into shared dirs (`bundled`, `bundled-local`, `Global.Path.cache`). Keep this for compatibility, but log when overwriting an existing asset to surface conflicts.

### Issue #264 (PWA safe area + viewport locking)
- Home menu button is absolutely positioned at `top-0 left-0 p-2` without safe-area offset in `packages/app/src/pages/home.tsx:35-41`.
- **CRITICAL GAP:** Session header (`packages/app/src/components/session/session-header.tsx:52`) does NOT have `data-tauri-drag-region` attribute, but existing CSS rule at `index.css:109-112` targets `header[data-tauri-drag-region]`. The CSS selector does not match.
- PWA-related safe area variables are defined in `packages/app/src/index.css:8-11`.
- `isPWA()` already exists in `packages/app/src/context/platform.tsx:5-11` and can be reused.
- Mobile pages use `PullToRefresh` wrapper in `packages/app/src/pages/layout.tsx:1177-1179` which can trigger pull-to-refresh. The issue comment notes Android refresh on downward swipe.
- **GAP IDENTIFIED:** `PullToRefresh` component has no mechanism to detect PWA standalone mode.
- Session view has scroll container at `packages/app/src/pages/session.tsx:906` with class `overflow-y-auto no-scrollbar` but no `overscroll-behavior` constraint.

Decisions:
- Use the existing `isPWA()` in `packages/app/src/context/platform.tsx` instead of adding a new utility.
- Keep PWA styling based on `@media (display-mode: standalone)` (avoid `data-pwa` attributes that would add another detection path).
- Add `.home-menu-button` and `.session-scroll-container` classes and extend existing PWA media-query rules in `index.css`.
- Add `data-tauri-drag-region` to the session header so the existing PWA safe-area rule applies.
- Keep the mobile scroll container from `PullToRefresh` but disable refresh behavior in PWA mode (add a prop or internal PWA check instead of removing the wrapper).

## External References (for asset copy patterns)
- https://github.com/mohak34/opencode-notifier (plugin using `sounds/*.wav`)
- https://github.com/jadujoel/bun-copy-plugin (Bun build copy plugin reference)
- https://github.com/noriyotcp/esbuild-plugin-just-copy (asset copy with preserved paths)

## Relevant Internal Files
| File | Purpose | Key Lines |
| --- | --- | --- |
| `packages/opencode/src/bun/index.ts` | npm plugin bundling | `copyPluginAssets()` at L224-253, `assetExtensions` at L226 |
| `packages/opencode/src/plugin/index.ts` | local plugin bundling | `bundleLocalPlugin()` at L25-79 (missing asset copy) |
| `packages/app/src/pages/home.tsx` | home page with menu button | Menu button at L35-41 (`top-0 left-0`) |
| `packages/app/src/components/session/session-header.tsx` | session header | Header at L52 (missing `data-tauri-drag-region`) |
| `packages/app/src/pages/session.tsx` | session view | Scroll container at L906 |
| `packages/app/src/pages/layout.tsx` | layout with PullToRefresh | PullToRefresh wrapper at L1177-1179 |
| `packages/app/src/components/pull-to-refresh.tsx` | pull-to-refresh component | Scroll container + refresh logic |
| `packages/app/src/context/platform.tsx` | platform utils | `isPWA()` at L5-11 |
| `packages/app/src/index.css` | PWA CSS rules | Safe-area vars L8-11, PWA rules L90-121 |
| `packages/app/index.html` | HTML entry | Body classes at L27 |

## Technical Specifications

### Plugin Asset Bundling (Issue #266)

#### Asset Extensions (Expanded)
```ts
const ASSET_EXTENSIONS = [
  // Existing
  ".html", ".css", ".json", ".txt", ".svg", ".png", ".jpg", ".gif",
  // Audio (new)
  ".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".webm",
  // Video (new - future-proofing)
  ".mp4", ".webm", ".mov",
  // Fonts (new - future-proofing)
  ".woff", ".woff2", ".ttf", ".otf"
]
```

**Note:** Use `ASSET_EXTENSIONS` (uppercase) for the shared constant to distinguish from local variables.

#### Directory Structure Preservation
**Current (broken):**
```ts
// packages/opencode/src/bun/index.ts:235
const destPath = path.join(destDir, path.basename(entry))  // Drops directory
await Bun.write(destPath, content)  // No mkdir for nested paths
```

**Fixed:**
```ts
const destPath = path.join(destDir, entry)  // Preserve relative path
await Bun.$`mkdir -p ${path.dirname(destPath)}`  // Create parent dirs
await Bun.write(destPath, content)
```

#### Shared Asset Copy Utility
Create `packages/opencode/src/util/asset-copy.ts`:
```ts
import path from "path"
import fs from "fs"
import { Log } from "./log"

const log = Log.create({ service: "asset-copy" })

export const ASSET_EXTENSIONS = [
  ".html", ".css", ".json", ".txt", ".svg", ".png", ".jpg", ".gif",
  ".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac",
  ".mp4", ".webm", ".mov",
  ".woff", ".woff2", ".ttf", ".otf"
]

/**
 * Copy non-JS assets from a plugin directory to target directory.
 * Preserves directory structure (e.g., sounds/alerts/beep.wav).
 * 
 * @param pluginDir - Root directory to scan for assets (must be resolved)
 * @param targetDir - Destination directory
 */
export async function copyPluginAssets(pluginDir: string, targetDir: string) {
  const entries = await Array.fromAsync(
    new Bun.Glob("**/*").scan({ cwd: pluginDir, dot: false })
  )

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase()
    if (!ASSET_EXTENSIONS.includes(ext)) continue

    const srcPath = path.join(pluginDir, entry)
    const destPath = path.join(targetDir, entry)  // Preserve structure

    // Security: Skip entries that escape pluginDir via symlinks or path traversal
    const realSrcPath = await fs.promises.realpath(srcPath).catch(() => null)
    if (!realSrcPath || !realSrcPath.startsWith(await fs.promises.realpath(pluginDir))) {
      log.warn("skipping asset outside plugin directory", { src: entry })
      continue
    }

    try {
      // CRITICAL: Create parent directories before writing nested files
      const destDir = path.dirname(destPath)
      await Bun.$`mkdir -p ${destDir}`.quiet()

      // Log if overwriting existing file
      const exists = await Bun.file(destPath).exists()
      if (exists) {
        log.info("overwriting existing plugin asset", { dest: destPath })
      }

      const content = await Bun.file(srcPath).arrayBuffer()
      await Bun.write(destPath, content)
      log.info("copied plugin asset", { src: entry, dest: destPath })
    } catch (e) {
      log.error("failed to copy plugin asset", {
        src: srcPath,
        dest: destPath,
        error: (e as Error).message,
      })
    }
  }
}

/**
 * Resolve the root directory of a local plugin.
 * Walks up from the entry file to find nearest package.json.
 * Falls back to the entry file's directory for single-file plugins.
 * 
 * @param entryFilePath - Absolute path to the plugin entry file
 * @returns Resolved plugin root directory
 */
export async function resolvePluginRoot(entryFilePath: string): Promise<string> {
  let dir = path.dirname(entryFilePath)
  const root = path.parse(dir).root

  while (dir !== root) {
    const pkgPath = path.join(dir, "package.json")
    if (await Bun.file(pkgPath).exists()) {
      return dir
    }
    dir = path.dirname(dir)
  }

  // Fallback for single-file plugins without package.json
  return path.dirname(entryFilePath)
}
```

**Implementation Notes:**
- `pluginDir` should be resolved via `resolvePluginRoot()` for local plugins
- Security: Uses `fs.promises.realpath()` to detect symlink escapes
- Collision detection: Logs when overwriting existing assets
- Directory creation: Uses `mkdir -p` BEFORE `Bun.write()` for nested paths
- Single-file plugins: Falls back to entry file's directory when no package.json exists

### PWA Safe Area + Viewport Locking (Issue #264)

#### PWA Detection Utility (existing)
Use the existing helper in `packages/app/src/context/platform.tsx`:
```ts
export function isPWA(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-ignore - iOS Safari specific
    window.navigator.standalone === true
  )
}
```

#### Home Menu Button Fix
**File:** `packages/app/src/pages/home.tsx:35-41`

**Current:**
```tsx
<div class="xl:hidden absolute top-0 left-0 p-2">
```

**Fixed (CSS-based for consistency):**
```tsx
<div class="xl:hidden absolute left-0 p-2 top-0 home-menu-button">
```

#### Session Header Fix
**File:** `packages/app/src/components/session/session-header.tsx:52`

**Current:**
```tsx
<header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base flex">
```

**Fixed (match existing CSS selector):**
```tsx
<header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base flex" data-tauri-drag-region>
```

#### CSS Rules (PWA-specific)
**File:** `packages/app/src/index.css` - Extend the existing `@media (display-mode: standalone)` block:

```css
@media (display-mode: standalone) {
  /* Existing header[data-tauri-drag-region] rule remains; ensure SessionHeader has the attribute */
  .home-menu-button {
    top: var(--safe-area-inset-top);
  }

  .session-scroll-container {
    overscroll-behavior: contain;
  }
}
```

#### Session Scroll Container Fix
**File:** `packages/app/src/pages/session.tsx:906`

**Current:**
```tsx
class="relative min-w-0 w-full h-full overflow-y-auto no-scrollbar"
```

**Fixed:**
```tsx
class="relative min-w-0 w-full h-full overflow-y-auto no-scrollbar session-scroll-container"
```

#### PullToRefresh Guard
**File:** `packages/app/src/pages/layout.tsx:1177-1179`

**Current:**
```tsx
<div class="contents sm:hidden">
  <PullToRefresh>{props.children}</PullToRefresh>
</div>
```

**Fixed (keep scroll container, disable refresh):**
```tsx
import { isPWA } from "@/context/platform"

// In component:
const pwaMode = isPWA()

// In render:
<div class="contents sm:hidden">
  <PullToRefresh enabled={!pwaMode}>{props.children}</PullToRefresh>
</div>
```

**PullToRefresh component change (`packages/app/src/components/pull-to-refresh.tsx`):**
```tsx
export function PullToRefresh(props: ParentProps<{ enabled?: boolean }>) {
  // ... existing signals ...
  
  // Reactive enabled check
  const enabled = () => props.enabled !== false

  const handleTouchStart = (e: TouchEvent) => {
    if (!enabled()) return  // Early return when disabled
    if (isRefreshing()) return
    if (!canPull()) return
    // ... rest of handler
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!enabled()) return  // Early return when disabled
    if (!isPulling() || isRefreshing()) return
    // ... rest of handler
  }

  const handleTouchEnd = async () => {
    if (!enabled()) return  // Early return when disabled
    if (!isPulling()) return
    // ... rest of handler
  }

  // Note: Touch event listeners remain attached for scroll containment
  // The enabled() guard prevents refresh behavior without removing listeners
}
```

**Why keep listeners attached:** The scroll container behavior (`overflow-y-auto`, `contain-strict`) should remain even when refresh is disabled. Only the pull-to-refresh gesture handling is guarded.

### API/Config/Integration Points
- API endpoints: None added/changed.
- Config: `opencode.json` plugin list remains unchanged.
- Integration points:
  - `copyPluginAssets()` moved to `packages/opencode/src/util/asset-copy.ts` (shared utility).
  - Called from `packages/opencode/src/bun/index.ts` for npm plugins.
  - Called from `packages/opencode/src/plugin/index.ts` for local plugins (after resolving plugin root).
  - Reuse `isPWA()` from `packages/app/src/context/platform.tsx` in layout.
  - `PullToRefresh` accepts an `enabled` prop to keep scroll container while disabling refresh.
  - PWA CSS in `packages/app/src/index.css`.

## Option Comparison (Asset Copy Strategy)
| Option | Summary | Pros | Cons | Decision |
| --- | --- | --- | --- | --- |
| Extend existing `copyPluginAssets()` | Update extensions + preserve directory structure | Minimal change, consistent with current bundling | Still manual copy logic | **SELECTED** |
| Introduce external copy helper/plugin | Use a bundler copy plugin | Potentially reusable | Adds dependency/config | Rejected |

## Implementation Order and Milestones

### Milestone 1: Fix plugin audio asset bundling (#266)
- [ ] Create shared utility `packages/opencode/src/util/asset-copy.ts`:
  - Export `ASSET_EXTENSIONS` constant with audio, video, font formats
  - Export `copyPluginAssets(pluginDir, targetDir)` with directory preservation
  - Export `resolvePluginRoot(entryFilePath)` to find nearest package.json or fallback
  - Include symlink/path traversal security checks via `fs.promises.realpath()`
  - Log overwrites when copying to shared target directories
- [ ] Update `packages/opencode/src/bun/index.ts`:
  - Import `{ copyPluginAssets, ASSET_EXTENSIONS }` from shared utility
  - Remove inline `copyPluginAssets` function and `assetExtensions` array
  - Preserve existing call sites: `copyPluginAssets(mod, bundledDir)` and `copyPluginAssets(mod, Global.Path.cache)`
- [ ] Update `packages/opencode/src/plugin/index.ts` `bundleLocalPlugin()`:
  - Import `{ copyPluginAssets, resolvePluginRoot }` from shared utility
  - After successful `Bun.build()`, resolve plugin root: `const pluginRoot = await resolvePluginRoot(absolutePath)`
  - Call `copyPluginAssets(pluginRoot, bundledDir)` for assets
  - Call `copyPluginAssets(pluginRoot, Global.Path.cache)` for runtime resolution parity
- [ ] Add tests in `packages/opencode/test/asset-copy.test.ts`:
  - Test audio file copying (`.wav`, `.mp3`, `.ogg`)
  - Test nested directory preservation (`sounds/alerts/beep.wav` → `targetDir/sounds/alerts/beep.wav`)
  - Test `resolvePluginRoot` with package.json present
  - Test `resolvePluginRoot` fallback for single-file plugins (no package.json)
  - Test symlink/path traversal entries are skipped
  - Test overwrite logging when file already exists

### Milestone 2: PWA safe area and viewport locking (#264)
- [ ] Reuse `isPWA()` from `packages/app/src/context/platform.tsx` in layout (no new utility file).
- [ ] Add `.home-menu-button` class to menu button in `packages/app/src/pages/home.tsx:35`.
- [ ] Add `data-tauri-drag-region` to the session header in `packages/app/src/components/session/session-header.tsx:52`.
- [ ] Add `.session-scroll-container` class to scroll container in `packages/app/src/pages/session.tsx:906`.
- [ ] Extend PWA CSS rules in `packages/app/src/index.css`:
  - `.home-menu-button` top offset
  - `.session-scroll-container` overscroll-behavior
  - Keep existing `header[data-tauri-drag-region]` safe-area rule
- [ ] Update `packages/app/src/components/pull-to-refresh.tsx` to accept an `enabled` prop and guard refresh behavior.
- [ ] Update `packages/app/src/pages/layout.tsx` to pass `enabled={!isPWA()}` to `PullToRefresh` while preserving the scroll wrapper.
- [ ] Verify `#root`/body sizing still uses `h-dvh` and `min-height` values appropriate for iOS PWA.

### Milestone 3: Validation and regression checks
- [ ] Run `bun test` in `packages/opencode` (new asset copy tests).
- [ ] Run `bun turbo test` at repo root for full test suite.
- [ ] Manually verify iOS PWA on Dynamic Island device (iPhone 14+).
- [ ] Manually verify iOS PWA on notch device (iPhone X-13).
- [ ] Manually verify Android PWA pull-down behavior in session view.
- [ ] Verify no desktop/browser regressions for menu placement and scrolling.
- [ ] Verify `@mohak34/opencode-notifier` sounds play correctly.

## Validation Criteria

### Automated
- `bun test` in `packages/opencode` passes (new asset copy tests).
- `bun turbo test` at repo root passes.
- TypeScript compilation succeeds for both `opencode` and `app` packages.

### Manual
- `@mohak34/opencode-notifier` plays sounds after bundling with audio assets copied.
- Home and session menu buttons are fully visible below the Dynamic Island in PWA standalone mode.
- Session view does not allow scrolling past content into blank space in PWA standalone mode.
- Android PWA swipe-down does not refresh the page when scrolling back up in session view.
- Non-PWA mobile still scrolls correctly and pull-to-refresh behavior remains unchanged.
- Desktop browser shows no visual regressions in header/menu positioning.

### Manual Test Steps
```bash
# Issue #266: Plugin asset bundling
# Clear bundled plugin cache for notifier
rm -rf ~/.cache/opencode/bundled/*mohak34*
rm -rf ~/.cache/opencode/bundled-local/*

# Launch opencode/shuvcode and install notifier plugin
# Trigger notification events and verify sounds play

# Verify directory structure preserved
ls -la ~/.cache/opencode/bundled/
# Should show: mohak34-opencode-notifier.js AND sounds/ directory with .wav files
```

```bash
# Issue #264: PWA testing
# iOS: Add to Home Screen from Safari, launch as PWA
# - Verify menu button not obscured by Dynamic Island
# - Verify session header not obscured
# - Verify session scroll doesn't overscroll to blank space

# Android: Add to Home Screen from Chrome, launch as PWA
# - Verify pull-down in session view doesn't trigger refresh
#
# Non-PWA mobile browser:
# - Verify session view still scrolls and pull-to-refresh behavior is unchanged
```

## File Changes Summary

| File | Change Type | Description |
| --- | --- | --- |
| `packages/opencode/src/util/asset-copy.ts` | **NEW** | Shared asset copy utility: `ASSET_EXTENSIONS`, `copyPluginAssets()`, `resolvePluginRoot()` |
| `packages/opencode/src/bun/index.ts` | MODIFY | Import shared utility, remove inline `copyPluginAssets` and `assetExtensions` |
| `packages/opencode/src/plugin/index.ts` | MODIFY | Import `resolvePluginRoot`, call `copyPluginAssets()` after `bundleLocalPlugin()` |
| `packages/opencode/test/asset-copy.test.ts` | **NEW** | Tests for asset copying, directory preservation, plugin root resolution, security |
| `packages/app/src/pages/home.tsx` | MODIFY | Add `.home-menu-button` class |
| `packages/app/src/components/session/session-header.tsx` | MODIFY | Add `data-tauri-drag-region` attribute |
| `packages/app/src/pages/session.tsx` | MODIFY | Add `.session-scroll-container` class |
| `packages/app/src/components/pull-to-refresh.tsx` | MODIFY | Add `enabled` prop, guard touch handlers with early returns |
| `packages/app/src/pages/layout.tsx` | MODIFY | Import `isPWA`, pass `enabled={!isPWA()}` to `PullToRefresh` |
| `packages/app/src/index.css` | MODIFY | Extend PWA-specific CSS rules |

## Resolved Questions

| Question | Resolution |
| --- | --- |
| Should audio formats beyond `.wav` be included? | YES - Include `.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`, `.aac` plus video/font formats |
| Should local `file://` plugins get asset copying? | YES - Share `copyPluginAssets()` between `bun/index.ts` and `plugin/index.ts`, copying from resolved plugin root into `bundled-local` and `Global.Path.cache` |
| How to find plugin root for local plugins? | Walk up from entry file to nearest `package.json`. Fallback to `path.dirname(entryFilePath)` for single-file plugins without package.json |
| PWA styling: inline styles vs CSS utilities? | CSS with `@media (display-mode: standalone)` for maintainability |
| How to detect PWA mode in components? | Reuse existing `isPWA()` from `packages/app/src/context/platform.tsx` |
| Should PullToRefresh keep scroll container when disabled? | YES - Only guard refresh gesture, keep scroll containment for consistent UX |
