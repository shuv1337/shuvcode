# Plan: Custom Server URL Settings

## Plan Overview

Add custom server URL configuration to the web/desktop app while preserving our existing sophisticated URL resolution logic. This feature allows users to manually override the server URL via query parameter or a settings dialog, with localStorage persistence.

**Approach**: Instead of merging upstream PR #6312 directly, we implement the feature natively using our existing patterns and architecture.

## Issue Context

- **Upstream Reference**: https://github.com/sst/opencode/pull/6312 (for feature inspiration only)
- **Goal**: Allow custom server URLs when OpenCode is served on non-standard paths (e.g., `https://domain.com/workspace/1`)
- **Key Use Case**: Connect `desktop.shuv.ai` (Cloudflare Pages hosted) to a local OpenCode server via `?url=http://localhost:4096`
- **Constraint**: Must preserve our fork's richer URL resolution (HTTPS detection, shuv.ai host, same-origin rules, web command logic)

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| **Use dialog instead of separate route** | Fits our existing dialog patterns (DialogSelectProvider, DialogCreateProject). Avoids routing complexity with `/:dir` pattern. |
| **Module-level localStorage read** | URL must be resolved before React/Solid renders. Cannot use `persisted()` hook at module level. |
| **Shared localStorage keys** | Module-level and component-level code share keys for consistency. |
| **Page reload on URL change** | SDK is initialized once with URL. Changing URL requires full reload to reinitialize. |
| **URL validation before storage** | Prevent storing malformed URLs that would break the app. |
| **Keep existing fallback chain** | Our HTTPS/same-origin/known-host logic handles reverse proxies correctly. |

## URL Resolution Priority (New)

```
1. ?url= query parameter     → Use and persist to localStorage
2. localStorage stored URL   → Use if present (NEW)
3. Tauri injected port       → Desktop app with local server
4. Same-origin mode          → HTTPS, known hosts, web command
5. Host:port fallback        → Dev mode explicit server
```

**Same-origin triggers** (preserved from current logic):
- `location.protocol === "https:"` (avoid mixed content)
- Hostname includes `opencode.ai` or `shuv.ai`
- Hostname ends with `.local`
- Loopback in non-dev mode
- Web command mode (`!import.meta.env.DEV`)

## Technical Specifications

### LocalStorage Configuration

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `opencode:server-url` | `string \| null` | `null` | Current active server URL override |
| `opencode:server-url-history` | `string[]` (JSON) | `[]` | Last 5 unique URLs for quick selection |

**Note**: Using `opencode:` prefix to namespace our keys, following pattern similar to `layout.v3`.

### URL Validation

```typescript
function isValidServerUrl(url: string): boolean {
  if (!url || !url.trim()) return false
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}
```

### Mixed Content Detection

When the app is served over HTTPS (e.g., `desktop.shuv.ai`), browsers block HTTP API requests to non-localhost origins. We detect this and warn users in the dialog.

```typescript
/**
 * Check if setting this URL would cause mixed content issues.
 * Returns true if:
 * - Current page is HTTPS, AND
 * - Target URL is HTTP, AND
 * - Target is NOT localhost/127.0.0.1 (browsers allow this exception)
 */
function hasMixedContentRisk(targetUrl: string): boolean {
  if (location.protocol !== 'https:') return false
  
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol !== 'http:') return false
    
    // Localhost is allowed even from HTTPS (secure context exception)
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    return !isLocalhost
  } catch {
    return false
  }
}
```

**Allowed from HTTPS pages**:
| Target URL | Allowed | Reason |
|------------|---------|--------|
| `http://localhost:4096` | Yes | Localhost exception |
| `http://127.0.0.1:4096` | Yes | Loopback exception |
| `https://my-server.com` | Yes | HTTPS to HTTPS |
| `http://192.168.1.100:4096` | No | Mixed content blocked |
| `http://my-server.com` | No | Mixed content blocked |

### History Management

- Max 5 entries, most recent first
- Deduplicate by normalized URL (lowercase, trailing slash stripped)
- Add to history on successful URL set (query param or dialog)

```typescript
function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '')
}
```

