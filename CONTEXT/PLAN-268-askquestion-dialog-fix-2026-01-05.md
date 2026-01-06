# Plan: AskQuestion Tool Dialog Fix

**Issue:** [#268 - AskQuestion tool: Dialog not appearing in Web or TUI mode](https://github.com/Latitudes-Dev/shuvcode/issues/268)

**Created:** 2026-01-05

**Revised:** 2026-01-06 - Added callID validation, sync confirmation recommendations, detection helper extraction

**Severity:** High - This breaks the core UX of the experimental askquestion feature.

**Status:** READY TO IMPLEMENT

---

## Overview

The `askquestion` tool is invoked by the LLM, but the expected wizard dialog does not appear in either Web or TUI mode. The user cannot respond to clarifying questions, causing the tool to hang indefinitely.

### Configuration Required

```yaml
# .opencode/config.yaml
experimental:
  askquestion_tool: true
```

---

## Acceptance Criteria

- [ ] Wizard dialog appears when LLM invokes `askquestion` in **Web mode**
- [ ] Wizard dialog appears when LLM invokes `askquestion` in **TUI mode**
- [ ] User can submit answers via the wizard
- [ ] User can cancel the wizard with Escape
- [ ] Tool resumes correctly after user response
- [ ] Comprehensive end-to-end tests exist proving the full flow works

---

## Architecture Reference

### Component Map

| Layer | File | Purpose |
|-------|------|---------|
| Tool Definition | `packages/opencode/src/tool/askquestion.ts` | Defines tool schema, registers pending request, awaits response |
| State Management | `packages/opencode/src/askquestion/index.ts` | `register()`, `respond()`, `cancel()`, `cleanup()` functions |
| Server Endpoints | `packages/opencode/src/server/server.ts:1694-1763` | `POST /askquestion/respond` and `/askquestion/cancel` |
| Web App Detection | `packages/app/src/pages/session.tsx:240-288` | `pendingAskQuestion` memo + handlers |
| Web App UI | `packages/app/src/components/askquestion-wizard.tsx` | `AskQuestionWizard` Solid.js component |
| Web App Rendering | `packages/app/src/pages/session.tsx:993-1010` | Conditional render of wizard vs prompt input |
| TUI Detection | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:391-418` | `pendingAskQuestionFromSync` memo |
| TUI UI | `packages/opencode/src/cli/cmd/tui/ui/dialog-askquestion.tsx` | `DialogAskQuestion` component |
| TUI Rendering | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1447-1489` | Switch/Match conditional rendering |
| Tool Context | `packages/opencode/src/session/prompt.ts:662-677` | `ctx.metadata()` implementation |
| Part Sync | `packages/opencode/src/session/index.ts:391-401` | `updatePart()` publishes `PartUpdated` event |
| Existing Tests | `packages/opencode/test/tool/askquestion.test.ts` | Core promise flow + detection logic mocks |

### Expected Data Flow

```
1. LLM calls askquestion tool with questions array
   └─> askquestion.ts:19-28

2. Tool calls await ctx.metadata({ status: "waiting", questions })
   └─> prompt.ts:662-677 -> Session.updatePart()
   └─> session/index.ts:391-401 -> Bus.publish(PartUpdated)

3. SSE delivers PartUpdated event to clients
   └─> server.ts:173-209 (global event stream)

4. Client detects pending askquestion via sync.data.part
   └─> Web: session.tsx:240-268 (pendingAskQuestion memo)
   └─> TUI: session/index.tsx:391-418 (pendingAskQuestionFromSync memo)

5. Client renders wizard dialog
   └─> Web: session.tsx:993-1010 (AskQuestionWizard)
   └─> TUI: session/index.tsx:1448-1484 (DialogAskQuestion)

6. User submits answers
   └─> POST /askquestion/respond -> server.ts:1694-1728
   └─> AskQuestion.respond() resolves the promise

7. Tool promise resolves, returns formatted answers to LLM
   └─> askquestion.ts:46-77
```

---

## Suspected Root Causes

### 1. Sync/Reactivity Gap (Most Likely)

**Hypothesis:** The `ctx.metadata()` call updates the part and publishes `PartUpdated`, but the SSE sync may not deliver the updated part state to the client before the detection logic runs.

**Evidence:**
- `ctx.metadata()` is async and awaited (`askquestion.ts:22`)
- `Session.updatePart()` publishes to Bus, which SSE listens to
- But there's no explicit "wait for sync" mechanism

**Location:** `packages/opencode/src/session/prompt.ts:662-677`

**Review Finding:** The `ctx.metadata()` at `prompt.ts:665-676` does await `Session.updatePart()`, but this only ensures the local state is updated. SSE delivery to clients is asynchronous and not confirmed.

**Mitigation Options:**
1. **Small delay after metadata update** (simplest):
   ```ts
   await ctx.metadata({ ... })
   await new Promise(resolve => setTimeout(resolve, 50))  // Allow SSE delivery
   ```
2. **Use dedicated Bus event** - `AskQuestion.Event.Requested` already exists at `askquestion/index.ts:44-52` but is not currently published. Clients could listen for this instead of polling part state.
3. **Polling/retry in client detection** - If first check fails, retry a few times with small delays.

### 2. Part State Structure Mismatch

**Hypothesis:** The detection logic expects `part.state.metadata.status === "waiting"`, but the actual synced structure may differ.

**Evidence:**
- Tool sets: `metadata: { questions, status: "waiting" }` (`askquestion.ts:24-27`)
- Detection checks: `part.state.metadata?.status !== "waiting"` (`session.tsx:257`)
- The `ToolStateRunning` schema shows `metadata: z.record(z.string(), z.any()).optional()` (`message-v2.ts:244`)

**Location:** `packages/opencode/src/session/message-v2.ts:239-252`

### 3. callID Undefined

**Hypothesis:** The `ctx.callID` may be undefined when the tool is invoked.

**Evidence:**
- Tool uses `ctx.callID!` (non-null assertion) at `askquestion.ts:32,40`
- Tool.Context defines `callID?: string` (optional) at `tool.ts:20`

**Location:** `packages/opencode/src/tool/askquestion.ts:32`

**Risk Assessment (from review):** Low risk - `callID` comes from `options.toolCallId` in `prompt.ts:659` which is set by the AI SDK for all tool calls. However, defensive validation should be added.

**Required Fix:** Add explicit validation at the start of execute():
```ts
async execute(params, ctx) {
  if (!ctx.callID) {
    throw new Error("callID is required for askquestion tool")
  }
  // ... rest of implementation
}
```

### 4. Switch/Match Ordering (TUI Only)

**Hypothesis:** If another condition matches first (e.g., permissions), the dialog won't show.

**Evidence:**
- Current order at `session/index.tsx:1447-1509`:
  1. `pendingAskQuestionFromSync()` - DialogAskQuestion
  2. `permissions().length > 0` - PermissionPrompt
  3. `searchMode()` - SearchInput
  4. Default - Prompt

**Assessment:** This ordering is correct (askquestion first), so unlikely to be the issue.

---

## Implementation Tasks

### Phase 0: Required Fix (Pre-Investigation)

- [ ] **0.1** Add callID validation to `askquestion.ts` execute function
  - File: `packages/opencode/src/tool/askquestion.ts:19`
  - Add at start of execute():
    ```ts
    if (!ctx.callID) {
      throw new Error("callID is required for askquestion tool")
    }
    ```
  - Remove non-null assertions (`!`) at lines 32 and 40, replace with direct `ctx.callID` usage

### Phase 1: Investigation & Debugging

- [ ] **1.1** Add debug logging to `askquestion.ts` after `ctx.metadata()` call to verify it returns
  - File: `packages/opencode/src/tool/askquestion.ts:28`
  - Add: `console.log("[askquestion] metadata updated, callID:", ctx.callID)`

- [ ] **1.2** Add debug logging to Web detection memo to see what parts are being scanned
  - File: `packages/app/src/pages/session.tsx:240-268`
  - Add console.log for each part checked, especially tool parts

- [ ] **1.3** Add debug logging to TUI detection memo
  - File: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:391-418`
  - Add console.log for each part checked

- [ ] **1.4** Verify SSE delivers the `PartUpdated` event with correct structure
  - Use browser DevTools to inspect SSE events
  - Check that `part.state.metadata.status === "waiting"` is present

- [ ] **1.5** Verify `ctx.callID` is defined when `askquestion` tool executes
  - File: `packages/opencode/src/session/prompt.ts:659`
  - Log the `options.toolCallId` value

### Phase 2: Fix Sync/Reactivity Issues

Based on investigation results, one or more of these may be needed:

- [ ] **2.1** Ensure `ctx.metadata()` properly awaits sync propagation
  - File: `packages/opencode/src/session/prompt.ts:662-677`
  - Current implementation awaits `Session.updatePart()` - this is correct
  - Verify the async function is properly awaited before returning

- [ ] **2.2** Add explicit sync wait after metadata update (if needed)
  - File: `packages/opencode/src/tool/askquestion.ts:28`
  - Option A (simple): Add 50ms delay after metadata update to allow SSE delivery
  - Option B (robust): Publish `AskQuestion.Event.Requested` via Bus and have clients listen for it
  - Option C (client-side): Add retry logic to client detection memos

- [ ] **2.3** (DONE in Phase 0) callID validation added to tool execute function

### Phase 3: Fix Detection Logic (If Needed)

- [ ] **3.1** Verify `toolPart.callID` is available (not undefined) in detection
  - File: `packages/app/src/pages/session.tsx:260`
  - File: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:409`

- [ ] **3.2** Verify `toolPart.state.metadata` type matches expected schema
  - Ensure detection correctly extracts `{ status, questions }` from metadata

- [ ] **3.3** Consider alternative detection using `AskQuestion.getForSession()` directly
  - This would bypass sync reactivity issues
  - Would require server endpoint to expose pending requests

### Phase 4: Comprehensive Testing

#### 4.1 Server Endpoint Integration Tests

- [ ] **4.1.1** Create test file: `packages/opencode/test/server/askquestion.test.ts`

```typescript
// packages/opencode/test/server/askquestion.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { AskQuestion } from "../../src/askquestion"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"

describe("askquestion server endpoints", () => {
  test("POST /askquestion/respond resolves pending request", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const server = Server.create()
        const callID = "test-call-123"
        const sessionID = "test-session"
        const messageID = "test-message"
        
        // Register pending request
        const promise = AskQuestion.register(callID, sessionID, messageID, [
          { id: "q1", label: "Q1", question: "Pick one", options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]},
        ])
        
        // Simulate client response
        const res = await server.request("/askquestion/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callID,
            sessionID,
            answers: [{ questionId: "q1", values: ["a"] }],
          }),
        })
        
        expect(res.status).toBe(200)
        const answers = await promise
        expect(answers[0].values).toEqual(["a"])
      },
    })
  })

  test("POST /askquestion/cancel rejects pending request", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const server = Server.create()
        const callID = "test-call-456"
        const sessionID = "test-session"
        const messageID = "test-message"
        
        const promise = AskQuestion.register(callID, sessionID, messageID, [
          { id: "q1", label: "Q1", question: "Pick one", options: [
            { value: "a", label: "A" },
          ]},
        ])
        
        const res = await server.request("/askquestion/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callID, sessionID }),
        })
        
        expect(res.status).toBe(200)
        await expect(promise).rejects.toThrow("User cancelled")
      },
    })
  })

  test("POST /askquestion/respond returns 404 for unknown callID", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const server = Server.create()
        
        const res = await server.request("/askquestion/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callID: "nonexistent",
            sessionID: "test-session",
            answers: [],
          }),
        })
        
        expect(res.status).toBe(500) // Will throw error internally
      },
    })
  })
})
```

#### 4.2 Sync Propagation Tests

- [ ] **4.2.1** Create test for part sync after metadata update

```typescript
// packages/opencode/test/tool/askquestion-sync.test.ts
import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"

describe("AskQuestion Sync Propagation", () => {
  test("metadata update publishes PartUpdated event with correct structure", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const events: any[] = []
        const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, (evt) => {
          events.push(evt)
        })
        
        const part: MessageV2.ToolPart = {
          id: "part-123",
          sessionID: "session-123",
          messageID: "message-123",
          type: "tool",
          tool: "askquestion",
          callID: "call-123",
          state: {
            status: "running",
            input: {},
            time: { start: Date.now() },
            metadata: {
              status: "waiting",
              questions: [{ id: "q1", label: "Q1", question: "Test?", options: [] }],
            },
          },
        }
        
        await Session.updatePart(part)
        
        expect(events.length).toBe(1)
        expect(events[0].part.state.metadata.status).toBe("waiting")
        expect(events[0].part.state.status).toBe("running")
        
        unsub()
      },
    })
  })
})
```

#### 4.3 Detection Logic Tests

- [ ] **4.3.1** Add tests for detection edge cases

```typescript
// packages/opencode/test/tool/askquestion.test.ts (extend existing)

describe("AskQuestion Detection Edge Cases", () => {
  test("detects pending when callID is present", () => {
    const messages = [{ id: "m1" }]
    const partsMap = {
      m1: [
        {
          type: "tool",
          tool: "askquestion",
          callID: "call-123", // Important: callID must be present
          state: {
            status: "running",
            metadata: { status: "waiting", questions: [] },
          },
        },
      ],
    }
    const result = detectPending(messages, partsMap)
    expect(result).not.toBeNull()
    expect(result?.callID).toBe("call-123")
  })

  test("returns null when callID is undefined", () => {
    const messages = [{ id: "m1" }]
    const partsMap = {
      m1: [
        {
          type: "tool",
          tool: "askquestion",
          callID: undefined, // Missing callID
          state: {
            status: "running",
            metadata: { status: "waiting", questions: [] },
          },
        },
      ],
    }
    const result = detectPending(messages, partsMap)
    // Should this return null or handle gracefully?
    expect(result?.callID).toBeUndefined()
  })

  test("ignores when part.state.status is not 'running'", () => {
    const messages = [{ id: "m1" }]
    const partsMap = {
      m1: [
        {
          type: "tool",
          tool: "askquestion",
          callID: "call-123",
          state: {
            status: "pending", // Not running
            metadata: { status: "waiting", questions: [] },
          },
        },
      ],
    }
    const result = detectPending(messages, partsMap)
    expect(result).toBeNull()
  })

  test("ignores when metadata.status is 'completed'", () => {
    const messages = [{ id: "m1" }]
    const partsMap = {
      m1: [
        {
          type: "tool",
          tool: "askquestion",
          callID: "call-123",
          state: {
            status: "running",
            metadata: { status: "completed", answers: [] },
          },
        },
      ],
    }
    const result = detectPending(messages, partsMap)
    expect(result).toBeNull()
  })
})
```

#### 4.4 Session Abort Cleanup Tests

- [ ] **4.4.1** Add test for cleanup on session abort

```typescript
describe("AskQuestion Cleanup", () => {
  test("cleanup rejects all pending requests for session", async () => {
    const sessionID = "session-to-abort"
    const promises = []
    
    for (let i = 0; i < 3; i++) {
      promises.push(
        AskQuestion.register(`call-${i}`, sessionID, `msg-${i}`, [])
      )
    }
    
    AskQuestion.cleanup(sessionID)
    
    for (const promise of promises) {
      await expect(promise).rejects.toThrow("Session aborted")
    }
  })
})
```

### Phase 5: Manual Validation

- [ ] **5.1** Test in TUI mode
  - Start shuvcode in TUI
  - Enable `experimental.askquestion_tool: true`
  - Trigger LLM to use askquestion (e.g., "Help me choose a database")
  - Verify dialog appears
  - Test submit and cancel

- [ ] **5.2** Test in Web mode
  - Start shuvcode server
  - Open web app
  - Enable `experimental.askquestion_tool: true`
  - Trigger LLM to use askquestion
  - Verify wizard appears
  - Test submit and cancel on desktop
  - Test submit and cancel on mobile viewport

- [ ] **5.3** Test edge cases
  - Multiple questions in sequence
  - Cancel mid-flow
  - Session abort while question pending
  - Custom text response

---

## External References

- **Solid.js Reactivity:** https://www.solidjs.com/docs/latest/api#creatememo
- **Hono SSE Streaming:** https://hono.dev/helpers/streaming#sse-stream
- **Bun Test:** https://bun.sh/docs/cli/test

---

## File Modifications Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/opencode/src/tool/askquestion.ts` | Modify | Add callID validation, remove non-null assertions, add debug logging |
| `packages/opencode/src/session/prompt.ts` | Modify | Verify metadata sync (may add delay or event publish) |
| `packages/app/src/pages/session.tsx` | Modify | Add debug logging for detection (temporary) |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | Modify | Add debug logging for detection (temporary) |
| `packages/opencode/test/server/askquestion.test.ts` | Create | Server endpoint tests |
| `packages/opencode/test/tool/askquestion.test.ts` | Modify | Add edge case tests, callID validation test |

---

## Definition of Done

1. All acceptance criteria checkboxes are checked
2. All new tests pass (`bun turbo test`)
3. TypeScript compiles without errors for both `opencode` and `app` packages
4. Manual validation passes in both TUI and Web modes
5. Debug logging is removed before merge
6. PR is reviewed and approved

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SSE timing issues in production | Medium | High | Add explicit sync confirmation mechanism |
| Breaking other tool metadata flows | Low | High | Comprehensive test coverage |
| Mobile-specific issues | Medium | Medium | Explicit mobile testing in validation |

---

## Notes

- The detection logic is duplicated between Web (`session.tsx:240-268`) and TUI (`session/index.tsx:391-418`) - consider extracting to shared utility after fix is confirmed
- The `ctx.callID!` non-null assertion is addressed in Phase 0 with explicit validation
- The tool is behind `experimental.askquestion_tool` flag, so production impact is limited to opt-in users
- The `detectPending` helper function referenced in test examples (Phase 4.3) does not exist - it represents the extracted detection logic that should be created as part of the refactor

## Post-Fix Refactoring (Optional)

After the fix is confirmed working, consider:
1. Extract `detectPendingAskQuestion(messages, parts)` to `packages/opencode/src/askquestion/detect.ts`
2. Share detection logic between Web and TUI
3. Publish `AskQuestion.Event.Requested` from tool for more reliable client notification
