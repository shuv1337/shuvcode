## Goal and Scope
Create a web app askquestion wizard UI that matches TUI behavior so sessions no longer hang. This plan covers UI, state detection, endpoint wiring in the web app; no implementation is performed here.

## Source Context and Decisions
### Issue Summary (GitHub #202)
- Problem: Web app has no askquestion UI, so askquestion tool calls hang; resuming a web-app-started session in the TUI shows questions but cannot submit answers.
- Root cause: TUI has complete askquestion handling (detection, UI, submit), web app has none.
- Acceptance criteria: Wizard UI, keyboard/tab navigation, option selection or custom input, submit/cancel behavior, resumed sessions work in both TUI and web app.

### Key Decisions and Rationale
- Mirror TUI detection logic for pending askquestion tool parts to ensure consistent behavior across web app and TUI. This avoids inconsistent state detection and aligns with existing tool metadata behavior.
- Reuse the askquestion endpoints (`/askquestion/respond`, `/askquestion/cancel`) to keep a single server-side behavior path; avoids inventing new API shape.
- Build a dedicated `AskQuestionWizard` component in the web app (SolidJS), modeled after TUI features (wizard tabs, single/multi-select, text input, keyboard shortcuts) to ensure feature parity.
- Use sync-based detection only (via `message.part.updated` events that update tool metadata). The web app's event architecture differs from TUI's bus-based system; the sync context already handles part updates which contain the tool metadata needed for detection.
- Render the wizard inline in the session page (replacing the prompt input area when active), not as a modal overlay. This matches the TUI behavior where the dialog appears in place of the prompt.

## Internal Code References
- TUI detection logic: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:398-427`
- TUI dialog implementation: `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx`
- AskQuestion types (source of truth): `packages/opencode/src/askquestion/index.ts:4-35`
- Server endpoints: `packages/opencode/src/server/server.ts:1585-1653`
- Web app session page (integration point): `packages/app/src/pages/session.tsx`
- Web app sync context: `packages/app/src/context/sync.tsx`
- Web app global sync (event handling): `packages/app/src/context/global-sync.tsx:154-295`
- New component (to add): `packages/app/src/components/askquestion-wizard.tsx`

### Existing UI Components to Reuse
- `packages/ui/src/components/tabs.tsx` - Kobalte-based tabs for wizard navigation
- `packages/ui/src/components/checkbox.tsx` - For multi-select options
- `packages/ui/src/components/button.tsx` - For submit/cancel actions
- `packages/ui/src/components/text-field.tsx` - For custom text input
- `packages/ui/src/context/dialog.tsx` - Dialog context (for reference, but wizard renders inline)

## External References (for UI patterns and APIs)
- https://raw.githubusercontent.com/solidjs-use/solidjs-use/main/packages/core/src/useStepper/index.md
- https://raw.githubusercontent.com/chakra-ui/zag/main/website/data/snippets/solid/tabs/usage.mdx
- https://raw.githubusercontent.com/chakra-ui/zag/main/website/data/snippets/solid/steps/usage.mdx

## Functional Requirements Mapping
| Requirement | Plan Coverage | Notes |
| --- | --- | --- |
| Web app wizard UI when askquestion invoked | Inline component + session wiring | Matches TUI behavior and issue guidance |
| Tab/arrow navigation between questions | Keyboard and tab UI logic | Mirror TUI controls and shortcuts |
| Select options or enter custom responses | Single-select, multi-select, text input | Use type-safe question model |
| Submit answers continues conversation | POST `/askquestion/respond` | Include `callID`, `sessionID`, `answers` array |
| Cancel dismisses and signals cancellation | POST `/askquestion/cancel` | Include `callID`, `sessionID` |
| Resume sessions in TUI or web app | Sync-based detection of pending asks | Scan message parts for `status: "waiting"` |

## Technical Specifications

### API Endpoints
- `POST /askquestion/respond`
  - Payload: `{ callID: string, sessionID: string, answers: Answer[] }`
  - Purpose: Submit answers and continue tool execution
  - Error: Returns error if no pending askquestion found with the given callID
- `POST /askquestion/cancel`
  - Payload: `{ callID: string, sessionID: string }`
  - Purpose: Cancel tool execution and dismiss UI
  - Error: Returns error if no pending askquestion found with the given callID

### Data Models and Types

Since `AskQuestion` types are defined in `packages/opencode/src/askquestion/index.ts` and not exported through the SDK, define local types in the web app component:

```typescript
// Types to define in packages/app/src/components/askquestion-wizard.tsx

interface AskQuestionOption {
  value: string
  label: string
  description?: string
}

interface AskQuestionQuestion {
  id: string
  label: string      // Short tab label, e.g. "UI Framework"
  question: string   // Full question text
  options: AskQuestionOption[]  // 2-8 options
  multiSelect?: boolean
}

interface AskQuestionAnswer {
  questionId: string
  values: string[]           // Selected option value(s)
  customText?: string        // Custom text if user typed their own response
}

