# Project Plan: Reduce wasted bottom space in the TUI (small terminal support)

> REMINDER: This document is a plan only — do not implement during planning.

## Context

We’ve observed **several lines of “wasted” / unused vertical space near the bottom of the OpenCode TUI**, which makes the interface harder to use in **small terminal windows** (ex: 80×24 or smaller).

This repo is a fork (`Latitudes-Dev/shuvcode`) of `sst/opencode` (see `AGENTS.md`). The TUI implementation lives under `packages/opencode/src/cli/cmd/tui/` and is built with **Solid** + **OpenTUI** (`@opentui/core`, `@opentui/solid`) and includes a custom embedded terminal renderable for bash output (`ghostty-opentui`).

### What we know from current code inspection

- The top-level TUI container fills the renderer dimensions: `packages/opencode/src/cli/cmd/tui/app.tsx`.
- The **Session route layout** adds vertical padding and gaps that plausibly account for multiple blank lines: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`.
- Sidebar and Home routes also add vertical padding that may show up as unused space on small screens.

## Goals

- Reduce **unused vertical whitespace at the bottom** of the TUI so more content fits in small terminals.
- Preserve usability and visual structure on “normal” sized terminals.
- Avoid introducing layout jitter during resize (no flicker / no leaving stale lines on screen).

## Non-goals

- Major UI redesign (colors, theming, component rewrites).
- Changing interaction patterns (keybinds, navigation) except where necessary to save space.
- Performance optimizations unrelated to layout/spacing.

## Current UI Layout: Where the vertical space comes from

### Key internal components and layout points

- App root sizing:
  - `packages/opencode/src/cli/cmd/tui/app.tsx` sets the root container size to `useTerminalDimensions()`.
- Session layout (likely primary contributor):
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` uses a main `<box>` with `paddingTop`, `paddingBottom`, and `gap`.
  - Prompt area:
    - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` includes a textarea, a separator line, and a status/hints row.
  - Session footer:
    - `packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx` renders a single-line footer (directory + status).
  - Sidebar container:
    - `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` includes `paddingTop={1}` and `paddingBottom={1}`.
- Home route bottom bar:
  - `packages/opencode/src/cli/cmd/tui/routes/home.tsx` uses `paddingTop={1}` and `paddingBottom={1}` for the bottom bar.

### Suspected contributors (by observation of code)

| Area                       | Internal location                                              | Likely overhead | Why it matters                                                                                      |
| -------------------------- | -------------------------------------------------------------- | --------------: | --------------------------------------------------------------------------------------------------- |
| Session root padding       | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   |        ~2 lines | `paddingTop={1}` + `paddingBottom={1}` always consumes vertical rows                                |
| Session root gap           | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   |        1+ lines | `gap={1}` adds vertical separation between major children (may include prompt ↔ footer separation) |
| Prompt “chrome”            | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` |      1–3+ lines | Separator line + status/hints row are always visible                                                |
| Sidebar padding            | `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` |        ~2 lines | Padding consumes vertical space on wide layouts                                                     |
| Bash output viewer padding | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   |      1–3+ lines | The bash output viewer has multiple `paddingBottom` sites plus the same outer padding               |

## External references (to guide implementation)

These are included to support implementation decisions and provide authoritative patterns.

### OpenTUI sizing and dimensions

- Renderer uses full terminal size (no implicit “safe margin” at bottom):
  - https://github.com/sst/opentui/blob/main/packages/core/src/renderer.ts
- `useTerminalDimensions()` is a thin wrapper over renderer width/height and resize events:
  - https://github.com/sst/opentui/blob/main/packages/solid/src/elements/hooks.ts

### Pattern: accounting for vertical overhead

This example explicitly subtracts a constant vertical overhead when computing an embedded terminal’s `rows`:

- https://github.com/remorses/ghostty-opentui/blob/main/tui/interactive.tsx

We can adapt this idea conceptually: define “overhead rows” for header/prompt/footer and remove _unnecessary_ overhead in compact layouts.

## Proposed approach

### Options

| Option                                   | Summary                                                               | Pros                                        | Cons                                                                    | Recommended?          |
| ---------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| A. Always reduce spacing                 | Remove/trim bottom padding + gaps everywhere                          | Simple, immediate wins                      | Might make default UI too cramped; may regress look/feel for most users | Maybe (if minimal)    |
| B. Auto-compact based on terminal height | Keep current spacing for normal screens; compact when height is small | Best UX tradeoff; fixes small terminal pain | Requires choosing thresholds, ensuring resize stability                 | Yes                   |
| C. Configurable “density” (with auto)    | Add a `tui.density` setting (`auto`/`comfortable`/`compact`)          | Explicit control; future-proof              | Slightly more config + docs work                                        | Yes (if scope allows) |

