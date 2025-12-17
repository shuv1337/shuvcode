## Summary

Add `/share` and `/unshare` slash commands to the Desktop UI to match existing TUI functionality, achieving feature parity for session sharing.

This plan is derived from GitHub issue #135 and existing code references in both the TUI and Desktop packages.

## Source Issue

- GitHub issue: https://github.com/Latitudes-Dev/shuvcode/issues/135

## Context & Decisions

### Problem Statement

The TUI already supports sharing and unsharing sessions via `/share` and `/unshare`. Desktop currently lacks these commands, causing feature parity gaps.

### Key Existing Behaviors (TUI)

- `/share`: calls the SDK share endpoint and copies returned URL to clipboard.
- `/unshare`: calls the SDK unshare endpoint.
- Both provide toast notifications and basic error handling.

Internal reference implementations:

- TUI share/unshare command registration: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- TUI slash autocomplete entries: `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`

### Desktop Command System Constraints (Important)

The Desktop command system treats `disabled: true` as “not shown / not selectable” in both:

- Command palette: `packages/desktop/src/context/command.tsx`
- Slash command autocomplete: `packages/desktop/src/components/prompt-input.tsx`

Decision:

- Implement “disabled” semantics as “hidden/unavailable” in Desktop, consistent with existing command behavior.
  - This satisfies the intent of issue #135 (prevent user from invoking `/share` when already shared, prevent `/unshare` when not shared), even though the term “disabled” could be interpreted as “shown but not selectable.”
  - If the product requirement later changes to “show disabled commands,” that will require follow-up changes in `packages/desktop/src/context/command.tsx` and `packages/desktop/src/components/prompt-input.tsx` to render disabled options.

### Share Feature Flag

Decision:

- Gate the `/share` command on `sync.data.config.share !== "disabled"` (same semantics as the issue’s acceptance criteria).

### Clipboard Strategy

Decision:

- Use `navigator.clipboard.writeText(url)` as the primary approach.
- Add a fallback path (optional but recommended) for environments where `navigator.clipboard` is unavailable or rejected.
  - This improves robustness for non-secure contexts and unusual browser/webview setups.

## Requirements (Acceptance Criteria Mapping)

From issue #135:

- [ ] `/share` command is available in the desktop command palette and slash command autocomplete
- [ ] `/share` calls `sdk.client.session.share()` API endpoint
- [ ] On successful share, the URL is copied to clipboard
- [ ] User receives toast notification confirming "Share URL copied to clipboard!"
- [ ] `/share` is disabled when session already has a share URL
- [ ] `/share` is only shown when `sync.data.config.share !== "disabled"`
- [ ] `/unshare` command is available when a session has an active share URL
- [ ] `/unshare` calls `sdk.client.session.unshare()` API endpoint
- [ ] User receives toast notification confirming "Session unshared"
- [ ] Error handling with toast notifications for failed operations

## Current State (Codebase Survey)

### Desktop Files Involved

- Command registration for session page:
  - `packages/desktop/src/pages/session.tsx`
- Slash autocomplete logic:
  - `packages/desktop/src/components/prompt-input.tsx`
- Command palette implementation + `disabled` filtering:
  - `packages/desktop/src/context/command.tsx`
- Sync/config/session state (share config + session info):
  - `packages/desktop/src/context/sync.tsx`
  - `packages/desktop/src/context/global-sync.tsx`
- Toast notification utility:
  - `packages/ui/src/components/toast.tsx` (`showToast`)

### TUI Reference Behavior

- Share command registration uses `sdk.client.session.share({ sessionID })` and copies returned URL.
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

### API & SDK References

- Server endpoints:
  - Share: `POST /session/:sessionID/share` (`operationId: session.share`)
  - Unshare: `DELETE /session/:sessionID/share` (`operationId: session.unshare`)
  - `packages/opencode/src/server/server.ts`

- SDK methods:
  - `sdk.client.session.share({ sessionID, directory? })`
  - `sdk.client.session.unshare({ sessionID, directory? })`
  - `packages/sdk/js/src/v2/gen/sdk.gen.ts`

- Data model:
  - Session includes `share?: { url: string }`
  - `packages/sdk/js/src/v2/gen/types.gen.ts`

- Config gating:
  - `config.share?: "manual" | "auto" | "disabled"`
  - `packages/sdk/js/src/v2/gen/types.gen.ts`

