## Project Plan: Desktop Favorite Models in Model Picker (Lightweight, localStorage-only)

### Metadata

| Field           | Value                                                             |
| --------------- | ----------------------------------------------------------------- |
| Issue           | #130 `feat(desktop): Add favorite models support to model picker` |
| Date            | 2025-12-14                                                        |
| Scope           | Desktop web UI only                                               |
| Storage         | Browser `localStorage` only                                       |
| Backend changes | **Explicitly out of scope for Phase 1**                           |

---

## Context Capture

### Problem

The desktop model picker currently cannot mark models as favorites and pin them at the top of the list.

- Desktop today persists only **recent** models in browser `localStorage`.
- The TUI already supports favorites and persists to a file: `~/.local/state/opencode/model.json`.

### What the GitHub issue asked for

Issue #130 requested desktop parity with TUI favorites:

- Favorite models appear in a **“Favorites”** group at the top of the model picker.
- Users can toggle favorite status via a star/heart icon.
- Favorites persist across sessions.
- Desktop and TUI share the same favorites data (`~/.local/state/opencode/model.json`).
- Favorites remain at the top regardless of search/filter state.
- Visual indicator shows which models are favorited.

The issue’s proposed approach was to add server endpoints so the desktop can read/write `model.json`, since browser code cannot access `~/.local/state/...` directly.

### Decision made in this conversation (scope change)

We will implement a **lightweight Phase 1**:

- **Browser `localStorage` only** for persistence.
- **No backend changes** (no new API endpoints, no SDK changes).
- The feature is intended as a **minor desktop improvement**, not a cross-client sync initiative.

This means the following issue requirement is **explicitly deferred**:

- “Desktop shares the same favorites data as the TUI (`~/.local/state/opencode/model.json`)”.

We will still design the localStorage schema to be compatible with the TUI’s `{ recent, favorite }` shape to reduce future migration pain.

---

## Goals (Phase 1)

- Add the ability to favorite/unfavorite models in the desktop model picker.
- Show favorites in a dedicated **Favorites** group pinned to the top.
- Persist favorites across desktop sessions.
- Keep behavior correct with search/filter (Favorites group always sorts first).

## Non-Goals (Phase 1)

- No cross-client sync with TUI favorites.
- No server endpoints or filesystem reads/writes from desktop.
- No new keyboard shortcuts (unless already supported patterns make it trivial).

---

## Current State (Internal Code References)

### Desktop model persistence

- `packages/desktop/src/context/local.tsx`
  - Reads browser storage key `"model"` via `localStorage.getItem("model")`.
  - Stores **only** `recent: ModelKey[]` (currently as a raw JSON array in localStorage).
  - Does not have `favorite` support.

### Desktop model picker UI

- `packages/desktop/src/components/prompt-input.tsx`
  - Opens the model picker via `layout.dialog.open("model")`.
  - Uses `SelectDialog` to render the model list.
  - Current `groupBy` is `x.provider.name` (a commented out “Recent” group exists).

### Shared UI components used by the model picker

- `packages/ui/src/components/select-dialog.tsx`
  - Wraps `List` and provides filter UI.

- `packages/ui/src/components/list.tsx`
  - Renders each item as a `<button data-slot="list-item">` and calls `onSelect` on click.

- `packages/ui/src/hooks/use-filtered-list.tsx`
  - Applies fuzzy filtering first, then grouping, then group sorting.
  - This means “Favorites stays on top during filter” is accomplished via `sortGroupsBy`.

### Reference implementation (TUI)

- `packages/opencode/src/cli/cmd/tui/context/local.tsx`
  - Persists `{ recent, favorite }` to `~/.local/state/opencode/model.json`.
  - Provides `toggleFavorite` logic and treats favorites as ordered (newly favorited first).

---

## Proposed Technical Approach (Phase 1)

### Summary

Implement favorites entirely within desktop state and model picker:

1. Extend desktop local model store to track `favorite: ModelKey[]`.
2. Persist `{ recent, favorite }` to `localStorage` under the existing `"model"` key.
3. Update model picker `SelectDialog` to:
   - show a star toggle per model,
   - group favorites under a “Favorites” category,
   - keep “Favorites” at the top via `sortGroupsBy`.

### Data model

Use existing `ModelKey` in desktop:

- `packages/desktop/src/context/local.tsx` defines:
  - `export type ModelKey = { providerID: string; modelID: string }`

Define a persisted preferences object matching TUI’s shape:

```ts
// Stored in localStorage key: "model"
export type ModelPrefsV1 = {
  version: 1
  recent: ModelKey[]
  favorite: ModelKey[]
}
```

### Persistence and migration

#### Storage key

- Reuse existing key: `localStorage["model"]`.

#### Backward compatibility

Existing desktop installs may have `localStorage["model"]` as a JSON array (`ModelKey[]`).

Plan:

- On load:
  - If parsed value is an array: treat as `recent`, set `favorite = []`, and **migrate** in-memory to `ModelPrefsV1`.
  - If parsed value is an object with `{ recent, favorite }`: use it.

