# Combined Implementation Backlog

Consolidated from plans: #264-266 (PWA/Audio), #268 (AskQuestion), #269 (TUI Transparency), #270 (Bash Spinner), #271 (Web Input Padding)

---

## Issue #271: Web Input Bar Bottom Padding (Low Complexity, ~15-30 min)

- [ ] Edit `packages/app/src/pages/session.tsx:984` - remove `pb-4 md:pb-8` from prompt dock class string
- [ ] Update prompt dock inline style to use `max(1.5rem, env(safe-area-inset-bottom, 0px))` for padding-bottom
- [ ] Verify gradient background (`bg-gradient-to-t`) still displays correctly with increased padding
- [ ] Test on desktop browser (Chrome/Firefox/Safari) at various widths
- [ ] Test on mobile simulator or device (iOS Safari, Chrome Android)
- [ ] Verify input bar has minimum ~24px visible padding from bottom edge on desktop

---

## Issue #268: AskQuestion Tool Dialog Fix (High Severity)

### Phase 0: Required Fixes

- [ ] Add callID validation at start of `packages/opencode/src/tool/askquestion.ts` execute function: throw error if `ctx.callID` is undefined
- [ ] Remove non-null assertions (`!`) at askquestion.ts lines 32 and 40, replace with direct `ctx.callID` usage

### Phase 1: Investigation & Debugging

- [ ] Add debug logging to `packages/opencode/src/tool/askquestion.ts:28` after `ctx.metadata()` call
- [ ] Add debug logging to Web detection memo `packages/app/src/pages/session.tsx:240-268`
- [ ] Add debug logging to TUI detection memo `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:391-418`
- [ ] Verify SSE delivers `PartUpdated` event with correct structure (browser DevTools)
- [ ] Verify `ctx.callID` is defined when askquestion tool executes (log `options.toolCallId` in prompt.ts:659)

### Phase 2: Fix Sync/Reactivity Issues

- [ ] Verify `ctx.metadata()` properly awaits sync propagation in `packages/opencode/src/session/prompt.ts:662-677`
- [ ] If needed: Add explicit sync wait after metadata update (50ms delay or Bus event)

### Phase 3: Fix Detection Logic (If Needed)

- [ ] Verify `toolPart.callID` is available (not undefined) in detection at `session.tsx:260` and `session/index.tsx:409`
- [ ] Verify `toolPart.state.metadata` type matches expected schema

### Phase 4: Server Endpoint Tests

- [ ] Create `packages/opencode/test/server/askquestion.test.ts`
- [ ] Add test: `POST /askquestion/respond` resolves pending request
- [ ] Add test: `POST /askquestion/cancel` rejects pending request
- [ ] Add test: `POST /askquestion/respond` returns 404/500 for unknown callID

### Phase 4: Sync Propagation Tests

- [ ] Create `packages/opencode/test/tool/askquestion-sync.test.ts`
- [ ] Add test: metadata update publishes `PartUpdated` event with correct structure

### Phase 4: Detection Edge Case Tests

- [ ] Extend `packages/opencode/test/tool/askquestion.test.ts` with detection edge cases
- [ ] Add test: detects pending when callID is present
- [ ] Add test: returns null when callID is undefined
- [ ] Add test: ignores when part.state.status is not 'running'
- [ ] Add test: ignores when metadata.status is 'completed'

### Phase 4: Cleanup Tests

- [ ] Add test: cleanup rejects all pending requests for session on abort

### Phase 5: Manual Validation

- [ ] Test in TUI mode: enable `experimental.askquestion_tool`, trigger LLM to use askquestion, verify dialog appears
- [ ] Test in Web mode: desktop and mobile, verify wizard appears
- [ ] Test edge cases: multiple questions, cancel mid-flow, session abort while pending, custom text response
- [ ] Remove debug logging before merge

---

## Issue #266: Plugin Audio Asset Bundling

### Create Shared Utility

- [ ] Create `packages/opencode/src/util/asset-copy.ts`
- [ ] Export `ASSET_EXTENSIONS` constant with: `.html`, `.css`, `.json`, `.txt`, `.svg`, `.png`, `.jpg`, `.gif`, `.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.mp4`, `.webm`, `.mov`, `.woff`, `.woff2`, `.ttf`, `.otf`
- [ ] Export `copyPluginAssets(pluginDir, targetDir)` function with directory structure preservation
- [ ] Export `resolvePluginRoot(entryFilePath)` to find nearest package.json or fallback to dirname
- [ ] Add symlink/path traversal security checks via `fs.promises.realpath()`
- [ ] Add logging for overwrites when copying to shared target directories
- [ ] Ensure `mkdir -p` is called before `Bun.write()` for nested paths