## Affected Files

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/app/src/app.tsx` | Modify | Add localStorage read/write in URL resolution |
| `packages/app/src/lib/server-url.ts` | **New** | Shared URL utilities (validation, history, constants) |
| `packages/app/src/components/dialog-server-settings.tsx` | **New** | Server settings dialog component |
| `packages/app/src/pages/layout.tsx` | Modify | Add sidebar button to open dialog |
| `packages/app/src/pages/error.tsx` | Modify | Add reset button for connection errors |
| `packages/app/src/context/command.tsx` | Modify | Add command palette entry (optional) |

## Implementation Plan

### Milestone 1: Server URL Utilities

Create `packages/app/src/lib/server-url.ts` with shared logic:

```typescript
// Constants
export const SERVER_URL_KEY = "opencode:server-url"
export const SERVER_URL_HISTORY_KEY = "opencode:server-url-history"
export const MAX_HISTORY = 5

// Validation
export function isValidServerUrl(url: string): boolean

// Mixed content detection
export function hasMixedContentRisk(targetUrl: string): boolean

// Normalization  
export function normalizeUrl(url: string): string

// History management
export function getServerUrlHistory(): string[]
export function addToServerUrlHistory(url: string): void
export function clearServerUrlHistory(): void

// Current URL management
export function getStoredServerUrl(): string | null
export function setStoredServerUrl(url: string): void
export function clearStoredServerUrl(): void
```

**Tasks**:
- [x] Create `packages/app/src/lib/server-url.ts`
- [x] Implement URL validation with protocol check
- [x] Implement mixed content risk detection
- [x] Implement history load/save with max limit
- [x] Implement URL normalization for deduplication
- [x] Export all utilities

### Milestone 2: App URL Resolution Integration

Modify `packages/app/src/app.tsx` to integrate localStorage:

**Current code (lines 31-68)**:
```typescript
const host = import.meta.env.VITE_OPENCODE_SERVER_HOST || ...
const port = window.__OPENCODE__?.port ?? ...
// ... same-origin logic ...
const url = new URLSearchParams(document.location.search).get("url") || ...
```

**New code**:
```typescript
import { iife } from "@opencode-ai/util/iife"
import { 
  getStoredServerUrl, 
  setStoredServerUrl, 
  isValidServerUrl,
  addToServerUrlHistory,
  SERVER_URL_KEY 
} from "@/lib/server-url"

const url = iife(() => {
  // 1. Query parameter (highest priority) - persist if valid
  const queryUrl = new URLSearchParams(document.location.search).get("url")
  if (queryUrl && isValidServerUrl(queryUrl)) {
    setStoredServerUrl(queryUrl)
    addToServerUrlHistory(queryUrl)
    return queryUrl
  }

  // 2. Stored URL override
  const storedUrl = getStoredServerUrl()
  if (storedUrl) return storedUrl

  // 3-5. Existing logic (preserved exactly)
  const host = import.meta.env.VITE_OPENCODE_SERVER_HOST || location.hostname || "127.0.0.1"
  const port = window.__OPENCODE__?.port ?? import.meta.env.VITE_OPENCODE_SERVER_PORT ?? location.port ?? "4096"

  const isSecure = location.protocol === "https:"
  const isKnownHost = location.hostname.includes("opencode.ai") ||
                      location.hostname.includes("shuv.ai") ||
                      location.hostname.endsWith(".local")
  const isLoopback = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname)
  const isWebCommand = !import.meta.env.DEV
  const useSameOrigin = isSecure || isKnownHost || (isLoopback && !import.meta.env.DEV) || isWebCommand

  // 3. Tauri desktop
  if (window.__OPENCODE__?.port) {
    return `http://${host}:${window.__OPENCODE__.port}`
  }

  // 4. Same-origin mode
  if (useSameOrigin) {
    return "/"
  }

  // 5. Explicit host:port (dev mode)
  return `http://${host}:${port}`
})
```

**Tasks**:
- [x] Add `iife` import from `@opencode-ai/util/iife`
- [x] Add imports from `@/lib/server-url`
- [x] Wrap URL resolution in `iife()` for cleaner structure
- [x] Add query param persistence with validation
- [x] Add localStorage read after query param check
- [x] Preserve all existing same-origin/Tauri/fallback logic

### Milestone 3: Server Settings Dialog

Create `packages/app/src/components/dialog-server-settings.tsx`:

**Features**:
- Display current effective URL (computed or stored)
- Input field for custom URL with validation
- **Mixed content warning** when setting HTTP URL from HTTPS page (except localhost)
- "Apply" button that saves and reloads
- History list for quick selection (last 5)
- "Clear" button to remove override and reload
- Visual indicator if using stored vs computed URL

**UI Structure**:
```
┌─────────────────────────────────────────┐
│ Server Settings                      [X]│
├─────────────────────────────────────────┤
│ Current server URL                      │
│ ┌─────────────────────────────────────┐ │
│ │ https://custom-server.com        ✓  │ │  (green check = stored override)
│ └─────────────────────────────────────┘ │  (gray = computed default)
│                                         │
│ Set custom URL                          │
│ ┌───────────────────────────────┐ ┌───┐ │
│ │ http://192.168.1.5:4096       │ │Set│ │
│ └───────────────────────────────┘ └───┘ │
│ ⚠ This HTTP URL will be blocked by     │  <- Warning shown conditionally
│   your browser (mixed content). Use     │
│   localhost or HTTPS instead.           │
│                                         │
│ Recent URLs                             │
│ ┌─────────────────────────────────────┐ │
│ │ https://server-1.com                │ │
│ │ http://localhost:4096           ✓   │ │  (checkmark = safe)
│ └─────────────────────────────────────┘ │
│                                         │
│ [Clear override]                        │
└─────────────────────────────────────────┘
```

**Mixed Content Warning Logic**:
```typescript
import { hasMixedContentRisk } from "@/lib/server-url"

