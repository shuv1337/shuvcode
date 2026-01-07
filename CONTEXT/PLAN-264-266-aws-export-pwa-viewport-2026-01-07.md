# Implementation Plan: AWS SDK Export Regression & PWA Viewport Locking

**Issues:** #264 (PWA viewport scrolling), #266 (AWS SDK bundling regression)
**Date:** 2026-01-07
**Status:** Ready for Implementation
**Supersedes:** `PLAN-264-266-pwa-menu-audio-bundling-2026-01-05.md` (audio bundling portion complete)

---

## Executive Summary

This plan addresses two regressions in the shuvcode fork:

1. **Issue #266 (CRITICAL):** AWS SDK credential provider (`fromNodeProviderChain`) export handling was lost during upstream merge v1.1.4. Users report `TypeError: fromNodeProviderChain is not a function` when using Amazon Bedrock provider.

2. **Issue #264 (PARTIAL):** PWA viewport scrolling on iOS is still not locked. Users can scroll past content into blank space, breaking the native app experience.

---

## Issue #266: AWS SDK Bundling Export Regression

### Problem Description

Users are receiving the following error when attempting to use Amazon Bedrock:

```json
{
  "name": "UnknownError",
  "data": {
    "message": "TypeError: fromNodeProviderChain is not a function. (In 'fromNodeProviderChain(credentialProviderOptions)', 'fromNodeProviderChain' is undefined)\n    at <anonymous> (src/provider/provider.ts:207:29)\n    at processTicksAndRejections (native:7:39)"
  }
}
```

### Root Cause Analysis

**Timeline of the regression:**

| Commit | Date | Description |
|--------|------|-------------|
| `e3bb2644e` | 2025-12-29 | Added fix to handle bundled vs unbundled AWS SDK exports |
| `ce0f09dbd` | 2026-01-06 | Sync with upstream v1.1.4 **overwrote the fix** |

**Technical explanation:**

When shuvcode bundles packages via `Bun.build()` with `packages: "bundle"`, the export structure of `@aws-sdk/credential-providers` changes:

- **Unbundled (upstream):** `module.fromNodeProviderChain` (direct named export)
- **Bundled (shuvcode):** `module.default.fromNodeProviderChain` (wrapped in default export)

The fix in `e3bb2644e` handled both cases:

```typescript
const awsSdkModule = await import(awsSdkPath)
const fromNodeProviderChain = awsSdkModule.fromNodeProviderChain ?? awsSdkModule.default?.fromNodeProviderChain
```

**Current broken code** (`packages/opencode/src/provider/provider.ts:200-207`):

```typescript
const { fromNodeProviderChain } = await import(await BunProc.install("@aws-sdk/credential-providers"))
// This fails when the bundled module doesn't have a direct named export
```

### External References

- AWS SDK Credential Providers documentation: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-credential-providers.html
- AWS SDK v3 package: https://www.npmjs.com/package/@aws-sdk/credential-providers
- Bun bundler export handling: https://bun.sh/docs/bundler

### Related Internal Commits

```bash
# The fix commit that was overwritten
git show e3bb2644e --stat
# commit e3bb2644e3da344b114fca3f5e1de8a6f42925dc
# fix: ensure tslib is available for AWS SDK credential providers

# The sync commit that caused the regression  
git show ce0f09dbd --stat
# commit ce0f09dbd
# sync: merge upstream v1.1.4 into integration
```

---

## Issue #264: PWA Viewport Scrolling

### Problem Description

On iOS Safari PWA (standalone mode), the viewport can scroll past content boundaries into blank space. This breaks the native app-like experience expected in PWA mode.

### Root Cause Analysis

**Current implementation gaps:**

1. `overscroll-behavior: contain` is only applied to `.session-scroll-container` inside PWA media query
2. The `html`, `body`, and `#root` elements lack proper viewport locking in PWA mode
3. iOS Safari in PWA mode may ignore some CSS properties unless `position: fixed` is used on root containers

**Relevant existing code:**