### Update npm Plugin Bundling

- [ ] In `packages/opencode/src/bun/index.ts`: import `{ copyPluginAssets, ASSET_EXTENSIONS }` from shared utility
- [ ] Remove inline `copyPluginAssets` function and `assetExtensions` array from bun/index.ts
- [ ] Preserve existing call sites: `copyPluginAssets(mod, bundledDir)` and `copyPluginAssets(mod, Global.Path.cache)`

### Update Local Plugin Bundling

- [ ] In `packages/opencode/src/plugin/index.ts`: import `{ copyPluginAssets, resolvePluginRoot }` from shared utility
- [ ] After successful `Bun.build()` in `bundleLocalPlugin()`, resolve plugin root: `const pluginRoot = await resolvePluginRoot(absolutePath)`
- [ ] Call `copyPluginAssets(pluginRoot, bundledDir)` for assets
- [ ] Call `copyPluginAssets(pluginRoot, Global.Path.cache)` for runtime resolution parity

### Asset Copy Tests

- [ ] Create `packages/opencode/test/asset-copy.test.ts`
- [ ] Add test: audio file copying (`.wav`, `.mp3`, `.ogg`)
- [ ] Add test: nested directory preservation (`sounds/alerts/beep.wav` -> `targetDir/sounds/alerts/beep.wav`)
- [ ] Add test: `resolvePluginRoot` with package.json present
- [ ] Add test: `resolvePluginRoot` fallback for single-file plugins (no package.json)
- [ ] Add test: symlink/path traversal entries are skipped
- [ ] Add test: overwrite logging when file already exists

---

## Issue #264: PWA Safe Area and Viewport Locking

### Home Menu Button Fix

- [ ] Add `.home-menu-button` class to menu button in `packages/app/src/pages/home.tsx:35`

### Session Header Fix

- [ ] Add `data-tauri-drag-region` attribute to session header in `packages/app/src/components/session/session-header.tsx:52`

### Session Scroll Container Fix

- [ ] Add `.session-scroll-container` class to scroll container in `packages/app/src/pages/session.tsx:906`

### PWA CSS Rules

- [ ] Extend PWA CSS rules in `packages/app/src/index.css`:
  - [ ] Add `.home-menu-button { top: var(--safe-area-inset-top); }` inside `@media (display-mode: standalone)`
  - [ ] Add `.session-scroll-container { overscroll-behavior: contain; }` inside `@media (display-mode: standalone)`
  - [ ] Keep existing `header[data-tauri-drag-region]` safe-area rule

### PullToRefresh Guard

- [ ] Update `packages/app/src/components/pull-to-refresh.tsx` to accept an `enabled` prop
- [ ] Add early return guards to `handleTouchStart`, `handleTouchMove`, `handleTouchEnd` when `enabled()` is false
- [ ] In `packages/app/src/pages/layout.tsx`: import `isPWA` from `@/context/platform`
- [ ] Pass `enabled={!isPWA()}` to `PullToRefresh` component in layout.tsx

### PWA Validation

- [ ] Verify `#root`/body sizing still uses `h-dvh` and appropriate `min-height` values for iOS PWA
- [ ] Manually verify iOS PWA on Dynamic Island device (iPhone 14+)
- [ ] Manually verify iOS PWA on notch device (iPhone X-13)
- [ ] Manually verify Android PWA pull-down behavior in session view
- [ ] Verify no desktop/browser regressions for menu placement and scrolling
- [ ] Verify `@mohak34/opencode-notifier` sounds play correctly after asset bundling

---

## Issue #269: TUI Transparency Toggle Fix

### Milestone 1: Reproduce and Inspect State

- [ ] Reproduce in TUI and log `transparent()` before and after toggling
- [ ] Verify `kv.get("theme_transparent", false)` changes and persists across restart
- [ ] Inspect `resolveTheme` output for `background.a` with multiple themes (Night Owl, Nord, lucent-orng)
- [ ] Confirm that the theme memo re-runs on `setTransparent`
- [ ] Verify that `lucent-orng` theme resolves to alpha=0 even when toggle is off (confirms root cause)

