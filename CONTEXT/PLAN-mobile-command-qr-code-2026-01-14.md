# Plan: Add `/mobile` Built-in Command for QR Code Session URL

**Created:** 2026-01-14  
**Status:** Draft  
**Scope:** Add a new `/mobile` slash command that generates a QR code with the URL to open the currently running session in the web UI

---

## Overview

Add a built-in `/mobile` command that allows users to quickly open their current session on a mobile device by scanning a QR code displayed in the terminal. This enables seamless cross-device session handoff.

### User Story

As a developer using Shuvcode in my terminal, I want to quickly continue my session on my mobile device without manually typing URLs, so that I can review/monitor AI responses while away from my desk.

---

## Technical Context

### Command System Architecture

The codebase has two types of slash commands:

1. **Template Commands** (`type: "template"`) - AI-processed commands defined in `Command.state`
2. **Plugin Commands** (`type: "plugin"`) - Execute arbitrary code via `plugin.command` hook

For `/mobile`, we need a **plugin command** since it requires:

- Accessing the server URL programmatically
- Generating a QR code (no AI processing needed)
- Rendering QR output inside the TUI

### Key Files

| File                                                 | Purpose                                    |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/opencode/src/command/index.ts`             | Command listing + plugin command discovery |
| `packages/opencode/src/session/prompt.ts:1657-1699`  | Plugin command execution flow              |
| `packages/opencode/src/server/server.ts:69-71`       | `Server.url()` function                    |
| `packages/opencode/src/server/server.ts:2826-2838`   | Web UI proxy (`app.shuv.ai`)               |
| `packages/opencode/src/cli/cmd/tui/event.ts`         | TuiEvent definitions                       |
| `packages/opencode/src/cli/cmd/tui/app.tsx`          | TUI event handling + dialogs               |
| `packages/opencode/src/cli/cmd/tui/ui/dialog-qr.tsx` | QR dialog UI                               |
| `packages/app/src/app.tsx:31-35`                     | Web UI route `/:dir/session/:id?`          |
| `packages/app/src/pages/directory-layout.tsx:15-17`  | Base64 decode for `:dir`                   |
| `packages/util/src/encode.ts:1-5`                    | `base64Encode` helper                      |
| `packages/sdk/js/src/v2/client.ts:8-28`              | SDK v2 client + directory header           |
| `packages/plugin/src/index.ts:225-236`               | `plugin.command` hook interface            |

### Server URL Access

```typescript
// packages/opencode/src/server/server.ts:66-71
let _url: URL | undefined

export function url(): URL {
  return _url ?? new URL("http://localhost:4096")
}
```

### Plugin Command Interface

```typescript
// packages/plugin/src/index.ts:225-236
"plugin.command"?: {
  [name: string]: {
    description: string
    aliases?: string[]
    sessionOnly?: boolean
    execute(input: {
      sessionID: string
      arguments: string
      client: ReturnType<typeof createOpencodeClient>
    }): Promise<void>
  }
}
```

## Review Updates (Required before implementation)

- Use the web UI route `/:dir/session/:id` with a base64-encoded directory slug (`base64Encode`) to match the router decode logic.
- Render the QR inside the TUI via a new event/modal instead of `console.log()` to avoid corrupting the OpenTUI screen.
- Use the SDK v2 client with the `directory` header (or publish `TuiEvent.ToastShow` via `Bus`) since v2 `tui.showToast` does not accept a `body` wrapper.
- Build URLs against the server origin (the server proxies `https://app.shuv.ai` for the web UI), not a separate UI host.
- Plugin commands are auto-discovered from `plugin.command` hooks; skip edits to `packages/opencode/src/command/index.ts`.
- Detect `localhost`/`0.0.0.0` hostnames and warn or resolve a LAN IP (see `packages/opencode/src/cli/cmd/web.ts`).

---

## Implementation Decisions

### Decision 1: Command Type

**Choice:** Plugin command (not template)

**Rationale:**

- No AI processing needed - purely programmatic
- Requires access to server URL + directory context
- Needs to render a QR code inside the TUI

### Decision 2: QR Code Library

**Recommended:** `uqr` from unjs

**Alternatives Evaluated:**