| File | Line | Current State |
|------|------|---------------|
| `packages/app/index.html` | 27 | Body has `overscroll-none overflow-hidden` |
| `packages/app/index.html` | 43 | Root uses `h-dvh` (correct) |
| `packages/app/src/index.css` | 109-111 | `.session-scroll-container` has `overscroll-behavior: contain` in PWA mode only |
| `packages/app/src/pages/session.tsx` | 879 | Main container has `overflow-hidden` |
| `packages/app/src/pages/session.tsx` | 962 | Scroll container class is `session-scroll-container` |

**Additional context:** `index.html` already applies `h-dvh` on `#root` and sets the `interactive-widget=resizes-content` viewport meta tag, so adding `position: fixed`/`inset: 0` requires reconsidering the existing `min-height` rules and safe-area padding to avoid conflicting heights when the keyboard appears on iOS. Safe-area offsets are currently handled by `header[data-tauri-drag-region]` and the prompt dock, so the plan must keep a single source of truth for padding to prevent double offsets.

Also note that `[data-slot="list-scroll"]` already defines `overscroll-behavior: contain` inside `packages/ui/src/components/list.css:76-82`, and `.overflow-y-auto` is a widely used utility. The plan should therefore target the session-specific scroll container (and any other PWA-only scroll containers we explicitly add) instead of a global utility class to avoid unintended desktop regressions.

### External References

**iOS Safari PWA Viewport Solutions:**

- Stack Overflow: https://stackoverflow.com/questions/59193062/how-to-disable-scrolling-on-body-in-ios-13-safari-when-saved-as-pwa-to-the-hom
- Medium article on iOS Safari body scroll lock: https://medium.com/@stripearmy/i-fixed-a-decade-long-ios-safari-problem-0d85f76caec0
- WebKit bug on fixed elements with overscroll: https://bugs.webkit.org/show_bug.cgi?id=206227
- Apple Developer Forums on iOS17 PWA `position: fixed`: https://developer.apple.com/forums/thread/744327
- iNoBounce library (reference implementation): https://github.com/lazd/iNoBounce

**Key insight from research:**

The most reliable solution for iOS PWA viewport locking is:

```css
html, body {
  position: fixed;
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}
```

---

## Technical Specifications

### Issue #266: AWS SDK Export Fix

**File:** `packages/opencode/src/provider/provider.ts`
**Lines:** 197-220 (approximately)

**Current broken code:**

```typescript
if (!profile && !awsAccessKeyId && !awsBearerToken) return { autoload: false }

const { fromNodeProviderChain } = await import(await BunProc.install("@aws-sdk/credential-providers"))

// Build credential provider options (only pass profile if specified)
const credentialProviderOptions = profile ? { profile } : {}

const providerOptions: AmazonBedrockProviderSettings = {
  region: defaultRegion,
  credentialProvider: fromNodeProviderChain(credentialProviderOptions),
}
```

**Fixed code (restore from e3bb2644e with improvements):**

```typescript
if (!profile && !awsAccessKeyId && !awsBearerToken) return { autoload: false }

const awsSdkPath = await BunProc.install("@aws-sdk/credential-providers")

// Helper to load credential provider with bundled/unbundled export handling
const loadCredentialProvider = async (options: { profile?: string }) => {
  const awsSdkModule = await import(awsSdkPath)
  // Handle both named exports and multiple default wrappers produced by Bun.
  const fromNodeProviderChain =
    awsSdkModule.fromNodeProviderChain ??
    awsSdkModule.default?.fromNodeProviderChain ??
    awsSdkModule.default?.default?.fromNodeProviderChain

  if (!fromNodeProviderChain) {
    throw new Error(
      "AWS SDK credentials provider is missing fromNodeProviderChain export. " +
        "Inspect ~/.cache/opencode/bundled for the actual module shape and adjust this helper if Bun changes its wrapper."
    )
  }
  return fromNodeProviderChain(options)
}

// Build credential provider options (only pass profile if specified)
const credentialProviderOptions = profile ? { profile } : {}

const providerOptions: AmazonBedrockProviderSettings = {
  region: defaultRegion,
  credentialProvider: await loadCredentialProvider(credentialProviderOptions),
}
```