- On save:
  - Always write the new object form (`ModelPrefsV1`).

Rationale:

- Avoid losing existing “recent” history.
- Keep the schema aligned with TUI for future sync.

### Favorite semantics

- Favorites are stored as an ordered list of `ModelKey`.
- Toggling favorite:
  - If already present: remove it.
  - If not present: prepend to the favorites array.

This matches TUI’s mental model (“newly favorited is most prominent”).

### UI/UX specification

#### Where the star toggle appears

- In the model picker’s list row UI in:
  - `packages/desktop/src/components/prompt-input.tsx` inside the `SelectDialog` render function.

#### Visual indicator

- Favorited items show a filled star (or high-emphasis star styling).
- Non-favorited items show an outline star (or low-emphasis styling).

#### Grouping

- `groupBy(model)` returns:
  - `"Favorites"` if the model is favorited
  - otherwise the provider name (existing behavior)

#### Group ordering

Update `sortGroupsBy` in the model picker to enforce:

1. Favorites group first
2. (Optional) Recent group second if re-enabled later
3. Then provider ordering as currently implemented

#### Event handling (critical)

`List` currently renders items as a `<button>`, which makes it tricky to add an interactive star control inside without accidentally selecting the model.

Lightweight plan:

- Render the star as a non-`<button>` element (e.g. a `<div>` or `<span>`), and use `onPointerDown` / `onClick` with `stopPropagation()` to prevent the parent list-item click handler from firing.

If this is too fragile, consider a small shared UI enhancement:

- Add an official “item action slot” to `packages/ui/src/components/list.tsx` so actions can be rendered outside the clickable/selectable area.

---

## Options Considered

| Option | Description                                                      | Pros                                                | Cons                                                                 | Decision                 |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| A      | Add server endpoints to read/write `model.json` (issue proposal) | Enables TUI/Desktop sharing immediately             | Backend + SDK changes; more surface area; against Phase 1 constraint | **Rejected for Phase 1** |
| B      | Desktop-only `localStorage` favorites                            | Small change; no backend; fast iteration            | No TUI sharing                                                       | **Chosen (Phase 1)**     |
| C      | Use `makePersisted` for model prefs store                        | Built-in persistence + potential migration patterns | Requires refactor of existing model persistence                      | Optional follow-up       |

---

## External References (Git URLs)

These are relevant patterns/tools for the planned implementation:

- Solid Primitives Storage (contains `makePersisted` and storage utilities)
  - `https://github.com/solidjs-community/solid-primitives/tree/main/packages/storage`

- Solid Primitives Event Listener (contains `stopPropagation` helper)
  - `https://github.com/solidjs-community/solid-primitives/tree/main/packages/event-listener`

- Kobalte Select example showing `onPointerDown={e => e.stopPropagation()}` around nested controls
  - `https://github.com/kobaltedev/kobalte`

---

## Implementation Plan (Step-by-step)

### Milestone 1 — Desktop state supports favorites (persistence + API)

**Files**

- `packages/desktop/src/context/local.tsx`

**Tasks**

- [ ] Define a persisted schema for model preferences (suggest `ModelPrefsV1`).
- [ ] Extend the model store state to include `favorite: ModelKey[]`.
- [ ] Implement a load step that:
  - [ ] reads `localStorage.getItem("model")`
  - [ ] supports legacy array format (`ModelKey[]`) as `recent`
  - [ ] supports object format (`{ recent, favorite }`)
  - [ ] initializes favorites to `[]` when absent
- [ ] Implement a save step that writes `{ version: 1, recent, favorite }`.
- [ ] Add model store APIs mirroring TUI names where helpful:
  - [ ] `favorite(): ModelKey[]` (or `favorites(): ModelKey[]`, pick one and standardize)
  - [ ] `toggleFavorite(model: ModelKey): void`
  - [ ] `isFavorite(model: ModelKey): boolean` (recommended for efficient UI grouping)
- [ ] Ensure favorites are unique (no duplicates) using the same keying strategy as recents.

**Validation criteria**

- [ ] Refreshing the desktop app preserves favorites.
- [ ] Existing users with old `localStorage["model"]` (array) keep their recents and get an empty favorites list.
- [ ] `localStorage["model"]` is updated to the new object schema after first save.

---

### Milestone 2 — Model picker UI supports favorites

**Files**

- `packages/desktop/src/components/prompt-input.tsx`
- `packages/ui/src/components/select-dialog.tsx` (reference only unless needed)
- `packages/ui/src/components/list.tsx` (reference; may need small enhancement)
- `packages/ui/src/hooks/use-filtered-list.tsx` (reference only)

**Tasks**

- [ ] Add a “Favorites” group by updating `groupBy`:
  - [ ] Return `"Favorites"` when `local.model.isFavorite(...)`.