// In component:
const showMixedContentWarning = () => hasMixedContentRisk(inputUrl())

// In JSX:
<Show when={showMixedContentWarning()}>
  <div class="flex items-start gap-2 p-2 rounded bg-surface-warning-subtle text-text-warning-base text-12-regular">
    <Icon name="warning" size="small" class="shrink-0 mt-0.5" />
    <span>
      This HTTP URL will be blocked by your browser (mixed content). 
      Use <code class="font-mono">localhost</code> or an HTTPS URL instead.
    </span>
  </div>
</Show>
```

**Tasks**:
- [x] Create `packages/app/src/components/dialog-server-settings.tsx`
- [x] Add current URL display with override indicator
- [x] Add input field with real-time validation
- [x] Add mixed content warning (shown when `hasMixedContentRisk()` returns true)
- [x] Add "Set" button with `showToast` feedback and reload
- [x] Add history list from localStorage
- [x] Add "Clear override" button
- [x] Style consistent with existing dialogs (DialogSelectProvider pattern)

### Milestone 4: Sidebar Integration

Modify `packages/app/src/pages/layout.tsx` to add dialog trigger:

**Location**: After "Create project" button (around line 1158), before "Share feedback"

```typescript
import { DialogServerSettings } from "@/components/dialog-server-settings"

// In sidebar actions section:
<Tooltip placement="right" value="Server settings" inactive={layout.sidebar.opened()}>
  <Button
    class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
    variant="ghost"
    size="large"
    icon="settings-gear"
    onClick={() => dialog.show(() => <DialogServerSettings />)}
  >
    <Show when={layout.sidebar.opened()}>Server settings</Show>
  </Button>
</Tooltip>
```

**Tasks**:
- [x] Import `DialogServerSettings` component
- [x] Add sidebar button after "Create project" (line ~1158)
- [x] Use `dialog.show()` pattern consistent with other dialogs
- [x] Use `settings-gear` icon (or `server` if available)

### Milestone 5: Error Page Recovery

Modify `packages/app/src/pages/error.tsx` to add reset option:

**Connection error detection**:
```typescript
function isConnectionError(error: unknown): boolean {
  const message = formatError(error).toLowerCase()
  return message.includes("could not connect") ||
         message.includes("econnrefused") ||
         message.includes("fetch failed") ||
         message.includes("network error")
}
```

**Add reset button** (only shown for connection errors when override is set):
```typescript
import { getStoredServerUrl, clearStoredServerUrl } from "@/lib/server-url"

// In ErrorPage component:
const hasServerOverride = () => !!getStoredServerUrl()

function resetServerUrl() {
  clearStoredServerUrl()
  platform.restart()
}

// In JSX, after Restart button:
<Show when={isConnectionError(props.error) && hasServerOverride()}>
  <Button size="large" variant="ghost" onClick={resetServerUrl}>
    Reset server URL
  </Button>
  <p class="text-xs text-text-weak">
    Using custom server URL. Reset to use default.
  </p>