**Note:** `BunProc.install` already installs `tslib` (see `packages/opencode/src/bun/index.ts` and `packages/opencode/test/preload.ts`). The helper above therefore surfaces clear errors rather than retrying installs; if we encounter missing helpers during manual testing we will inspect the bundled artifact under `~/.cache/opencode/bundled` for additional wrapper layers and expand the helper accordingly.

We also intend to add a focused unit test in `packages/opencode/test/provider/amazon-bedrock.test.ts` that mocks a bundled module returning `default` or `default.default` to validate the helper covers the real-world export shapes produced by Bun.

### Issue #264: PWA Viewport Locking CSS

**File:** `packages/app/src/index.css`

**Current PWA styles (lines 90-122):**

```css
/* PWA standalone mode specific styles */
@media (display-mode: standalone) {
  :root {
    --pwa-top-offset: var(--safe-area-inset-top);
    --pwa-bottom-offset: var(--safe-area-inset-bottom);
  }

  #root {
    min-height: 100vh;
    min-height: -webkit-fill-available;
    min-height: 100dvh;
  }

  .home-menu-button {
    top: var(--safe-area-inset-top);
  }

  .session-scroll-container {
    overscroll-behavior: contain;
  }
}
```

**Enhanced PWA styles (to be added/modified):**

```css
/* PWA standalone mode specific styles */
@media (display-mode: standalone) {
  :root {
    --pwa-top-offset: var(--safe-area-inset-top);
    --pwa-bottom-offset: var(--safe-area-inset-bottom);
  }

  /* Critical iOS viewport locking - prevents rubber-banding on html/body */
  html {
    position: fixed;
    width: 100%;
    height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
  }

  body {
    position: fixed;
    width: 100%;
    height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
  }

  #root {
    position: fixed;
    inset: 0;
    overflow: hidden;
    overscroll-behavior: none;
    /* Ensure proper sizing with safe areas */
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    box-sizing: border-box;
  }

  .home-menu-button {
    top: var(--safe-area-inset-top);
  }

  /* All scrollable containers should contain overscroll */
  .session-scroll-container {
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  /* Ensure other scroll containers also prevent bounce */
  .overflow-y-auto,
  [data-slot="list-scroll"] {
    overscroll-behavior: contain;
  }
}

/* Ensure header respects safe area in PWA mode */
@media (display-mode: standalone) {
  header[data-tauri-drag-region] {
    padding-top: var(--safe-area-inset-top);
    min-height: calc(3rem + var(--safe-area-inset-top));
  }
}
```

**Note on `#root` padding:** Adding `padding-top` and `padding-bottom` to `#root` in PWA mode may require adjusting internal components that already account for safe areas. Test thoroughly.

**Alternative approach (if padding causes layout issues):**

```css
#root {
  position: fixed;
  inset: 0;
  overflow: hidden;
  overscroll-behavior: none;
  /* Remove padding, let child components handle safe areas */
}
```

---

## Implementation Tasks

### Milestone 1: Fix AWS SDK Export Regression (#266)

- [x] **1.1** Open `packages/opencode/src/provider/provider.ts`
- [x] **1.2** Locate the Amazon Bedrock provider autoload section (around line 197-220)
- [x] **1.3** Introduce the `loadCredentialProvider` helper that checks named exports plus `default`/`default.default` wrappers before throwing the diagnostics error.
- [x] **1.4** Inspect the bundled artifact for `@aws-sdk/credential-providers` (e.g., `~/.cache/opencode/bundled/@aws-sdk-credential-providers.js`) to confirm the export shape and note additional wrappers if Bun changes its bundler output.
- [x] **1.5** Document that `BunProc.install` already installs `tslib`, so the helper surfaces diagnostics instead of retrying tslib installs.
- [x] **1.6** Add a targeted unit test in `packages/opencode/test/provider/amazon-bedrock.test.ts` that mocks `fromNodeProviderChain` coming from `default` / `default.default`.
- [x] **1.7** Run existing Bedrock tests: `bun test packages/opencode/test/provider/amazon-bedrock.test.ts`
- [ ] **1.8** Clear local bundled cache and verify fix: `rm -rf ~/.cache/opencode/bundled/*aws*`