| Library         | Size  | Terminal Support   | Notes                                     |
| --------------- | ----- | ------------------ | ----------------------------------------- |
| `uqr`           | ~5KB  | ANSI, Unicode, SVG | Modern, tree-shakable, active maintenance |
| `qrcode`        | ~30KB | UTF-8, terminal    | Mature, CLI support, larger bundle        |
| `@paulmillr/qr` | ~8KB  | ASCII, GIF         | Fast benchmarks, minimal deps             |

**Rationale for `uqr`:**

- Zero dependencies
- Multiple output formats (ANSI for color terminals, Unicode for basic terminals)
- Active maintenance by unjs team
- Small bundle size
- Works in any JavaScript runtime (Node, Bun, Deno)

**GitHub:** https://github.com/unjs/uqr

### Decision 3: Output Method

**Choice:** TUI modal/event + toast fallback

**Approach:**

1. Generate QR code as ANSI/Unicode string
2. Publish a new `TuiEvent.QrShow` (or similar) so OpenTUI can render a modal/panel with the QR string
3. Show a toast notification with the URL (for copy/paste fallback)

**Notes:** Avoid direct `console.log()` because it can corrupt the OpenTUI renderer.

### Decision 4: URL Construction

The session URL format depends on deployment context:

| Context    | URL Pattern                                                     |
| ---------- | --------------------------------------------------------------- |
| Local TUI  | `http://localhost:{port}/{base64Dir}/session/{sessionID}`       |
| Local Web  | Same as server URL (server proxies `app.shuv.ai` for UI assets) |
| Remote/LAN | `http://{host}:{port}/{base64Dir}/session/{sessionID}`          |

**Implementation:** Use `Server.url()` (or `input.serverUrl`) as base and append `/${base64Encode(directory)}/session/${sessionID}`.

Web UI session routes (from `packages/app/src/app.tsx:31-35` + `packages/app/src/pages/directory-layout.tsx:15-17`):

```
/:dir/session/:id?
```

For direct session access, construct: `{serverUrl}/{base64Dir}/session/{sessionID}`

---

## External References

### QR Code Library - uqr

**GitHub Repository:** https://github.com/unjs/uqr

**Key APIs:**

```typescript
import { encode, renderANSI, renderUnicode, renderUnicodeCompact } from "uqr"

// Generate QR code data
const qr = encode(text, options)

// Render to ANSI (color terminals)
const ansi = renderANSI(text, options)

// Render to Unicode (wide compatibility)
const unicode = renderUnicode(text, options)

// Render compact Unicode (smaller output)
const compact = renderUnicodeCompact(text, options)
```

**Installation:**

```bash
bun add uqr
```

---

## Implementation Plan

### Phase 1: Core Implementation

#### Task 1.1: Add uqr dependency

- [ ] Add `uqr` to `packages/opencode/package.json`
- [ ] Run `bun install` to update lockfile
- [ ] Verify import works: `import { renderUnicode } from 'uqr'`

**File:** `packages/opencode/package.json`

#### Task 1.2: Create mobile command plugin module

- [ ] Create new file `packages/opencode/src/plugin/mobile.ts`
- [ ] Implement QR code generation + URL builder helpers in `packages/opencode/src/plugin/mobile-utils.ts` (ANSI then Unicode fallback)
- [ ] Export internal plugin with `plugin.command` hook

**File to create:** `packages/opencode/src/plugin/mobile.ts`

```typescript
// Skeleton structure
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { buildSessionUrl, renderQrCode } from "./mobile-utils"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export const MobilePlugin = async (input: PluginInput): Promise<Hooks> => ({
  "plugin.command": {
    mobile: {
      description: "Show QR code to open session on mobile device",
      aliases: ["qr"],
      sessionOnly: true,
      execute: async ({ sessionID }) => {
        // Implementation here
      },
    },
  },
})
```

#### Task 1.3: Register internal plugin

- [ ] Import `MobilePlugin` in `packages/opencode/src/plugin/index.ts`
- [ ] Add `MobilePlugin` to the `INTERNAL_PLUGINS` array (plugin commands are auto-discovered)

#### Task 1.4: Implement execute function

- [ ] Build the server base URL from `input.serverUrl`
- [ ] Base64-encode `input.directory` for the `:dir` slug
- [ ] Generate QR code using uqr
- [ ] Publish a TUI event/modal payload containing the QR string + URL
- [ ] Show a toast with the plain URL using the SDK v2 client

**Implementation details:**