</Show>
```

**Tasks**:
- [x] Import server URL utilities
- [x] Add `isConnectionError` helper function
- [x] Add `hasServerOverride` check
- [x] Add conditional reset button
- [x] Add explanatory text for users

### Milestone 6: Command Palette Entry (Optional)

Add command to open server settings:

```typescript
// In layout.tsx command.register():
{
  id: "settings.server",
  title: "Server settings",
  category: "Settings",
  onSelect: () => dialog.show(() => <DialogServerSettings />),
}
```

**Tasks**:
- [x] Add command registration in layout.tsx
- [ ] Test command palette search

## Step-by-Step Implementation Order

1. [x] Create `packages/app/src/lib/server-url.ts` with all utilities
2. [x] Modify `packages/app/src/app.tsx` to use new URL resolution
3. [x] Create `packages/app/src/components/dialog-server-settings.tsx`
4. [x] Add sidebar button in `packages/app/src/pages/layout.tsx`
5. [x] Add error recovery in `packages/app/src/pages/error.tsx`
6. [x] (Optional) Add command palette entry
7. [ ] Manual testing of all scenarios
8. [x] Run `bun typecheck` in packages/app

## Validation Criteria

### Functional Tests (Manual)

- [ ] **Default behavior preserved**: Without stored URL, app uses existing resolution logic
- [ ] **Query param override**: `/?url=http://localhost:5000` sets and persists URL
- [ ] **Query param validation**: Invalid URLs (e.g., `/?url=not-a-url`) are ignored
- [ ] **Stored URL used**: After setting via query/dialog, reload uses stored URL
- [ ] **Dialog set URL**: Setting URL via dialog shows toast and reloads
- [ ] **Dialog clear URL**: Clearing override reloads with default resolution
- [ ] **History tracking**: Last 5 URLs appear in dialog
- [ ] **History deduplication**: Same URL doesn't appear twice
- [ ] **Error recovery**: Connection error shows reset button when override set
- [ ] **HTTPS preserved**: On HTTPS host, same-origin still works without override
- [ ] **Tauri preserved**: Desktop app with `__OPENCODE__.port` still works
- [ ] **shuv.ai preserved**: Known host detection still triggers same-origin

### Mixed Content Warning Tests (on desktop.shuv.ai or any HTTPS host)

- [ ] **No warning for localhost**: Entering `http://localhost:4096` shows NO warning
- [ ] **No warning for 127.0.0.1**: Entering `http://127.0.0.1:4096` shows NO warning
- [ ] **No warning for HTTPS**: Entering `https://my-server.com` shows NO warning
- [ ] **Warning for HTTP LAN IP**: Entering `http://192.168.1.100:4096` shows warning
- [ ] **Warning for HTTP domain**: Entering `http://my-server.com` shows warning
- [ ] **No warning on HTTP page**: When app is served over HTTP, no warnings shown

### Build Verification

- [x] `bun typecheck` passes in packages/app
- [ ] `bun build` succeeds
- [ ] No console errors on load

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Regression in URL resolution | High | Preserve existing logic exactly; only add localStorage read before it |
| Invalid URL breaks app | High | Validate URLs before storage; provide reset mechanism |
| Mixed content on HTTPS | Medium | Validate protocol; warn if setting HTTP URL on HTTPS page |
| Reload loop if bad URL | Medium | Error page reset button; clear localStorage in devtools docs |
| History grows unbounded | Low | Cap at 5 entries; oldest removed automatically |

## Security Considerations

1. **XSS via URL parameter**: URLs are used as SDK base URL, not rendered as HTML. Low risk.
2. **Open redirect**: Not applicable - URL is for API calls, not navigation.
3. **Mixed content**: 
   - Browser blocks HTTP API calls from HTTPS pages (except localhost)
   - Dialog shows warning when user enters a risky URL
   - URL is still saved (user may know what they're doing), but warning educates
   - `localhost` and `127.0.0.1` are exempt (browser secure context exception)
4. **localStorage access**: Standard browser storage, no sensitive data stored.

## Future Enhancements (Out of Scope)

- URL connection test before saving (ping endpoint)
- Multiple server profiles with names
- Import/export settings
- Sync settings across devices

## File Structure After Implementation

```
packages/app/src/
├── lib/
│   └── server-url.ts          # NEW - URL utilities
├── components/
│   ├── dialog-server-settings.tsx  # NEW - Settings dialog
│   └── ...existing...
├── pages/
│   ├── layout.tsx             # MODIFIED - sidebar button
│   ├── error.tsx              # MODIFIED - reset button
│   └── ...existing...
└── app.tsx                    # MODIFIED - URL resolution
```
