# Combined Implementation Backlog (Updated for v1.1.4 merge)

Consolidated from plans: #264-266 (PWA/Audio), #268 (AskQuestion), #269 (TUI Transparency), #270 (Bash Spinner), #271 (Web Input Padding)

Notes from codebase alignment:
- `AskQuestionTool` still uses `ctx.callID!` and lacks a guard; `resolveTools()` sets `callID` from `options.toolCallId`.
- `pendingAskQuestion` detection in both web and TUI does not guard for missing `callID`.
- `copyPluginAssets()` currently lives in `packages/opencode/src/bun/index.ts`, flattens asset paths, and copies only a small set of extensions.
- Local plugin bundling in `packages/opencode/src/plugin/index.ts` bundles JS but does not copy assets.
- PWA CSS already exists in `packages/app/src/index.css` and targets `.absolute.inset-x-0.bottom-4`; prompt dock currently uses `bottom-0` and `pb-4 md:pb-8`.
- `PullToRefresh` has no `enabled` prop; `layout.tsx` uses `usePlatform()` but `isPWA()` is defined in `packages/app/src/context/platform.tsx`.
- TUI Bash spinner `isRunning` is a non-reactive constant (`const isRunning = props.part.state.status === "running"`).

---

## Issue #271: Web Input Bar Bottom Padding (Low Complexity, ~15-30 min)

### Implementation
- [x] In `packages/app/src/pages/session.tsx` (prompt dock block), remove `pb-4 md:pb-8` from the dock class string.
- [x] Replace the inline `padding-bottom` style with `max(1.5rem, env(safe-area-inset-bottom, 0px))`.
- [x] Add a stable class or data attribute to the prompt dock (e.g., `data-component="prompt-dock"`) so CSS targeting does not rely on generic Tailwind class chains.

### CSS Alignment
- [x] Update the PWA-only selector in `packages/app/src/index.css` to target the new prompt dock class/attribute instead of `.absolute.inset-x-0.bottom-4` (which no longer matches).

### Validation
- [ ] Verify gradient background (`bg-gradient-to-t`) still displays correctly with increased padding.
- [ ] Test on desktop browser (Chrome/Firefox/Safari) at various widths.
- [ ] Test on mobile simulator or device (iOS Safari, Chrome Android).
- [ ] Verify input bar has minimum ~24px visible padding from bottom edge on desktop.

---

## Issue #268: AskQuestion Tool Dialog Fix (High Severity)