### Milestone 2: Fix Theme Resolution

- [ ] Create `normalizeBackgrounds(resolved, transparent)` helper function in `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- [ ] Implement fallback chain: `backgroundMenu` -> `backgroundElement` -> `backgroundPanel` -> derive from `primary`
- [ ] Handle semi-transparent colors (require alpha=1 for fallback eligibility)
- [ ] For last resort fallback: derive from primary at 10% luminance for dark mode, 95% for light mode
- [ ] Call `normalizeBackgrounds()` at the end of `resolveTheme()` before returning

### Milestone 3: Contrast and Theme UX

- [ ] Re-validate `selectedForeground` behavior with opaque backgrounds
- [ ] Verify selected list item contrast remains readable for Night Owl, Nord, opencode, and lucent-orng themes
- [ ] Test with light mode themes to ensure derived fallback works for both dark and light modes

### Milestone 4: Transparency Tests

- [ ] Add unit tests in `packages/opencode/test/theme.test.ts`
- [ ] Add test: `normalizeBackgrounds` with fully transparent theme
- [ ] Add test: `normalizeBackgrounds` with semi-transparent `backgroundMenu`
- [ ] Add test: `normalizeBackgrounds` fallback derivation from `primary`
- [ ] Add test: full `resolveTheme` with `transparent=false` and lucent-orng fixture
- [ ] Add test: `selectedForeground` verifies readable contrast when transparency is off

### Milestone 5: Manual Validation

- [ ] Toggle transparency on/off in TUI and verify immediate updates
- [ ] Switch themes (Night Owl, Nord, lucent-orng) and verify backgrounds are opaque when toggle is off
- [ ] Restart TUI and confirm the last toggle state is restored
- [ ] Test lucent-orng specifically in both dark and light modes with transparency off

---

## Issue #270: TUI Bash Spinner Stops on Completion

### Milestone 1: Reproduce and Trace State Transitions

- [ ] Reproduce in TUI and confirm the Bash part status after command completion (server-side)
- [ ] Inspect `Bash` component `isRunning` at `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:2088-2152` for reactivity
- [ ] If stale: convert `isRunning` to `createMemo` or inline reactive check
- [ ] Add logging to `packages/opencode/src/session/processor.ts:171-191` (tool-result case) to verify it fires for Bash tool
- [ ] Add logging to `Session.updatePart` to confirm it's called with `status: "completed"`
- [ ] Log when `ctx.metadata` attempts to write after completion

### Milestone 2: Trace Event Delivery and Store Updates

- [ ] Add logging to TUI sync handler when `message.part.updated` is received
- [ ] Add logging when `sync.data.part[messageID]` is updated in the store
- [ ] Identify the TUI component that renders the Bash spinner and trace its props/derivations
- [ ] Confirm the component re-renders on part status change (post `isRunning` fix)

### Milestone 3: Fix Based on Findings

- [ ] Fix Bash spinner reactivity (`isRunning` as memo or inline check)
- [ ] If metadata regression confirmed: Prevent `completed`/`error` -> `running` writes (guard in `Session.updatePart` or `ctx.metadata`)
- [ ] If event not delivering: Fix event stream subscription or reconnection logic
- [ ] If store not updating: Fix Solid.js store update (ensure `produce` or proper setter is used)
- [ ] If part lookup wrong: Fix the part ID/callID matching between processor and TUI

### Milestone 4: Spinner Tests

- [ ] Add a session-level test to verify tool-result -> part status `completed` transition
- [ ] If regression guard added: Add a test that prevents `completed`/`error` -> `running` status downgrade

### Milestone 5: Manual Validation

- [ ] Run a Bash command via the TUI and confirm the spinner stops
- [ ] Verify at least one other tool (Write or Task) still updates correctly
- [ ] Test with both short (<1s) and long (>5s) running commands
- [ ] Test spinner behavior when command errors (non-zero exit)

---

## Final Validation

- [ ] Run `bun test` in `packages/opencode`
- [ ] Run `bun turbo test` at repo root for full test suite
- [ ] TypeScript compilation succeeds for both `opencode` and `app` packages
- [ ] All acceptance criteria verified
- [ ] Debug logging removed from all files