### Recommendation

Implement **Option B** immediately, with a low-cost extension to **Option C** if it fits cleanly:

- Default behavior remains unchanged for typical terminals.
- When terminal height drops below a threshold, switch to a “compact spacing” profile that:
  - Removes **bottom padding** and reduces vertical gaps.
  - Optionally hides/collapses non-essential footer/hint rows.

### Design decisions (to lock in before implementation)

- **Decision 1: Introduce a single “density” abstraction** (even if only `auto` + `comfortable` for now)
  - Rationale: avoids scattering `dimensions().height < N` checks across many components.
- **Decision 2: Prefer removing “decorative” spacing before removing “functional” UI**
  - Rationale: users still need prompt, scroll, and essential status lines.
- **Decision 3: Clamp all computed values**
  - Rationale: avoid negative padding/height and off-by-one layout bugs at very small window sizes.

## Technical specification

### New/updated configuration

Add a new setting under the existing `tui` config section:

```json
{
  "tui": {
    "density": "auto" // "auto" | "comfortable" | "compact"
  }
}
```

| Key           | Type                                   | Default  | Behavior                                                                                                |
| ------------- | -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `tui.density` | `"auto" \| "comfortable" \| "compact"` | `"auto"` | `auto` switches based on terminal height; `compact` forces compact; `comfortable` forces current layout |

Internal integration point: `sync.data.config.tui` is already referenced in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` for scroll behavior.

### Density selection logic

A concrete proposal:

- Define `COMPACT_HEIGHT_THRESHOLD = 28` (tune during implementation).
- In `auto` mode, `compact = dimensions().height < COMPACT_HEIGHT_THRESHOLD`.
- Provide a small helper to compute spacing tokens:

```ts
// pseudo-code for plan
{
  paddingY: compact ? 0 : 1,
  sectionGap: compact ? 0 : 1,
  showFooter: compact ? false : true, // optional
  showSecondaryHints: compact ? false : true // optional
}
```

### API / data model impact

- No new HTTP/API endpoints are expected; this is a UI layout/spacing change plus an optional config schema extension.
- No data model changes are required. The only new persistence (optional) is a `kv` key if we add a manual override toggle.
- Configuration should flow through existing config plumbing (`sync.data.config.tui`) without any new server routes.

## Implementation plan (actionable tasks)

### Milestone 0 — Reproduce & baseline capture

- [ ] Reproduce the issue on at least 2 terminals (ex: Ghostty + iTerm2, or Ghostty + Windows Terminal).
- [ ] Capture baseline screenshots / recordings at these sizes:
  - [ ] 80×30 (control)
  - [ ] 80×24 (target)
  - [ ] 80×20
  - [ ] 80×16 (stress)
- [ ] Record where the wasted space appears:
  - [ ] Session view with sidebar hidden (narrow window)
  - [ ] Session view with sidebar visible (wide window)
  - [ ] Bash output viewer open
  - [ ] Home screen
- [ ] Use the command palette action “Toggle debug panel” to capture renderer size during the reproduction:
  - Reference: `packages/opencode/src/cli/cmd/tui/app.tsx` (command `app.debug` calls `renderer.toggleDebugOverlay()`).

**Dev command (per repo guidance):**

```bash
cd packages/opencode
bun dev
```

### Milestone 1 — Introduce density helper + config surface

- [ ] Add `tui.density` to the config schema:
  - [ ] Update `packages/opencode/src/config/config.ts` (extend `Config.TUI` zod object).
  - [ ] Ensure schema description is clear and matches docs style.
- [ ] Add a small helper module for density decisions:
  - [ ] Create `packages/opencode/src/cli/cmd/tui/util/layout-density.ts` (or similar).
  - [ ] Export something like `getDensity({ height, configDensity }): Density`.
  - [ ] Export spacing tokens derived from density (padding, gap, visibility toggles).
- [ ] Add documentation:
  - [ ] Update `packages/web/src/content/docs/tui.mdx` to include `tui.density` under “Configure”.

### Milestone 2 — Remove bottom wasted space in Session layout (primary fix)

- [ ] Apply density tokens to session root container:
  - [ ] Update `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` root `<box flexGrow={1} ...>` to compute:
    - [ ] `paddingBottom` (target: reduce to 0 in compact)
    - [ ] `gap` (target: reduce in compact)
    - [ ] Optionally `paddingTop` (secondary; only if needed)
- [ ] Ensure prompt/footer spacing is addressed explicitly:
  - [ ] If `gap` removal affects other parts too much, wrap prompt+footer in a container with its own controlled gap.
  - [ ] Avoid negative padding or “visual overlap”.

### Milestone 3 — Sidebar + Home route adjustments

- [ ] Apply density tokens to sidebar container:
  - [ ] Update `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` to reduce `paddingBottom` in compact mode.
- [ ] Apply density tokens to Home bottom bar:
  - [ ] Update `packages/opencode/src/cli/cmd/tui/routes/home.tsx` bottom bar padding for compact mode.

### Milestone 4 — Prompt compaction (only if still needed)

If the remaining bottom footprint is still too large after trimming padding/gaps:

- [ ] Make prompt’s secondary UI optional in compact mode:
  - [ ] In `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`, hide or compress the status/hints row (the row that shows interrupt + keybind hints).
  - [ ] Keep at least one minimal status indicator for critical states (ex: retry, interrupt).
- [ ] Consider hiding the session footer entirely in compact mode (optional):
  - [ ] In `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`, show `<Footer />` only when not compact.

### Milestone 5 — Bash output viewer compaction

- [ ] Audit vertical padding in bash output viewer:
  - [ ] In `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`, review the `bashOutput()` branch:
    - [ ] `paddingBottom` on the command line box
    - [ ] `paddingBottom` on the scrollbox
    - [ ] outer container padding
  - [ ] Reduce or remove bottom padding in compact mode.
  - [ ] If needed, hide the help legend line when extremely small height (ex: < 14 rows).

### Milestone 6 — Optional manual toggle (nice-to-have)

- [ ] Add a command palette item to toggle compact spacing manually:
  - [ ] Add to session command list in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` near other Session toggles.
  - [ ] Persist preference via `kv` (new key), and define precedence:
    - [ ] `kv` override > `config` > `auto` heuristic.