### Phase 0: Required Fixes
- [x] Add `callID` validation at start of `packages/opencode/src/tool/askquestion.ts` execute function; throw a clear error if `ctx.callID` is missing.
- [x] Remove non-null assertions (`!`) at askquestion.ts usages and replace with guarded `ctx.callID`.
- [x] In web and TUI pending detection, explicitly skip tool parts without `callID` to avoid undefined hand-offs:
  - `packages/app/src/pages/session.tsx` pending detection
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` pending detection

### Phase 1: Investigation & Debugging
- [x] Add debug logging to `packages/opencode/src/tool/askquestion.ts` after `ctx.metadata()` call.
- [x] Add debug logging to web detection memo in `packages/app/src/pages/session.tsx` (pendingAskQuestion).
- [x] Add debug logging to TUI detection memo in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (pendingAskQuestionFromSync).
- [x] Verify SSE delivers `PartUpdated` events with correct structure (verified via `packages/opencode/src/server/server.ts`).
- [x] Verify `ctx.callID` is defined when askquestion tool executes (log `options.toolCallId` in `packages/opencode/src/session/prompt.ts`).

### Phase 2: Sync/Reactivity
- [x] Confirm `ctx.metadata()` update path in `packages/opencode/src/session/prompt.ts` only updates running parts. Fixed a bug where `time.start` was reset.
- [x] Document expected behavior if updates are delayed (metadata write attempt after completion is logged as warning).
- [x] Await `Bus.publish` in `Session.updatePart` and other session methods to ensure sync events are dispatched before proceeding.
- [x] If necessary, add an explicit sync wait after metadata update (Bus event preferred; implemented by awaiting `Bus.publish` in `Session.updatePart`).

### Phase 3: Detection Logic (If Needed)
- [x] Verify `toolPart.callID` is available in detection and matches server call IDs (verified in `packages/opencode/test/tool/askquestion.test.ts`).
- [x] Verify `toolPart.state.metadata` schema matches expected `{ status, questions }` in both web and TUI (verified in `packages/opencode/test/tool/askquestion.test.ts`).

### Phase 4: Server Endpoint Tests
- [x] Create `packages/opencode/test/server/askquestion.test.ts` (align with existing server test patterns).
- [x] Add test: `POST /askquestion/respond` resolves pending request.
- [x] Add test: `POST /askquestion/cancel` rejects pending request.
- [x] Add test: `POST /askquestion/respond` returns 404/500 for unknown callID.

### Phase 4: Detection Edge Case Tests
- [x] Extend `packages/opencode/test/tool/askquestion.test.ts` with detection edge cases.
- [x] Add test: detects pending when callID is present.
- [x] Add test: returns null when callID is undefined.
- [x] Add test: ignores when part.state.status is not `running`.
- [x] Add test: ignores when metadata.status is `completed`.

### Phase 4: Cleanup Tests
- [x] Add test: cleanup rejects all pending requests for session on abort.

### Phase 5: Manual Validation
- [ ] Test in TUI mode: enable `experimental.askquestion_tool`, trigger LLM to use askquestion, verify dialog appears.
- [ ] Test in Web mode: desktop and mobile, verify wizard appears.
- [ ] Test edge cases: multiple questions, cancel mid-flow, session abort while pending, custom text response.
- [ ] Remove debug logging before merge.

---

### Issue #266: Plugin Audio Asset Bundling

### Create Shared Utility
- [x] Create `packages/opencode/src/util/asset-copy.ts`.
- [x] Export `ASSET_EXTENSIONS` with: `.html`, `.css`, `.json`, `.txt`, `.svg`, `.png`, `.jpg`, `.gif`, `.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.mp4`, `.webm`, `.mov`, `.woff`, `.woff2`, `.ttf`, `.otf`.
- [x] Export `copyPluginAssets(pluginDir, targetDir)` preserving directory structure (no flattening).
- [x] Export `resolvePluginRoot(entryFilePath)` to find nearest `package.json` or fall back to dirname.
- [x] Add symlink/path traversal checks using `fs.promises.realpath()` and `lstat` (skip symlinks, ensure target is within `pluginDir`).
- [x] Add logging for overwrites when copying into shared target directories.
- [x] Ensure parent directories exist before `Bun.write()` for nested paths.

### Update npm Plugin Bundling
- [x] In `packages/opencode/src/bun/index.ts`: import `{ copyPluginAssets, ASSET_EXTENSIONS }` from shared utility.
- [x] Remove inline `copyPluginAssets` function and `assetExtensions` array from bun/index.ts.
- [x] Preserve existing call sites: `copyPluginAssets(mod, bundledDir)` and `copyPluginAssets(mod, Global.Path.cache)`.

### Update Local Plugin Bundling
- [x] In `packages/opencode/src/plugin/index.ts`: import `{ copyPluginAssets, resolvePluginRoot }` from shared utility.
- [x] After successful `Bun.build()` in `bundleLocalPlugin()`, resolve plugin root: `const pluginRoot = await resolvePluginRoot(absolutePath)`.
- [x] Call `copyPluginAssets(pluginRoot, bundledDir)` for assets.
- [x] Call `copyPluginAssets(pluginRoot, Global.Path.cache)` for runtime resolution parity.

### Asset Copy Tests
- [x] Create `packages/opencode/test/asset-copy.test.ts`.
- [x] Add test: audio file copying (`.wav`, `.mp3`, `.ogg`).
- [x] Add test: nested directory preservation (`sounds/alerts/beep.wav` -> `targetDir/sounds/alerts/beep.wav`).
- [x] Add test: `resolvePluginRoot` with package.json present.
- [x] Add test: `resolvePluginRoot` fallback for single-file plugins (no package.json).
- [x] Add test: symlink/path traversal entries are skipped.
- [x] Add test: overwrite logging when file already exists.

---

## Issue #264: PWA Safe Area and Viewport Locking

### Home Menu Button Fix
- [x] Add `.home-menu-button` class to menu button in `packages/app/src/pages/home.tsx` (menu button wrapper at top of Home).

### Session Header Fix
- [x] Add `data-tauri-drag-region` attribute to `SessionHeader` root header in `packages/app/src/components/session/session-header.tsx`.

### Session Scroll Container Fix
- [x] Add `.session-scroll-container` class to session scroll container in `packages/app/src/pages/session.tsx` (the main message list scroll div).

### PWA CSS Rules
- [x] Extend PWA CSS rules in `packages/app/src/index.css`:
  - [x] Add `.home-menu-button { top: var(--safe-area-inset-top); }` inside `@media (display-mode: standalone)`.
  - [x] Add `.session-scroll-container { overscroll-behavior: contain; }` inside `@media (display-mode: standalone)`.
  - [x] Keep existing `header[data-tauri-drag-region]` safe-area rule.

### PullToRefresh Guard
- [x] Update `packages/app/src/components/pull-to-refresh.tsx` to accept an `enabled` prop (function or boolean).
- [x] Add early return guards to `handleTouchStart`, `handleTouchMove`, `handleTouchEnd` when `enabled()` is false.
- [x] In `packages/app/src/pages/layout.tsx`: import `isPWA` from `packages/app/src/context/platform.tsx` and pass `enabled={!isPWA()}` to `PullToRefresh`.

### PWA Validation
- [x] Verify `#root`/body sizing still uses `h-dvh` and appropriate `min-height` values for iOS PWA.
- [ ] Manually verify iOS PWA on Dynamic Island device (iPhone 14+).
- [ ] Manually verify iOS PWA on notch device (iPhone X-13).
- [ ] Manually verify Android PWA pull-down behavior in session view.
- [ ] Verify no desktop/browser regressions for menu placement and scrolling.
- [ ] Verify `@mohak34/opencode-notifier` sounds play correctly after asset bundling.