```typescript
execute: async ({ sessionID }) => {
  const client = createOpencodeClient({
    baseUrl: input.serverUrl.toString(),
    directory: input.directory,
  })
  const sessionUrl = buildSessionUrl(input.serverUrl, input.directory, sessionID)
  const qrCode = renderQrCode(sessionUrl)

  await Bus.publish(TuiEvent.QrShow, {
    url: sessionUrl,
    qr: qrCode,
  })

  await client.tui.showToast({
    title: "Mobile Access",
    message: sessionUrl,
    variant: "info",
    duration: 10000,
  })
}
```

### Phase 2: Integration

#### Task 2.1: Add TUI QR event + UI

- [ ] Add `TuiEvent.QrShow` schema in `packages/opencode/src/cli/cmd/tui/event.ts` (e.g., `{ url: string; qr: string }`)
- [ ] Create `packages/opencode/src/cli/cmd/tui/ui/dialog-qr.tsx` to render the QR string
- [ ] Handle `TuiEvent.QrShow` in `packages/opencode/src/cli/cmd/tui/app.tsx` by opening the dialog

#### Task 2.2: Register internal plugin

- [ ] Import `MobilePlugin` in `packages/opencode/src/plugin/index.ts`
- [ ] Add `MobilePlugin` to the `INTERNAL_PLUGINS` array

#### Task 2.3: Network accessibility warning

- [ ] If `input.serverUrl.hostname` is `localhost`/`127.0.0.1`/`0.0.0.0`, warn via toast and suggest `--hostname 0.0.0.0`
- [ ] Optionally resolve LAN IPs (reuse logic from `packages/opencode/src/cli/cmd/web.ts`)

#### Task 2.4: Regenerate SDK types (if needed)

- [ ] If TUI event schemas change OpenAPI output, run `./script/generate.ts` to refresh SDK types

### Phase 3: Testing

#### Task 3.1: Add unit tests

- [ ] Create `packages/opencode/test/command/mobile.test.ts`
- [ ] Test URL construction (base64 dir slug + session ID)
- [ ] Test QR code generation
- [ ] Test TUI event payload for QR display
- [ ] Test command execution flow
- [ ] Keep tests in `.ts` by extracting helpers (avoid JSX runtime in tests)

**Reference test pattern:** `packages/opencode/test/command/plugin-commands.test.ts`

#### Task 3.2: Manual testing

- [ ] Run `bun run dev` in `packages/opencode` to start the TUI (`bun run dev -- --hostname 0.0.0.0` for LAN)
- [ ] Execute `/mobile` command in TUI
- [ ] Verify QR dialog renders without corrupting the screen
- [ ] Scan QR code with mobile device
- [ ] Verify session opens correctly in browser

### Phase 4: Polish

#### Task 4.1: Handle edge cases

- [ ] Missing or invalid session ID (show error toast)
- [ ] Missing directory context (show error toast)
- [ ] Terminal doesn't support ANSI (use Unicode fallback)
- [ ] LAN/remote access considerations

#### Task 4.2: Add network accessibility check (optional enhancement)

- [ ] Detect if server is bound to localhost only
- [ ] Warn user if QR code won't work from other devices
- [ ] Suggest using `--hostname 0.0.0.0` for LAN access

---

## File Changes Summary

### New Files

| File                                                 | Description           |
| ---------------------------------------------------- | --------------------- |
| `packages/opencode/src/plugin/mobile.ts`             | Mobile command plugin |
| `packages/opencode/src/plugin/mobile-utils.ts`       | URL/QR helpers        |
| `packages/opencode/src/cli/cmd/tui/ui/dialog-qr.tsx` | TUI QR dialog         |
| `packages/opencode/test/command/mobile.test.ts`      | Unit tests            |

### Modified Files

| File                                         | Changes                            |
| -------------------------------------------- | ---------------------------------- |
| `packages/opencode/package.json`             | Add `uqr` dependency               |
| `packages/opencode/src/plugin/index.ts`      | Register `MobilePlugin` internally |
| `packages/opencode/src/cli/cmd/tui/event.ts` | Add QR TUI event schema            |
| `packages/opencode/src/cli/cmd/tui/app.tsx`  | Handle QR event in OpenTUI         |

---

## API Reference

### uqr Library Usage