### Milestone 2: Fix PWA Viewport Scrolling (#264)

- [x] **2.1** Open `packages/app/src/index.css`
- [x] **2.2** Locate the `@media (display-mode: standalone)` block (lines 90-122)
- [x] **2.3** Add `position: fixed`, `inset: 0`, `overflow: hidden`, and `overscroll-behavior: none` to `html`, `body`, and `#root`, then remove the conflicting `min-height` declarations so the fixed layout becomes the canonical height source.
- [x] **2.4** Apply `overscroll-behavior: contain` (plus `-webkit-overflow-scrolling: touch`) to `.session-scroll-container` and other explicitly PWA-only scroll containers; avoid global utilities like `.overflow-y-auto` and note that `[data-slot="list-scroll"]` already declares the necessary rule.
- [x] **2.5** Review safe-area padding so only one layer (header/prompt dock or `#root`) adds offsets; update documentation/comments to capture the chosen strategy before adjusting children.
- [ ] **2.6** Test on iOS Safari PWA:
  - iPhone with Dynamic Island (14 Pro or newer): open the keyboard, rotate the device, and confirm no blank-space overscroll or stuck scroll positions.
  - iPhone with notch (X-13): pull beyond the top/bottom of content and ensure viewport locking holds.
- [ ] **2.7** Verify Android PWA, desktop browsers, and other standalone contexts still behave normally when scrolling and dismissing the keyboard.

### Milestone 3: Testing and Validation

- [x] **3.1** Run full test suite: `bun turbo test`
- [ ] **3.2** Manual test: Amazon Bedrock provider with bundled binary
- [ ] **3.3** Manual test: iOS PWA viewport locking (see test steps below)
- [ ] **3.4** Manual test: Android PWA behavior (ensure no regressions)
- [ ] **3.5** Manual test: Desktop browser behavior (ensure no regressions)

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/opencode/src/provider/provider.ts` | MODIFY | Restore bundled/unbundled export handling for AWS SDK |
| `packages/app/src/index.css` | MODIFY | Add position:fixed and overscroll-behavior:none for PWA viewport locking |

---

## Validation Criteria

### Automated Tests

- [x] `bun test packages/opencode/test/provider/amazon-bedrock.test.ts` passes
- [x] `bun turbo test` at repo root passes
- [ ] TypeScript compilation succeeds: `bun run type-check`

### Manual Test: AWS SDK (#266)

```bash
# 1. Clear bundled cache
rm -rf ~/.cache/opencode/bundled/*aws*
rm -rf ~/.cache/opencode/bundled/*credential*

# 2. Configure Amazon Bedrock provider in opencode.json
# {
#   "providers": {
#     "amazon-bedrock": {
#       "enabled": true
#     }
#   }
# }

# 3. Launch shuvcode and select a Bedrock model
# 4. Send a test message
# 5. Verify no "fromNodeProviderChain is not a function" error

# 6. Check logs for successful credential loading
grep -i "credentialProvider" ~/.cache/opencode/logs/*.log
```

### Manual Test: PWA Viewport (#264)

**iOS Safari PWA Test:**

1. Open https://your-shuvcode-server in iOS Safari
2. Tap Share > Add to Home Screen
3. Launch the PWA from Home Screen
4. Navigate to a session with content
5. **Test:** Try to scroll past the bottom of content into blank space
6. **Expected:** Viewport should NOT scroll past content; overscroll should be contained
7. **Test:** Try to pull down at the top of the session
8. **Expected:** No rubber-banding that exposes blank space above content
9. **Test:** Focus the prompt input so the keyboard opens, then blur it; confirm the viewport does not jump or reveal blank space and `#root` remains fixed to safe-area edges.
10. **Test:** Rotate the device (portrait <-> landscape) and ensure the fixed layout still respects the safe-area padding without double offsets (header/prompt should align with `var(--safe-area-inset-*)`).

**Android PWA Test:**

1. Open in Chrome > Add to Home Screen
2. Launch PWA
3. Navigate to session view
4. **Test:** Pull down gesture at top
5. **Expected:** No page refresh triggered (PullToRefresh disabled in PWA)
6. **Test:** Open the keyboard from the prompt input and verify the viewport stays locked to the content area (no overscroll above/below).

**Desktop Browser Test:**

1. Open in Chrome/Firefox/Safari
2. Navigate to session view
3. **Test:** Scroll behavior
4. **Expected:** Normal scrolling, no visual regressions
5. **Test:** Open and dismiss panels/modal to confirm the fixed root does not trap focus or clip portal content.

---

## Rollback Plan

If the changes cause unexpected issues:

### AWS SDK Fix Rollback

Revert `packages/opencode/src/provider/provider.ts` to the simple destructuring import:

```typescript
const { fromNodeProviderChain } = await import(await BunProc.install("@aws-sdk/credential-providers"))
```

Note: This will re-introduce the bug for users with bundled binaries.

### PWA CSS Rollback

Remove the `position: fixed` rules from the PWA media query in `packages/app/src/index.css`:

```css
@media (display-mode: standalone) {
  /* Remove html, body, #root position:fixed rules */
  /* Keep only the original rules */
}
```

---

## Known Limitations

1. **PWA viewport fix may affect layout:** Adding `position: fixed` to `html`/`body`/`#root` supersedes the previous `min-height`/`h-dvh` strategy and may require tweaks to any component that assumes a dynamic viewport height (e.g., sticky headers or keyboard-aware containers).

