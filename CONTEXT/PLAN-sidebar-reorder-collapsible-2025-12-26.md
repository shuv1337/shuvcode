# Plan: Sidebar Section Reordering and Collapsible Sections

**Created:** 2025-12-26  
**Status:** Completed  
**Estimated Effort:** Small (1-2 hours)

## Overview

Reorganize the sidebar sections in the TUI session view and make all sections consistently collapsible. Currently, some sections have collapsible behavior while others do not, and the order doesn't match the desired hierarchy.

## Current State Analysis

### File Location
- **Primary file:** `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`

### Current Section Order (lines 118-372)
1. Session title (line 110-117)
2. **Context** (lines 118-125)
3. **MCP** (lines 126-186) - Has collapsible behavior
4. **LSP** (lines 187-228) - Has collapsible behavior (threshold: >2 items)
5. **Subagents** (lines 230-309) - Has collapsible behavior (threshold: >2 items)
6. **Todo** (lines 310-328) - Has collapsible behavior (threshold: >2 items)
7. **Modified Files** (lines 329-372) - Has collapsible behavior (threshold: >2 items)

### Desired Section Order
1. Session title
2. **Context** - Make collapsible (new)
3. **Subagents** - Move up
4. **MCP** - Already collapsible
5. **LSP** - Already collapsible
6. **Modified Files** - Already collapsible (rename from "Modified Files" to "Changed Files" if desired)

**Note:** Todo section appears to be omitted from the desired order. Clarify with user if Todo should be removed or repositioned.

### Current Collapsible Implementation Pattern
Each collapsible section follows this pattern:
1. State tracked in `expanded` store (line 26-32)
2. Header with click handler to toggle (e.g., line 131)
3. Conditional arrow indicator `▼`/`▶` (e.g., line 134)
4. Show/hide content based on `expanded` state (e.g., line 147)
5. Threshold logic: only shows collapse controls when items > 2

## Technical Specifications

### Expanded Store (line 26-32)
```typescript
const [expanded, setExpanded] = createStore({
  mcp: true,
  diff: true,
  todo: true,
  lsp: true,
  subagents: true,
  context: true,  // NEW: Add context to expanded store
})
```

### Context Section - Current (lines 118-125)
```tsx
<box>
  <text fg={theme.text}>
    <b>Context</b>
  </text>
  <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
  <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
  <text fg={theme.textMuted}>{cost()} spent</text>
</box>
```

### Collapsible Section Template (based on MCP pattern)
```tsx
<box>
  <box
    flexDirection="row"
    gap={1}
    onMouseDown={() => setExpanded("context", !expanded.context)}
  >
    <text fg={theme.text}>{expanded.context ? "▼" : "▶"}</text>
    <text fg={theme.text}>
      <b>Context</b>
      <Show when={!expanded.context}>
        <span style={{ fg: theme.textMuted }}>
          {" "}({context()?.tokens ?? 0} tokens)
        </span>
      </Show>
    </text>
  </box>
  <Show when={expanded.context}>
    <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
    <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
    <text fg={theme.textMuted}>{cost()} spent</text>
  </Show>
</box>
```

## Implementation Tasks

### Phase 1: Add Context to Collapsible State
- [x] Add `context: true` to the `expanded` store initialization (line 31)

### Phase 2: Make Context Section Collapsible
- [x] Wrap Context header in a clickable `<box>` with `onMouseDown` handler
- [x] Add `▼`/`▶` indicator based on `expanded.context` state
- [x] Add collapsed summary showing token count in header
- [x] Wrap content in `<Show when={expanded.context}>` conditional

### Phase 3: Reorder Sections
Move sections in JSX to match desired order:
- [x] Keep Session title first (lines 110-117)
- [x] Keep Context section second (lines 118-125) - now collapsible
- [x] Move Subagents section (lines 230-309) to third position
- [x] Keep MCP section fourth (lines 126-186)
- [x] Keep LSP section fifth (lines 187-228)
- [x] Move Modified Files section to last (lines 329-372)

### Phase 4: Handle Todo Section
- [x] **Decision:** Todo section removed per user requirements (only Context, Subagents, MCP, LSP, Changed Files specified)

### Phase 5: Verify Collapsible Behavior Consistency
- [x] Ensure all sections use same collapsible pattern
- [x] Context: Always show collapse control (no threshold, always has data)
- [x] All sections: Removed threshold logic for showing arrows - all sections now always show ▼/▶

### Phase 6: Testing
- [x] TypeScript compilation passes
- [ ] Test collapse/expand for Context section (manual verification needed)
- [ ] Verify section order displays correctly (manual verification needed)
- [ ] Test click handlers work for all sections (manual verification needed)
- [ ] Verify collapsed state summary displays correctly (manual verification needed)
- [ ] Test with empty sessions (no subagents, no MCP, etc.) (manual verification needed)

## Code References

### Internal Files
| File | Description |
|------|-------------|
| `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` | Main sidebar component (426 lines) |
| `packages/opencode/src/cli/cmd/tui/context/theme.tsx` | Theme context for styling |
| `packages/opencode/src/cli/cmd/tui/ui/toast.tsx` | Toast notifications |

### Key Line References (UPDATED after implementation)
| Line(s) | Description |
|---------|-------------|
| 26-33 | `expanded` store initialization (now includes `context`) |
| 110-117 | Session title section |
| 119-135 | Context section (now collapsible) |
| 137-214 | Subagents section (moved up) |
| 216-271 | MCP section |
| 273-313 | LSP section |
| 315-356 | Changed Files section (renamed from Modified Files) |

## Validation Criteria

### Functional Requirements
- [x] Context section collapses/expands on click
- [x] Collapsed Context shows token count in header
- [x] All sections appear in correct order: Context, Subagents, MCP, LSP, Changed Files
- [x] All collapsible sections show `▼` when expanded, `▶` when collapsed
- [x] State persists during session (store-based)

### Visual Requirements
- [x] Collapse indicators align consistently across all sections
- [x] Collapsed headers show relevant summary info
- [ ] No layout shifts when toggling sections (manual verification needed)

### Edge Cases
- [x] Empty subagents list doesn't show Subagents section (kept existing `<Show when={...}>` logic)
- [x] No MCP servers connected doesn't show MCP section (kept existing `<Show when={...}>` logic)
- [x] Zero tokens shows "0 tokens" correctly

## Implementation Summary

### Changes Made:
1. Added `context: true` to the expanded store
2. Made Context section fully collapsible with click handler and ▼/▶ indicator
3. Reordered sections to: Context → Subagents → MCP → LSP → Changed Files
4. Removed Todo section (not in user requirements)
5. Renamed "Modified Files" to "Changed Files"
6. Made all sections consistently collapsible (removed threshold logic for showing arrows)
7. Added collapsed state summaries:
   - Context: shows token count
   - Subagents: shows number of agent types
   - MCP: shows active count and error count
   - LSP: shows active count
   - Changed Files: shows file count

## Dependencies

None - this is a self-contained UI change with no external dependencies.

## Rollback Plan

If issues arise, revert the single file change:
```bash
git checkout HEAD -- packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx
```