## Technical Specification

### Commands to Add (Desktop)

Add two command options to the existing `command.register(() => [...])` call in `packages/desktop/src/pages/session.tsx`:

#### `session.share`

- `id`: `"session.share"`
- `title`: `"Share session"`
- `description`: `"Create a shareable link for the session"`
- `category`: `"Session"`
- `slash`: `"share"`
- `disabled` conditions:
  - No session is selected (`!params.id`)
  - Session already has a share URL (`!!info()?.share?.url`)
  - Share is disabled in config (`sync.data.config.share === "disabled"`)

#### `session.unshare`

- `id`: `"session.unshare"`
- `title`: `"Unshare session"`
- `description`: `"Remove the shareable link"`
- `category`: `"Session"`
- `slash`: `"unshare"`
- `disabled` conditions:
  - No session is selected (`!params.id`)
  - Session has no share URL (`!info()?.share?.url`)

### Command Availability Matrix

| Context                                               | `sync.data.config.share`        | `info()?.share?.url` | `/share` visible? |                                   `/unshare` visible? |
| ----------------------------------------------------- | ------------------------------- | -------------------- | ----------------: | ----------------------------------------------------: |
| No session selected                                   | any                             | n/a                  |                No |                                                    No |
| Session selected, not shared                          | `"manual"`/`"auto"`/`undefined` | falsy                |               Yes |                                                    No |
| Session selected, already shared                      | `"manual"`/`"auto"`/`undefined` | truthy               |                No |                                                   Yes |
| Session selected, sharing disabled                    | `"disabled"`                    | falsy                |                No |                                                    No |
| Session selected, sharing disabled but already shared | `"disabled"`                    | truthy               |                No | Yes (issue did not explicitly forbid showing unshare) |

Decision (for the last row):

- Keep `/unshare` available when a share URL exists, even if config.share is disabled. The acceptance criteria only gates `/share` visibility.

### API Call Details

#### Share

- SDK call:
  - `await sdk.client.session.share({ sessionID: params.id })`
- Expected response shape:
  - `res.data?.share?.url` contains the shareable URL.

#### Unshare

- SDK call:
  - `await sdk.client.session.unshare({ sessionID: params.id })`

### Clipboard Copy

Primary:

- `await navigator.clipboard.writeText(url)`

Recommended fallback (if needed):

- Create a temporary `<textarea>` or `<input>` element, select it, and call `document.execCommand('copy')`.

### Toast Notifications

Use `showToast` from `@opencode-ai/ui/toast`.

Success messages (exact strings required by issue):

- Share: `"Share URL copied to clipboard!"`
- Unshare: `"Session unshared"`

Error messages (recommended, matches acceptance criteria intent):

- Share failure: `"Failed to share session"`
- Unshare failure: `"Failed to unshare session"`

Internal toast implementation reference:

- `packages/ui/src/components/toast.tsx`

## External References (Optional)

These are potential references for clipboard fallback patterns if Desktop’s webview environment makes `navigator.clipboard` unreliable:

- `https://github.com/sindresorhus/copy-text-to-clipboard`
  - Lightweight copy helper with browser fallback behavior.

- `https://github.com/lgarron/clipboard-polyfill`
  - Clipboard polyfill that supports more environments than `navigator.clipboard` alone.

- `https://github.com/github/clipboard-copy-element`
  - Web component approach to clipboard copy (more UI-driven).

Decision:

- Do not add new dependencies unless `navigator.clipboard.writeText` proves unreliable in Desktop’s supported environments.

## Implementation Plan

> Reminder: This is a plan only; do not implement while executing this document.

### Milestone 1 — Add Command Definitions

- [ ] In `packages/desktop/src/pages/session.tsx`, locate the `command.register(() => [...])` block.
- [ ] Add import for toast utility:
  - [ ] `import { showToast } from "@opencode-ai/ui/toast"`
- [ ] Add a `session.share` command option with:
  - [ ] `slash: "share"`
  - [ ] `disabled` logic matching the matrix above
  - [ ] `onSelect` handler that calls `sdk.client.session.share({ sessionID })`
- [ ] Add a `session.unshare` command option with:
  - [ ] `slash: "unshare"`
  - [ ] `disabled` logic matching the matrix above
  - [ ] `onSelect` handler that calls `sdk.client.session.unshare({ sessionID })`