```typescript
import { renderANSI, renderUnicode, renderUnicodeCompact } from 'uqr'

// Options interface
interface QROptions {
  ecc?: 'L' | 'M' | 'Q' | 'H'  // Error correction level
  border?: number              // Border size in modules
}

// ANSI output (color terminals)
renderANSI(text: string, options?: QROptions): string

// Unicode output (wide compatibility)
renderUnicode(text: string, options?: QROptions): string

// Compact Unicode (half-height characters)
renderUnicodeCompact(text: string, options?: QROptions): string
```

### SDK Client TUI Methods

```typescript
// Show toast notification (SDK v2)
client.tui.showToast({
  title?: string,
  message: string,
  variant: 'info' | 'success' | 'warning' | 'error',
  duration?: number,  // milliseconds
  directory?: string
})
```

---

## Validation Criteria

### Functional Requirements

- [ ] `/mobile` command is recognized and executable
- [ ] `/qr` alias works (if implemented)
- [ ] QR dialog renders correctly in the TUI
- [ ] QR code encodes correct session URL (with base64 dir slug)
- [ ] Scanning QR code opens session in mobile browser
- [ ] Toast notification shows URL for manual copy
- [ ] Command only works when session exists (`sessionOnly: true`)

### Non-Functional Requirements

- [ ] QR code renders within 100ms
- [ ] No additional runtime dependencies beyond `uqr`
- [ ] Works in both color and monochrome terminals
- [ ] Bundle size increase < 10KB

### Error Handling

- [ ] Graceful fallback when terminal doesn't support ANSI
- [ ] Clear error message when no session or directory exists
- [ ] Handles server URL edge cases (localhost/LAN warnings)

---

## Future Enhancements (Out of Scope)

1. **Copy-to-Clipboard** - Add a button to copy the URL to clipboard
2. **Expiring URLs** - Generate time-limited session tokens for security
3. **Deep Linking** - Support mobile app deep links (if native app exists)
4. **Share Modal Integration** - Add QR code tab to existing share functionality
5. **mDNS Discovery** - Auto-detect server on local network

---

## Risk Assessment

| Risk                                 | Likelihood | Impact | Mitigation                               |
| ------------------------------------ | ---------- | ------ | ---------------------------------------- |
| Terminal doesn't render QR correctly | Medium     | Low    | Provide Unicode fallback, show plain URL |
| TUI event not rendered               | Medium     | Medium | Add QR event schema + dialog handler     |
| Server bound to localhost            | High       | Medium | Warn user, document `--hostname` flag    |
| Large QR code for long URLs          | Low        | Low    | Use compact rendering, error correction  |
| uqr library issues                   | Low        | Medium | Library is well-maintained by unjs       |

---

## Dependencies

### Internal Dependencies

- `packages/opencode/src/server/server.ts` - Server.url() + web UI proxy routing
- `packages/opencode/src/plugin/index.ts` - Internal plugin loading
- `packages/opencode/src/cli/cmd/tui/event.ts` - TUI event schema (add QR event)
- `packages/opencode/src/cli/cmd/tui/app.tsx` - TUI event handling
- `packages/opencode/src/cli/cmd/tui/ui/dialog-qr.tsx` - QR dialog component
- `packages/util/src/encode.ts` - `base64Encode` for `:dir` slug
- `packages/app/src/app.tsx` + `packages/app/src/pages/directory-layout.tsx` - web UI routing
- `packages/sdk/js/src/v2/client.ts` - SDK v2 client with `directory` header

### External Dependencies

- `uqr` - QR code generation (new dependency)

---

## References

- **uqr GitHub:** https://github.com/unjs/uqr
- **Web UI routing:** `packages/app/src/app.tsx:31-35`
- **Dir slug decode:** `packages/app/src/pages/directory-layout.tsx:15-17`
- **Base64 encode helper:** `packages/util/src/encode.ts:1-5`
- **Server URL implementation:** `packages/opencode/src/server/server.ts:66-71`
- **Web UI proxy:** `packages/opencode/src/server/server.ts:2826-2838`
- **Plugin command test:** `packages/opencode/test/command/plugin-commands.test.ts`
- **TuiEvent definitions:** `packages/opencode/src/cli/cmd/tui/event.ts`
- **SDK v2 client:** `packages/sdk/js/src/v2/client.ts:8-28`
- **Plugin hook interface:** `packages/plugin/src/index.ts:225-236`