interface PendingAskQuestion {
  callID: string
  messageID: string
  questions: AskQuestionQuestion[]
}
```

### Detection Logic

The detection logic must match TUI implementation at `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:398-427`:

```typescript
// Detection pattern for pending askquestion
const pendingAskQuestion = createMemo(() => {
  const sessionMessages = sync.data.message[sessionID] ?? []

  // Search backwards for the most recent pending question
  for (const message of [...sessionMessages].reverse()) {
    const parts = sync.data.part[message.id] ?? []

    for (const part of [...parts].reverse()) {
      if (part.type !== "tool") continue
      if (part.tool !== "askquestion") continue
      if (part.state.status !== "running") continue

      const metadata = part.state.metadata as {
        status?: string
        questions?: AskQuestionQuestion[]
      } | undefined

      if (metadata?.status !== "waiting") continue

      return {
        callID: part.callID,
        messageID: part.messageID,
        questions: metadata.questions ?? [],
      }
    }
  }

  return null
})
```

### Integration Points
- Session page (web app): detect pending askquestion and render wizard inline
- Sync context: already handles `message.part.updated` events which update tool metadata
- Prompt input area: conditionally replaced by wizard when askquestion is pending

## Implementation Plan

### Milestone 1: Define Types and Review TUI Parity
- [x] Define local TypeScript types for Question, Option, Answer in web app
- [x] Review TUI askquestion UX behavior at `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx`
- [x] Document keyboard shortcuts: 1-8 for quick select, Space to toggle, Enter to confirm/advance, Escape to cancel, Tab/Arrow for navigation
- [x] Confirm existing UI components to reuse: `Tabs`, `Checkbox`, `Button`, `TextField`

### Milestone 2: Add AskQuestionWizard Component
- [x] Create `packages/app/src/components/askquestion-wizard.tsx` in SolidJS
- [x] Define component props: `questions`, `onSubmit`, `onCancel`
- [x] Implement internal state using `createStore`:
  - `activeTab: number` - current question index
  - `questionStates: Array<{ selectedOption: number, selectedValues: string[], customText?: string }>`
  - `isTypingCustom: boolean` - whether custom input is focused
- [x] Render tab bar showing question labels with completion indicators (filled/empty circle)
- [x] Render current question with options list
- [x] Implement single-select: click/Enter selects and auto-advances
- [x] Implement multi-select: Space toggles, Enter confirms and advances
- [x] Add "Type something..." option at end of options list for custom input
- [x] Implement keyboard navigation:
  - Up/Down or Ctrl+P/N: navigate options
  - Left/Right or Tab/Shift+Tab: navigate questions
  - 1-8: quick select option by number
  - Space: toggle selection (multi-select) or select (single-select)
  - Enter: confirm and advance or submit if last question
  - Escape: cancel wizard
  - Ctrl+Enter: submit all answers
- [x] Add footer with navigation hints
- [x] Apply styling consistent with web app design tokens

### Milestone 3: Detect Pending AskQuestion in Session Page
- [x] Add `pendingAskQuestion` memoized signal in `packages/app/src/pages/session.tsx`
- [x] Scan synced message parts for tool parts where:
  - `part.type === "tool"`
  - `part.tool === "askquestion"`
  - `part.state.status === "running"`
  - `part.state.metadata.status === "waiting"`
- [x] Extract `callID`, `messageID`, and `questions` from matching part
- [x] Search backwards through messages to find most recent pending question
- [x] Detection works for both live sessions and resumed sessions

### Milestone 4: Wire Session Page Integration and API Calls
- [x] Import `AskQuestionWizard` in session page
- [x] Conditionally render wizard instead of `PromptInput` when `pendingAskQuestion()` is truthy
- [x] Use `<Show when={pendingAskQuestion()}>` or `<Switch>/<Match>` pattern (matches TUI at line 1426-1464)
- [x] Implement `onSubmit` handler:
  ```typescript
  async (answers: AskQuestionAnswer[]) => {
    await fetch(`${sdk.url}/askquestion/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callID: pendingAskQuestion().callID,
        sessionID: params.id,
        answers,
      }),
    }).catch(() => {
      showToast({ title: "Failed to submit answers", variant: "error" })
    })
  }
  ```
- [x] Implement `onCancel` handler:
  ```typescript
  async () => {
    await fetch(`${sdk.url}/askquestion/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callID: pendingAskQuestion().callID,
        sessionID: params.id,
      }),
    }).catch(() => {
      showToast({ title: "Failed to cancel", variant: "error" })
    })
  }
  ```
- [x] After submit/cancel, the tool metadata will update via sync, causing `pendingAskQuestion()` to return null and hiding the wizard

### Milestone 5: Accessibility, UX, and Edge Cases
- [x] Verify tab/arrow navigation and focus management across questions
- [x] Ensure multi-select toggles do not override previous selections
- [x] Handle empty questions list gracefully (don't render wizard)
- [x] Handle missing metadata gracefully (don't render wizard)
- [x] Prevent existing session page keyboard handlers from triggering while wizard is active
  - Session page has handlers at `packages/app/src/pages/session.tsx:438-455`
  - Check `document.activeElement` or add `data-prevent-autofocus` attribute
- [x] Handle API errors gracefully:
  - Show toast on submit/cancel failure
  - Handle case where pending request no longer exists (server restarted, session aborted)
- [x] Ensure wizard doesn't render for completed askquestion tool parts

### Milestone 6: Testing and Validation
- [ ] Test single question with single-select options
- [ ] Test multiple questions with mixed single/multi-select
- [ ] Test custom text input for responses
- [ ] Test cancel mid-wizard
- [ ] Test submit with all questions answered
- [ ] Test resumed session with pending askquestion (web app reload)
- [ ] Test session started in TUI, resumed in web app
- [ ] Test session started in web app, resumed in TUI
- [ ] Test session abort while askquestion is pending

## Implementation Order and Dependencies
1. Define local types and review TUI implementation (Milestone 1)
2. Build `AskQuestionWizard` component with internal state (Milestone 2)
3. Implement pending detection in session page (Milestone 3)
4. Wire session page integration and API calls (Milestone 4)
5. Address accessibility, keyboard conflicts, and edge cases (Milestone 5)
6. Test all scenarios (Milestone 6)

## Validation Criteria
- [ ] Triggering askquestion in web app shows wizard UI immediately (replaces prompt input)
- [ ] Users can navigate between questions via tabs, arrows, and Tab key
- [ ] Users can select options via click, Enter, Space, or number keys
- [ ] Users can enter custom text responses
- [ ] Submit sends correct payload format to `/askquestion/respond` and resumes LLM response
- [ ] Cancel sends correct payload to `/askquestion/cancel` and closes wizard
- [ ] Resumed sessions with pending askquestion show the wizard in both web app and TUI
- [ ] No regression in non-askquestion session rendering
- [ ] Keyboard shortcuts in wizard don't conflict with session page shortcuts

## Risks and Mitigations
- Risk: Web app and TUI detection logic diverge over time
  - Mitigation: Document exact detection conditions; consider extracting shared detection logic in future
- Risk: Keyboard shortcuts conflict with session page shortcuts
  - Mitigation: Check if wizard is active before handling session-level keyboard events; use `data-prevent-autofocus` pattern
- Risk: Server restarts or session aborts while askquestion is pending
  - Mitigation: Handle API errors gracefully; show toast and allow retry or dismiss
- Risk: Type definitions in web app diverge from server schema
  - Mitigation: Document that types must match `packages/opencode/src/askquestion/index.ts`; consider extracting to shared package in future
- Risk: Sync data updates race with wizard state
  - Mitigation: Derive pending state from sync data (reactive), don't cache separately

## Resolved Questions

### Does the web app already have a dialog component or tab system to reuse?
Yes. Use these existing components:
- `packages/ui/src/components/tabs.tsx` - Kobalte-based Tabs with List, Trigger, Content
- `packages/ui/src/components/checkbox.tsx` - For multi-select option checkboxes
- `packages/ui/src/components/button.tsx` - For submit/cancel buttons
- `packages/ui/src/components/text-field.tsx` - For custom text input

Note: The wizard should render **inline** in the session page (replacing the prompt input), not as a modal overlay via the dialog system.

### Should the web app explicitly store pending askquestion state in sync context?
No. Derive the pending state from existing sync data using a memoized computation. The sync context already stores `message` and `part` data which contains the tool metadata. Adding separate askquestion state would require keeping it synchronized and could lead to inconsistencies.

### Are there existing keyboard shortcut handlers in web app that must be preserved?
Yes. The session page has keyboard handlers at `packages/app/src/pages/session.tsx:438-455` that auto-focus the prompt input when typing. When the wizard is active, these handlers should be bypassed. Check `document.activeElement` or use the existing `data-prevent-autofocus` pattern.

## Appendix: Correct Payload Examples

### Submit Response Payload
```json
{
  "callID": "call_abc123",
  "sessionID": "session_xyz789",
  "answers": [
    {
      "questionId": "ui_framework",
      "values": ["react"],
      "customText": null
    },
    {
      "questionId": "styling",
      "values": ["tailwind", "css-modules"],
      "customText": null
    },
    {
      "questionId": "other_requirements",
      "values": [],
      "customText": "I also need SSR support"
    }
  ]
}
```

### Cancel Payload
```json
{
  "callID": "call_abc123",
  "sessionID": "session_xyz789"
}
```

### Tool Metadata Structure (from askquestion tool)
When askquestion is waiting for user input:
```json
{
  "title": "Asking 3 questions",
  "metadata": {
    "status": "waiting",
    "questions": [
      {
        "id": "ui_framework",
        "label": "UI Framework",
        "question": "Which UI framework would you like to use?",
        "options": [
          { "value": "react", "label": "React", "description": "Popular component library" },
          { "value": "vue", "label": "Vue", "description": "Progressive framework" },
          { "value": "svelte", "label": "Svelte", "description": "Compile-time framework" }
        ],
        "multiSelect": false
      }
    ]
  }
}
```

When askquestion is completed:
```json
{
  "title": "Asked 3 questions",
  "metadata": {
    "status": "completed",
    "questions": ["UI Framework", "Styling", "Other Requirements"],
    "answers": [
      { "questionId": "ui_framework", "values": ["react"] }
    ]
  }
}
```