---

## Issue #269: TUI Transparency Toggle Fix

### Milestone 1: Reproduce and Inspect State
- [ ] Reproduce in TUI and log `transparent()` before and after toggling.
- [ ] Verify `kv.get("theme_transparent", false)` changes and persists across restart.
- [ ] Inspect `resolveTheme` output for `background.a` with multiple themes (Night Owl, Nord, lucent-orng).
- [ ] Confirm that the theme memo re-runs on `setTransparent`.
- [ ] Verify that `lucent-orng` theme resolves to alpha=0 even when toggle is off (confirms root cause).

### Milestone 2: Fix Theme Resolution
- [x] Create `normalizeBackgrounds(resolved, transparent)` helper in `packages/opencode/src/cli/cmd/tui/context/theme.tsx`.
- [x] Implement fallback chain: `backgroundMenu` -> `backgroundElement` -> `backgroundPanel` -> derive from `primary`.
- [x] Treat semi-transparent colors as ineligible for fallback (require alpha=1 for fallback eligibility).
- [x] For last resort fallback: derive from primary at 10% luminance for dark mode, 95% for light mode.
- [x] Call `normalizeBackgrounds()` at the end of `resolveTheme()` before returning.

### Milestone 3: Contrast and Theme UX
- [ ] Re-validate `selectedForeground` behavior with opaque backgrounds.
- [ ] Verify selected list item contrast remains readable for Night Owl, Nord, opencode, and lucent-orng themes.
- [ ] Test with light mode themes to ensure derived fallback works for both dark and light modes.

### Milestone 4: Transparency Tests
- [x] Add unit tests in `packages/opencode/test/theme.test.ts`.
- [x] Add test: `normalizeBackgrounds` with fully transparent theme.
- [x] Add test: `normalizeBackgrounds` with semi-transparent `backgroundMenu`.
- [x] Add test: `normalizeBackgrounds` fallback derivation from `primary`.
- [x] Add test: full `resolveTheme` with `transparent=false` and lucent-orng fixture.
- [x] Add test: `selectedForeground` verifies readable contrast when transparency is off.

### Milestone 5: Manual Validation
- [ ] Toggle transparency on/off in TUI and verify immediate updates.
- [ ] Switch themes (Night Owl, Nord, lucent-orng) and verify backgrounds are opaque when toggle is off.
- [ ] Restart TUI and confirm the last toggle state is restored.
- [ ] Test lucent-orng specifically in both dark and light modes with transparency off.

---

## Issue #270: TUI Bash Spinner Stops on Completion

### Milestone 1: Reproduce and Trace State Transitions
- [ ] Reproduce in TUI and confirm the Bash part status after command completion (server-side).
- [x] Inspect `Bash` component `isRunning` at `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` for reactivity; change to `createMemo` or inline check.
- [x] Add logging to `packages/opencode/src/session/processor.ts` (tool-result case) to verify it fires for Bash tool.
- [x] Add logging to `Session.updatePart` to confirm it is called with `status: "completed"`.
- [x] Log when `ctx.metadata` attempts to write after completion.

### Milestone 2: Trace Event Delivery and Store Updates
- [x] Add logging to TUI sync handler when `message.part.updated` is received.
- [x] Add logging when `sync.data.part[messageID]` is updated in the store.
- [x] Identify the TUI component that renders the Bash spinner and trace its props/derivations.
- [x] Confirm the component re-renders on part status change (post `isRunning` fix).

### Milestone 3: Fix Based on Findings
- [x] Fix Bash spinner reactivity by avoiding plain object spreads in `ToolPart` and passing props explicitly.
- [x] Fix Bash spinner color bug (using part status instead of agent name).
- [x] Prevent `completed`/`error` -> `running` writes (guard in `Session.updatePart` and `ctx.metadata`).
- [ ] If event not delivering: Fix event stream subscription or reconnection logic.
- [ ] If store not updating: Fix Solid.js store update (ensure `produce` or proper setter is used).
- [ ] If part lookup wrong: Fix the part ID/callID matching between processor and TUI.

### Milestone 4: Spinner Tests
- [x] Add a session-level test to verify tool-result -> part status `completed` transition (implemented in `packages/opencode/test/session/tool-completion.test.ts`).
- [x] Add a test that prevents `completed`/`error` -> `running` status downgrade (implemented in `packages/opencode/test/session/status-downgrade.test.ts`).

### Milestone 5: Manual Validation
- [ ] Run a Bash command via the TUI and confirm the spinner stops.
- [x] Verify at least one other tool (Write or Task) still updates correctly (verified `write` in `tool-completion.test.ts`).
- [ ] Test with both short (<1s) and long (>5s) running commands.
- [x] Test spinner behavior when command errors (non-zero exit) (verified in `tool-completion.test.ts`).

---

## Final Validation

- [ ] Run `bun test` in `packages/opencode`.
- [ ] Run `bun turbo test` at repo root for full test suite.
- [ ] TypeScript compilation succeeds for both `opencode` and `app` packages.
- [ ] All acceptance criteria verified.
- [ ] Debug logging removed from all files.