- [ ] Update `sortGroupsBy` to always sort “Favorites” first (even while filtering).
- [ ] Add a star control in each model row:
  - [ ] Clicking the star toggles favorite without selecting the model.
  - [ ] Clicking elsewhere in the row still selects the model.
- [ ] Add a visual indicator for favorited rows (icon state + styling).
- [ ] Confirm that favorites appear pinned at top even when search filter is active.

**Validation criteria**

- [ ] Favorites group appears at top when at least 1 favorite exists.
- [ ] Favoriting/unfavoriting updates the UI immediately.
- [ ] Favorites remain top under search/filter.
- [ ] Star clicks do not select the model (no accidental model changes).

---

### Milestone 3 — Icon support for star/heart

The shared `Icon` component currently does not include a star/heart glyph.

**Files**

- `packages/ui/src/components/icon.tsx`
- `packages/ui/src/components/icon-button.tsx` (reference)

**Tasks**

- [ ] Add icon(s) needed for the favorite UI:
  - [ ] `star` (outline)
  - [ ] `star-filled` (or `star-solid`) for the active state
- [ ] Decide on icon naming consistent with the existing icon naming style.
- [ ] Use the new icon(s) from the model picker.

**Validation criteria**

- [ ] The model picker renders the icon without missing-icon errors.
- [ ] Favorited and non-favorited states are visually distinct.

---

### Milestone 4 — UX polish and edge cases

**Tasks**

- [ ] Decide how to handle favorites for disconnected providers:
  - [ ] Keep them in storage (so they return on reconnect)
  - [ ] Only show favorites that exist in the current model list
- [ ] Ensure favorites are stable under provider filtering (connect flow).
- [ ] Add an optional “unfavorite” tooltip/aria-label for accessibility.
- [ ] Confirm performance is acceptable with fuzzy filtering and grouping.

**Validation criteria**

- [ ] No regressions in the model picker’s navigation and selection.
- [ ] No console errors when providers connect/disconnect.

---

## Manual Test Plan

### Core scenarios

- [ ] Open model picker, favorite a model, close dialog, reopen dialog → model appears in Favorites group.
- [ ] Refresh/restart desktop app → favorites persist.
- [ ] Favorite multiple models → order reflects most recently favorited first.
- [ ] Unfavorite a model → it disappears from Favorites group.

### Search/filter scenarios

- [ ] With favorites set, type in the model search box:
  - [ ] Favorites group still appears above other groups when matches exist.
  - [ ] Non-matching favorites do not appear (expected).

### Provider scenarios

- [ ] Favorite models from multiple providers.
- [ ] Trigger provider filtering (if applicable via connect flow) → favorites for that provider remain grouped at top.

---

## Acceptance Criteria Mapping

### Met in Phase 1

- [ ] Favorite models appear in a “Favorites” group at the top of the model picker list.
- [ ] Users can toggle favorite status via a star/heart icon in the model picker.
- [ ] Favorites persist across sessions (desktop-only, via localStorage).
- [ ] Favorites remain at top regardless of search/filter state.
- [ ] Visual indicator shows which models are favorited.

### Deferred / not met in Phase 1

- [ ] Desktop shares the same favorites data as the TUI (`~/.local/state/opencode/model.json`).

---

## Phase 2 (Optional, Deferred): Cross-client sync with TUI

This is intentionally **not** part of Phase 1, but included for completeness.

### Approach candidates

- **Server API approach (original issue proposal)**
  - Add endpoints to the opencode server to read/write `model.json`.
  - Desktop uses SDK calls instead of localStorage.

Potential endpoints (if revisited):

```http
GET /model/preferences
200 OK
{
  "recent": [{"providerID":"...","modelID":"..."}],
  "favorite": [{"providerID":"...","modelID":"..."}]
}

POST /model/preferences
Content-Type: application/json
{
  "recent": [...],
  "favorite": [...]
}
```

**Internal files referenced by the issue’s proposed approach**

- `packages/opencode/src/server/server.ts`
- `packages/opencode/src/global/index.ts`

### Why it’s deferred

- Adds backend surface area for a desktop-only UX improvement.
- Requires SDK updates and release coordination.

---

## Risks and Mitigations

| Risk                                                                                   | Impact                                     | Mitigation                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nested interactive element inside `List` item button causes accidental model selection | User frustration / unexpected model change | Use `stopPropagation` on star interactions (`onPointerDown` + `onClick`); if needed, add a proper “action slot” in `packages/ui/src/components/list.tsx` |
| Corrupted `localStorage["model"]` breaks JSON parsing                                  | Model picker may break on load             | Implement a safe parse + fallback to empty prefs (minimize try/catch usage but be pragmatic for user-controlled storage)                                 |
| Favorites schema migration loses recents                                               | Minor regression                           | Explicitly support legacy array format and migrate forward                                                                                               |

---

## Deliverables

- A desktop model picker with favorite toggling UI.
- `localStorage`-persisted favorites under the existing `"model"` storage key.
- A minimal icon addition to support the star/heart UI.
