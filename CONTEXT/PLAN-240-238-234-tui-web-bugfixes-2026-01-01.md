# Plan: Resolve Issues #240, #238, #234 - TUI/Web Bugfixes

**Date:** 2026-01-01  
**Issues:** [#240](https://github.com/Latitudes-Dev/shuvcode/issues/240), [#238](https://github.com/Latitudes-Dev/shuvcode/issues/238), [#234](https://github.com/Latitudes-Dev/shuvcode/issues/234)  
**Branch:** `shuvcode-dev`  
**Estimated Effort:** Low-Medium (mostly localized changes)

---

## Executive Summary

This plan addresses three open issues in the shuvcode fork:

1. **Issue #240**: AskQuestion tool dialog not appearing in TUI or Web
2. **Issue #238**: Spinner customization not applied consistently across TUI components
3. **Issue #234**: OpenCode "O" logo mark incorrectly showing in sidebar (branding issue)

All three issues are isolated bugs that can be fixed independently without affecting each other.

---

## Issue #240: AskQuestion Tool Broken

### Problem Description

The `askquestion` tool is invoked correctly by the LLM, but the dialog/wizard UI does not appear. In TUI, the dialog is wired but appears not to render under current conditions; in Web, the wizard component is imported but there is no pending detection or render path in `session.tsx`, so the UI is effectively unimplemented.

This regression appears to have occurred during a recent upstream merge (likely v1.0.220-v1.0.222 sync).

### Technical Analysis

#### How AskQuestion Works

1. **Tool invocation** (`packages/opencode/src/tool/askquestion.ts:19-46`):
   - Sets metadata with `status: "waiting"` and questions array via `ctx.metadata()`
   - Registers pending request with `AskQuestion.register()`
   - Awaits promise resolution from user response

2. **State synchronization**:
   - Part updates flow via `message.part.updated` events
   - Web: `packages/app/src/context/global-sync.tsx:330-349`
   - TUI: `packages/opencode/src/cli/cmd/tui/context/sync.tsx:213+`

3. **UI detection logic**:
   - TUI: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:402-429` - `pendingAskQuestionFromSync()` memo
   - Web: **missing** — `packages/app/src/pages/session.tsx` currently only imports `AskQuestionWizard` and does not compute pending askquestion state.

4. **UI rendering**:
   - TUI: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1572-1608` - `DialogAskQuestion` in `Switch/Match`
   - Web: **missing** — no `Switch/Match` branch renders `AskQuestionWizard` in `packages/app/src/pages/session.tsx`.

#### Potential Root Causes

1. **Web missing implementation**: No pending askquestion detection or wizard render path in `packages/app/src/pages/session.tsx`
2. **Event propagation**: `message.part.updated` events may not be reaching the UI layer (TUI/Web)
3. **Sync timing**: Part metadata may not be populated when the memo evaluates (TUI)
4. **Switch/Match ordering**: SolidJS `Switch/Match` may have ordering issues (TUI only if dialog is actually rendered)

#### TUI Detection Logic (Known Working Pattern)

```typescript
// packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:402-429
const pendingAskQuestionFromSync = createMemo(() => {
  const sessionMessages = sync.data.message[route.sessionID] ?? []

  for (const message of [...sessionMessages].reverse()) {
    const parts = sync.data.part[message.id] ?? []

    for (const part of [...parts].reverse()) {
      if (part.type !== "tool") continue
      const toolPart = part as ToolPart

      if (toolPart.tool !== "askquestion") continue
      if (toolPart.state.status !== "running") continue

      const metadata = toolPart.state.metadata as { status?: string; questions?: AskQuestion.Question[] } | undefined

      if (metadata?.status !== "waiting") continue

      return {
        callID: toolPart.callID,
        messageId: toolPart.messageID,
        questions: (metadata.questions ?? []) as AskQuestion.Question[],
      }
    }
  }

  return null
})
```

### Investigation Tasks

- [x] **1.1** Confirm TUI `pendingAskQuestionFromSync()` is hit by verifying `sync.data.message` and `sync.data.part` are populated for askquestion tool parts
- [x] **1.2** Verify `message.part.updated` events arrive with correct data in both TUI and Web sync stores (`global-sync.tsx` and `tui/context/sync.tsx`)
- [x] **1.3** Confirm Web session page has no pending askquestion detection or render path (baseline before implementation)
- [x] **1.4** Validate `Switch/Match` ordering in TUI once dialog is shown
- [x] **1.5** Test Web wizard render with a temporary hardcoded pending state (to validate UI independently of sync)

### Implementation Tasks

- [x] **1.6** Implement Web pending askquestion detection in `packages/app/src/pages/session.tsx` using the TUI scan pattern over `sync.data.message` and `sync.data.part`
- [x] **1.7** Render `AskQuestionWizard` in Web `Switch/Match` when pending state exists; wire submit/cancel to `/askquestion/respond` and `/askquestion/cancel`
- [x] **1.8** Fix TUI `pendingAskQuestionFromSync()` or sync propagation if missing tool parts (TUI already working)
- [x] **1.9** Ensure `Switch/Match` ordering is correct where askquestion render branches are added
- [ ] **1.10** Write test to verify askquestion detection works (in `packages/opencode/test/`) and add a basic web component test if available

### Web Implementation Outline (Session Page)

Add pending detection and render branch in `packages/app/src/pages/session.tsx` based on the TUI scan pattern:

```ts
// Pseudocode outline for web session
// Preferred client: useSDK() for per-project/session context
const pendingAskQuestion = createMemo(() => {
  const sessionMessages = sync.data.message[params.id!] ?? []
  for (const message of [...sessionMessages].reverse()) {
    const parts = sync.data.part[message.id] ?? []
    for (const part of [...parts].reverse()) {
      if (part.type !== "tool") continue
      const toolPart = part as ToolPart
      if (toolPart.tool !== "askquestion") continue
      if (toolPart.state.status !== "running") continue
      const metadata = toolPart.state.metadata as { status?: string; questions?: AskQuestionQuestion[] } | undefined
      if (metadata?.status !== "waiting") continue
      return { callID: toolPart.callID, messageId: toolPart.messageID, questions: metadata.questions ?? [] }
    }
  }
  return null
})

<Switch>
  <Match when={pendingAskQuestion()}>
    {(pending) => (
      <AskQuestionWizard
        questions={pending().questions}
        onSubmit={(answers) => sdk.client.askquestion.respond({ callID: pending().callID, sessionID: params.id!, answers })}
        onCancel={() => sdk.client.askquestion.cancel({ callID: pending().callID, sessionID: params.id! })}
      />
    )}
  </Match>
  {/* existing branches */}
</Switch>
```

### Validation Criteria

- [ ] Enable `experimental.askquestion_tool: true` in config
- [ ] LLM invokes `askquestion` tool with valid questions
- [ ] TUI: `DialogAskQuestion` dialog appears with questions
- [ ] Web: `AskQuestionWizard` wizard appears with questions
- [ ] User can select options and submit
- [ ] Answers are sent to `/askquestion/respond` endpoint
- [ ] Cancel sends `/askquestion/cancel` and resolves pending request
- [ ] Tool completes with formatted user responses

### Related Files

| File | Purpose |
|------|---------|
| `packages/opencode/src/tool/askquestion.ts` | Tool definition |
| `packages/opencode/src/askquestion/index.ts` | Core module with bus events |
| `packages/app/src/pages/session.tsx` | Web session page - pending detection + wizard render (to add) |
| `packages/app/src/components/askquestion-wizard.tsx` | Web wizard component |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | TUI session with dialog rendering |
| `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx` | TUI dialog component |
| `packages/app/src/context/global-sync.tsx` | Web event handling |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | TUI event handling |
| `packages/opencode/src/tool/registry.ts` | Tool registration (experimental flag) |

### Configuration Note

```typescript
// packages/opencode/src/tool/registry.ts:110
...(config.experimental?.askquestion_tool === true ? [AskQuestionTool] : [])
```

Ensure `experimental.askquestion_tool: true` is set in config when testing.

---

## Issue #238: Restore Spinner Customization

### Problem Description

The TUI spinner customization system exists and works for some components, but is not being used in two key places:

1. **Prompt loading indicator** - Uses hardcoded Knight Rider style spinner
2. **Session list dialog** - Uses hardcoded braille frames

Users who customize their spinner style via "Change spinner style" command won't see their preferences reflected in these locations.

### Current State

#### Configurable Spinner System (Working)

- **Location**: `packages/opencode/src/cli/cmd/tui/util/spinners.ts`
- **Features**: 60+ spinner styles, configurable interval (20-500ms), persisted via KV store
- **Already using configurable spinners**:
  - Sidebar active session indicator (`sidebar.tsx:217`)
  - Bash tool output (`session/index.tsx:2245`)
  - Session loading indicator (`session/index.tsx:1422`)
  - ToolTitle component (`session/index.tsx:2167`)

#### Not Using Configurable System

| Location | Current Implementation | Issue |
|----------|----------------------|-------|
| `dialog-session-list.tsx:28` | Hardcoded `["⠋", "⠙", ...]` array | Never reads user preference |
| `prompt/index.tsx:1268` | Knight Rider `spinnerDef()` | Uses `createFrames()` from `ui/spinner.ts` |

### Implementation Tasks

#### Option A: Integrate `getSpinnerFrame()` (Recommended - Simpler)

- [x] **2.1** Update `dialog-session-list.tsx` to use `getSpinnerFrame()` instead of hardcoded frames

**Current code** (`dialog-session-list.tsx:28,51-53`):
```typescript
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
// ...
<spinner frames={spinnerFrames} interval={80} color={theme.primary} />
```

**Target code**:
```typescript
import { getSpinnerFrame } from "../../util/spinners"
// ...
<text fg={theme.primary}>{getSpinnerFrame()}</text>
```

- [x] **2.2** Update `prompt/index.tsx` to use `getSpinnerFrame()` for loading spinner

**Current code** (`prompt/index.tsx:942-960,1268`):
```typescript
const spinnerDef = createMemo(() => {
  const frames = createFrames(/* Knight Rider params */)
  return { frames, interval: 120, color: theme.primary }
})
// ...
<spinner ... frames={spinnerDef().frames}>
```

**Target code**:
```typescript
import { getSpinnerFrame } from "../../util/spinners"
// ...
<text fg={spinnerColor}>{getSpinnerFrame()}</text>
```

- [x] **2.3** Remove unused `spinnerDef` memo and Knight Rider import if no longer needed

#### Option B: Add Knight Rider to Configurable Options (More Complete)

- [ ] **2.4** (Optional) Add Knight Rider style as an option in `util/spinners.ts`
  - Convert `createFrames()` output to static frame array
  - Add to `SPINNERS` record as `KNIGHT_RIDER` or similar

### Reference: Existing Pattern

The sidebar already demonstrates the correct pattern:

```typescript
// packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx:12,217
import { getSpinnerFrame } from "../../util/spinners"
// ...
{isActive() ? getSpinnerFrame() : isError() ? "✗" : "✓"}
```

### Files to Modify

| File | Changes |
|------|---------|
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | Remove Knight Rider spinnerDef, use `getSpinnerFrame()` |
| `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx` | Remove hardcoded frames, use `getSpinnerFrame()` |

### Validation Criteria

- [ ] User's spinner style preference from "Change spinner style" is used in prompt loading area
- [ ] User's spinner style preference is used in session list dialog
- [ ] User's spinner interval preference is respected in both locations
- [ ] `animations_enabled` setting still works as a fallback (shows static indicator when disabled)
- [ ] No visual regression for users who haven't customized their spinner (default `DUAL_DOTS_SPIN` applies)

---

## Issue #234: Remove OpenCode 'O' Logo Mark from Sidebar

### Problem Description

During the merge of upstream v1.0.221, the OpenCode logo mark ("O" icon) was re-introduced into the sidebar menu. This is visible at the top of the sidebar when collapsed or expanded.

The merge commit explicitly noted adopting upstream's `Mark` logo, but this should not have been kept since shuvcode is a fork with different branding.

### Current State

The `Mark` component (OpenCode "O" SVG) appears in the sidebar:

**File**: `packages/app/src/pages/layout.tsx:923-926`
```tsx
<Show when={!sidebarProps.mobile}>
  <A href="/" class="shrink-0 h-8 flex items-center justify-start px-2" data-tauri-drag-region>
    <Mark class="shrink-0" />
  </A>
</Show>
```

The `Mark` component is imported on line 20:
```tsx
import { Mark } from "@opencode-ai/ui/logo"
```

### Implementation Tasks

- [x] **3.1** Remove the `Mark` logo link from sidebar in `layout.tsx` (lines 923-927)

```diff
const SidebarContent = (sidebarProps: { mobile?: boolean }) => {
  const expanded = () => sidebarProps.mobile || layout.sidebar.opened()
  return (
    <>
      <div class="flex flex-col items-start self-stretch gap-4 p-2 min-h-0 overflow-hidden">
-       <Show when={!sidebarProps.mobile}>
-         <A href="/" class="shrink-0 h-8 flex items-center justify-start px-2" data-tauri-drag-region>
-           <Mark class="shrink-0" />
-         </A>
-       </Show>
        <Show when={!sidebarProps.mobile}>
          <TooltipKeybind
            ...
```

- [x] **3.2** Remove unused `Mark` import from line 20

```diff
- import { Mark } from "@opencode-ai/ui/logo"
```

- [ ] **3.3** Test sidebar appearance on desktop (collapsed and expanded states)
- [ ] **3.4** Test sidebar appearance on mobile (ensure no layout shifts)
- [x] **3.5** Update `script/sync/fork-features.json` to document this as a fork-specific change

### fork-features.json Update

Add to the `removedFeatures` array or create a new entry in `features`:

```json
{
  "pr": 0,
  "title": "Remove OpenCode Mark logo from sidebar",
  "author": "fork",
  "status": "fork-only",
  "description": "Sidebar uses shuvcode branding only. The OpenCode 'O' Mark logo is removed from the sidebar header area.",
  "files": ["packages/app/src/pages/layout.tsx"],
  "criticalCode": [
    {
      "file": "packages/app/src/pages/layout.tsx",
      "description": "Mark logo link removed from SidebarContent",
      "markers": ["No Mark import", "No <Mark class="]
    }
  ]
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `packages/app/src/pages/layout.tsx` | Remove `Mark` import and logo block |
| `script/sync/fork-features.json` | Document removal for merge conflict prevention |

### Validation Criteria

- [ ] OpenCode "O" logo no longer appears at top of sidebar
- [ ] Sidebar toggle button remains functional
- [ ] Layout is correct on desktop (collapsed/expanded)
- [ ] Layout is correct on mobile
- [ ] No console errors related to missing components

---

## Implementation Order

```
Phase 1: Quick Wins (Independent, Low Risk)
├── Issue #234: Remove Mark logo (5 min)
│   └── Single file change, no logic changes
└── Issue #238: Spinner customization (15 min)
    └── Pattern already established, just apply to 2 files

Phase 2: Investigation & Fix (Medium Effort)
└── Issue #240: AskQuestion debugging (30-60 min)
    ├── Add logging to identify root cause
    ├── Compare TUI vs Web implementation
    └── Apply fix based on findings
```

### Suggested Order

1. **Issue #234** - Fastest, single file change, no risk
2. **Issue #238** - Straightforward pattern application
3. **Issue #240** - Requires investigation, may need debugging

---

## Testing Strategy

### Manual Testing

```bash
# Start dev server for TUI
cd packages/opencode && bun dev

# In another terminal, test Web UI
cd packages/app && bun dev
```

### Issue #240 Testing Steps

1. Enable experimental config:
   ```yaml
   # opencode.yaml
   experimental:
     askquestion_tool: true
   ```

2. Send a message that triggers askquestion tool usage

3. Verify:
   - TUI: DialogAskQuestion appears
   - Web: AskQuestionWizard appears
   - Responses are captured and returned to LLM

### Issue #238 Testing Steps

1. Open command palette (`Ctrl+K`)
2. Select "Change spinner style"
3. Choose a distinct spinner (e.g., `MOON_PHASE`)
4. Verify spinner appears in:
   - Prompt loading indicator
   - Session list dialog (when sessions are loading)
   - Sidebar active session indicator (existing)

### Issue #234 Testing Steps

1. Open the desktop/web app
2. Verify sidebar does NOT show "O" logo at top
3. Toggle sidebar open/closed
4. Check mobile view

### Automated Tests

- [ ] Write test for askquestion detection in `packages/opencode/test/tool/`
- [ ] Add a basic web wizard render test if a harness exists in `packages/app`
- [ ] Run existing test suite: `bun test` in `packages/opencode`

---

## External References

| Resource | URL |
|----------|-----|
| cli-spinners | https://github.com/sindresorhus/cli-spinners |
| ora | https://github.com/sindresorhus/ora |
| SolidJS Reactivity | https://www.solidjs.com/docs/latest/api#creatememo |

---

## Rollback Plan

All changes are isolated and can be reverted independently:

```bash
# Revert specific file changes
git checkout HEAD -- packages/app/src/pages/layout.tsx
git checkout HEAD -- packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx
git checkout HEAD -- packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx
```

---

## Definition of Done

- [ ] All three issues resolved
- [ ] Tests pass: `bun test` in packages/opencode
- [ ] Manual testing completed for each issue
- [ ] `fork-features.json` updated for Issue #234
- [ ] No regressions in existing functionality
- [ ] Changes committed with descriptive message