2. **AWS SDK bundling is fragile:** The bundler export handling is a workaround for Bun's bundling behavior. Future Bun updates may change export handling.

3. **Safe area padding decisions need consolidation:** `header[data-tauri-drag-region]`, prompt dock padding, and a potential `#root` padding should share the same assumption; otherwise components may double-apply offsets.

---

## Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Should `#root` have safe area padding? | NEEDS TESTING | Test without first; add if needed |
| Does `position: fixed` on body break any modals? | NEEDS TESTING | Modals use portal rendering, should be unaffected |
| Does keyboard resizing / orientation changes break the fixed layout? | NEEDS TESTING | Verify on iOS Safari PWA that keyboard open/close and rotations keep content locked and portals accessible |
| Should we add a JS-based scroll lock as fallback? | DEFERRED | CSS-only solution is preferred; add JS only if CSS fails |

---

## References

### Internal Files

| File | Purpose |
|------|---------|
| `packages/opencode/src/provider/provider.ts:197-220` | Amazon Bedrock provider initialization |
| `packages/opencode/src/bun/index.ts` | Plugin bundling with Bun.build() |
| `packages/app/src/index.css:90-122` | PWA-specific CSS rules |
| `packages/app/src/pages/session.tsx:879,962` | Session view containers |
| `packages/app/src/context/platform.tsx:5-11` | `isPWA()` utility function |

### External Git URLs

| Repository | Purpose |
|------------|---------|
| https://github.com/aws/aws-sdk-js-v3 | AWS SDK v3 source (credential providers) |
| https://github.com/lazd/iNoBounce | Reference for iOS scroll lock techniques |
| https://github.com/sst/opencode | Upstream opencode (for comparison) |

### Related Commits

```bash
# AWS SDK fix that was overwritten
git show e3bb2644e --stat -p

# Upstream sync that caused regression
git show ce0f09dbd --stat

# Audio asset bundling fix (already complete)
git show efa405ed4 --stat
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-01-07 | Initial plan addressing AWS SDK regression and PWA viewport issues |