### Milestone 2 — Clipboard + Toast Behavior

- [ ] Implement share success path behavior (in the `onSelect` for `session.share`):
  - [ ] Extract `url` from `res.data?.share?.url`
  - [ ] Copy `url` to clipboard
  - [ ] Show toast: `showToast({ title: "Share URL copied to clipboard!", variant: "success" })`
- [ ] Implement unshare success path behavior:
  - [ ] Show toast: `showToast({ title: "Session unshared", variant: "success" })`
- [ ] Implement error handling:
  - [ ] Catch errors from share/unshare SDK calls
  - [ ] Show error toasts (`variant: "error"`) with appropriate messaging
- [ ] Decide on clipboard failure behavior:
  - [ ] Option A (strict): treat clipboard failure as an error and show `"Failed to copy share URL"`
  - [ ] Option B (user-friendly): show `"Share URL copied to clipboard!"` only if copy succeeded; otherwise show `"Share created, but copy failed"`
  - [ ] Pick one and document in PR description

### Milestone 3 — Command Palette + Slash Autocomplete Integration

- [ ] Verify Desktop command palette shows the new commands when eligible:
  - [ ] Command palette is driven by `packages/desktop/src/context/command.tsx`
  - [ ] Ensure commands have `category: "Session"` so they appear grouped
- [ ] Verify slash autocomplete shows `/share` and `/unshare` when eligible:
  - [ ] Slash autocomplete reads from `command.options` in `packages/desktop/src/components/prompt-input.tsx`
  - [ ] Confirm `slash: "share"` and `slash: "unshare"` triggers appear
- [ ] Confirm that disabled commands are not shown (current Desktop semantics):
  - [ ] `/share` hidden when already shared
  - [ ] `/unshare` hidden when not shared

### Milestone 4 — Sync/State Refresh (If Needed)

- [ ] Confirm session share status updates after share/unshare:
  - [ ] Desktop global sync updates session list on `session.updated` events (`packages/desktop/src/context/global-sync.tsx`)
- [ ] If UI does not update quickly enough, consider one of:
  - [ ] Call `sync.session.sync(sessionID)` after successful share/unshare (heavier refresh)
  - [ ] Optimistically update local session state (requires careful store updates)
  - [ ] Re-fetch `sdk.client.session.get({ sessionID })` and patch store (lighter refresh)

Decision:

- Prefer relying on existing `session.updated` event flow first; only add manual refresh if necessary.

## Validation Criteria

### Functional Validation (Manual)

- [ ] With a session open and `sync.data.config.share !== "disabled"`:
  - [ ] `/share` appears in slash autocomplete and command palette
  - [ ] Running `/share` copies URL to clipboard and shows success toast
  - [ ] After sharing, `/share` no longer appears and `/unshare` appears
- [ ] With a session open that has `info()?.share?.url`:
  - [ ] `/unshare` appears
  - [ ] Running `/unshare` shows success toast and makes session private again
  - [ ] After unsharing, `/unshare` no longer appears and `/share` appears (if config allows)
- [ ] With `sync.data.config.share === "disabled"`:
  - [ ] `/share` does not appear
  - [ ] `/unshare` appears only if session is already shared (per decision above)
- [ ] Error handling:
  - [ ] Force an API failure (e.g., stop server, use invalid sessionID) and confirm error toast appears

### Technical Validation

Per `packages/desktop/AGENTS.md`:

- [ ] Run typecheck only:

```bash
bun run typecheck
```

(Do not add or run automated tests for Desktop; do not run build for validation.)

### Dev Setup Notes (If Manual QA Needed)

From `packages/desktop/AGENTS.md`:

```bash
# Terminal 1 (repo root)
bun run dev serve --port 4096

# Terminal 2 (packages/desktop)
bun run dev
```

## Risks & Edge Cases

- Clipboard API may fail if the webview is not considered a secure context or lacks permission.
  - Mitigation: fallback copy method or optional dependency.
- Share endpoint may return a session without `share.url` in error states.
  - Mitigation: guard on `res.data?.share?.url` and show error toast if missing.
- Config may omit `share` field; treat as enabled unless explicitly `"disabled"`.

## Deliverables

- [ ] Desktop includes `/share` and `/unshare` commands as described.
- [ ] Behavior matches acceptance criteria from issue #135.
- [ ] Plan does not modify server or SDK (endpoints already exist).