## Validation criteria

### Acceptance criteria (visual)

- [ ] In 80×24 and 80×20 terminals, **no more than 0–1 blank lines** appear below the last functional UI line (footer/prompt), unless required by terminal rendering constraints.
- [ ] The message list gains at least **1–3 additional usable rows** in compact mode compared to baseline.
- [ ] Wide layout (sidebar visible) also benefits: bottom padding in sidebar/session doesn’t create unnecessary blank space.

### Acceptance criteria (functional)

- [ ] Prompt input remains usable: typing, submitting, multi-line input up to existing `maxHeight`.
- [ ] Search mode toggle and SearchInput remain usable.
- [ ] Scrolling remains correct (no broken sticky scroll, no incorrect scroll height calculations).
- [ ] No layout glitches when resizing the terminal repeatedly.

### Regression checks

- [ ] Comfortable mode looks identical (or near-identical) to the current default in normal-sized terminals.
- [ ] Dialogs (help, confirm, alerts) remain visible and usable in compact mode.

## Risks & mitigations

| Risk                                                                     | Impact | Mitigation                                                                              |
| ------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| Off-by-one height/padding results in clipped UI                          | High   | Clamp all computed values; validate at tiny heights (ex: 80×16)                         |
| Removing gap/padding makes UI feel cramped or hard to scan               | Medium | Use compact mode only at small heights or when explicitly configured                    |
| Unexpected interaction between prompt height and scrollbox flex behavior | Medium | Add targeted manual QA steps; consider wrapping prompt+footer in its own flex container |
| Platform differences (Windows Terminal vs macOS terminals)               | Medium | Validate on at least one Windows terminal in addition to macOS/Linux                    |

## Internal code reference index

| Area                   | File                                                           | Notes                                                                              |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| App root sizing        | `packages/opencode/src/cli/cmd/tui/app.tsx`                    | Root `<box>` uses `width/height` from `useTerminalDimensions()`                    |
| Session layout spacing | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`   | Root `<box>` includes `paddingTop`, `paddingBottom`, `gap`; contains prompt+footer |
| Prompt component       | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | Textarea + separator + status/hints rows contribute vertical chrome                |
| Session footer         | `packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx`  | Single-line footer; candidate to hide in compact mode                              |
| Sidebar layout         | `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` | Has `paddingTop`/`paddingBottom` on container                                      |
| Config schema          | `packages/opencode/src/config/config.ts`                       | Add `tui.density` field                                                            |
| Docs                   | `packages/web/src/content/docs/tui.mdx`                        | Document new config option                                                         |

## External reference index

- https://github.com/sst/opentui/blob/main/packages/core/src/renderer.ts
- https://github.com/sst/opentui/blob/main/packages/solid/src/elements/hooks.ts
- https://github.com/remorses/ghostty-opentui/blob/main/tui/interactive.tsx
