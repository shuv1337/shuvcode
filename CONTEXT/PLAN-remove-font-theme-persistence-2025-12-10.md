# Plan: Remove Font and Theme Persistence Code

**Date**: 2025-12-10  
**Status**: Implementation Complete  
**Package**: `packages/desktop`

## Background

Multiple attempts have been made to persist font and theme selections in the desktop app using `localStorage`, but none have worked reliably across app/browser reloads. This plan documents the complete removal of all persistence-related code so we can re-approach the problem from a fresh direction.

## Problem Statement

The current implementation uses `localStorage` to persist user preferences for:

- **Theme**: Stored under key `"theme"`
- **Font**: Stored under key `"ui-font"`

The persistence mechanism includes:

1. Early initialization in `index.html` (before React/Solid loads) to prevent flash
2. Init functions (`initTheme()`, `initFont()`) called at app startup
3. Persistence functions called when user makes a selection
4. Read functions to restore state from localStorage

Despite these mechanisms, preferences are not persisting correctly across reloads.

---

## Files to Modify

| File                                               | Changes Required                                            |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `packages/desktop/index.html`                      | Remove inline script for theme/font initialization          |
| `packages/desktop/src/components/theme-picker.tsx` | Remove localStorage read/write, remove `initTheme()` export |
| `packages/desktop/src/components/font-picker.tsx`  | Remove localStorage read/write, remove `initFont()` export  |
| `packages/desktop/src/app.tsx`                     | Remove init function imports and calls                      |

---

## Detailed Changes

### 1. `packages/desktop/index.html`

**Current code to remove (lines 21-53):**

```html
<script>
  ;(function () {
    // Early theme initialization to prevent flash
    let savedTheme = localStorage.getItem("theme") || "nightowl"
    // Migrate legacy theme ID
    if (savedTheme === "oc-1") {
      savedTheme = "default"
      localStorage.setItem("theme", savedTheme)
    }
    // "default" uses :root styles (no data-theme attribute)
    if (savedTheme !== "default") {
      document.documentElement.setAttribute("data-theme", savedTheme)
    }

    // Early font initialization to prevent flash
    var savedFont = localStorage.getItem("ui-font") || "meslo"
    var fontFamilies = {
      geist: '"Geist", "Geist Fallback", sans-serif',
      meslo: '"meslo", "Menlo", "Monaco", "Courier New", monospace',
      inter: '"Inter", sans-serif',
      nunito: '"Nunito", sans-serif',
      "roboto-condensed": '"Roboto Condensed", sans-serif',
      oswald: '"Oswald", sans-serif',
      forum: '"Forum", serif',
      rubik: '"Rubik", sans-serif',
      "ubuntu-mono": '"Ubuntu Mono", monospace',
      "jetbrains-mono": '"JetBrains Mono", monospace',
      inconsolata: '"Inconsolata", monospace',
    }
    var fontFamily = fontFamilies[savedFont] || fontFamilies.meslo
    document.documentElement.style.setProperty("--font-family-sans", fontFamily)
  })()
</script>
```

**After removal**: The `<script>` block should be completely removed. The app will use CSS defaults until user makes a selection.

---

### 2. `packages/desktop/src/components/theme-picker.tsx`

**Code to remove:**

```typescript
// Line 8 - Storage key constant
const STORAGE_KEY_THEME = "theme"

// Lines 36-39 - Legacy migration function (no longer needed without persistence)
function normalizeLegacyThemeId(id: string): string {
  if (id === "oc-1") return "default"
  return id
}

// Lines 41-47 - Read from localStorage
function readStoredThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_THEME) ?? DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

// Lines 49-55 - Persist to localStorage
function persistThemeId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY_THEME, id)
  } catch {
    /* ignore */
  }
}

// Lines 57-60 - Get stored theme (modify to use default)
function getStoredTheme(): Theme {
  const savedId = normalizeLegacyThemeId(readStoredThemeId())
  return THEMES.find((t) => t.id === savedId) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID) ?? BASE_THEMES[1]
}

// Lines 79-81 - Exported init function
export function initTheme() {
  applyTheme(getStoredTheme())
}

// Line 93 - In handleSelect, remove persistThemeId call
persistThemeId(theme.id)
```

**Modifications needed:**

- [ ] Remove `STORAGE_KEY_THEME` constant
- [ ] Remove `normalizeLegacyThemeId()` function
- [ ] Remove `readStoredThemeId()` function
- [ ] Remove `persistThemeId()` function
- [ ] Rename `getStoredTheme()` to `getDefaultTheme()` and simplify to return the default theme
- [ ] Remove `export function initTheme()`
- [ ] Remove `persistThemeId(theme.id)` call from `handleSelect()`
- [ ] Update `ThemePicker` component to initialize with default theme instead of stored theme

**Target state for theme-picker.tsx:**

```typescript
import { createSignal, onMount } from "solid-js"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { CLI_THEME_IDS, applyCliTheme, clearTerminalTheme, clearUiTheme } from "@/theme/terminal-themes"

const DEFAULT_THEME_ID = "nightowl"

const BASE_THEMES = [
  { id: "default", name: "Default" },
  { id: "nightowl", name: "Night Owl" },
  { id: "oc-2-paper", name: "Paper" },
]

const baseThemeIds = new Set(BASE_THEMES.map((t) => t.id))

const CLI_THEMES = CLI_THEME_IDS.filter((id) => !baseThemeIds.has(id)).map((id) => ({
  id,
  name: formatThemeName(id),
}))

const THEMES = [...BASE_THEMES, ...CLI_THEMES]

type Theme = (typeof THEMES)[number]

function formatThemeName(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((word) => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ")
}

function getDefaultTheme(): Theme {
  return THEMES.find((t) => t.id === DEFAULT_THEME_ID) ?? BASE_THEMES[1]
}

function applyTheme(theme: Theme) {
  if (theme.id === "default") {
    document.documentElement.removeAttribute("data-theme")
  } else {
    document.documentElement.setAttribute("data-theme", theme.id)
  }

  if (baseThemeIds.has(theme.id)) {
    clearTerminalTheme()
    clearUiTheme()
  } else {
    applyCliTheme(theme.id)
  }

  document.documentElement.dispatchEvent(new CustomEvent("terminal-theme-changed"))
}

export function ThemePicker() {
  const [currentTheme, setCurrentTheme] = createSignal<Theme>(getDefaultTheme())

  onMount(() => applyTheme(currentTheme()))

  function handleSelect(theme: Theme | undefined) {
    if (!theme) return
    setCurrentTheme(theme)
    applyTheme(theme)
  }

  function handleHighlight(theme: Theme | undefined) {
    if (!theme) return
    applyTheme(theme)
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      applyTheme(currentTheme())
    }
  }

  return (
    <SelectDialog
      title="Select Theme"
      placeholder="Search themes"
      emptyMessage="No themes found"
      key={(t) => t.id}
      items={[...THEMES]}
      current={currentTheme()}
      filterKeys={["name", "id"]}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      onOpenChange={handleOpenChange}
      trigger={
        <Tooltip class="shrink-0" value="Theme">
          <Button variant="ghost" class="size-6 p-0">
            <Icon name="droplet" size="small" />
          </Button>
        </Tooltip>
      }
    >
      {(theme) => (
        <div class="flex items-center gap-2">
          <span class="text-14-medium text-text-strong">{theme.name}</span>
        </div>
      )}
    </SelectDialog>
  )
}
```

---

### 3. `packages/desktop/src/components/font-picker.tsx`

**Code to remove:**

```typescript
// Line 9 - Storage key constant
const STORAGE_KEY_FONT = "ui-font"

// Lines 16-22 - Read from localStorage
function readStoredFontId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_FONT) ?? DEFAULT_FONT_ID
  } catch {
    return DEFAULT_FONT_ID
  }
}

// Lines 24-30 - Persist to localStorage
function persistFontId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY_FONT, id)
  } catch {
    /* ignore */
  }
}

// Lines 32-35 - Get saved font (modify to use default)
function getSavedFont(): FontDefinition {
  const savedFontId = readStoredFontId()
  return getFontById(savedFontId) ?? FONTS[0]
}

// Lines 47-55 - Exported init function
export async function initFont() {
  const font = getSavedFont()
  const loaded = await ensureFontLoaded(font)
  if (!loaded) {
    applyFont(FONTS[0])
    return
  }
  applyFont(font)
}

// Line 73 - In handleSelect, remove persistFontId call
persistFontId(font.id)
```

**Modifications needed:**

- [ ] Remove `STORAGE_KEY_FONT` constant
- [ ] Remove `readStoredFontId()` function
- [ ] Remove `persistFontId()` function
- [ ] Rename `getSavedFont()` to `getDefaultFont()` and simplify to return the default font
- [ ] Remove `export async function initFont()`
- [ ] Remove `persistFontId(font.id)` call from `handleSelect()`
- [ ] Update `FontPicker` component to initialize with default font

**Target state for font-picker.tsx:**

```typescript
import { createSignal, onMount } from "solid-js"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { FONTS, DEFAULT_FONT_ID, getFontById, type FontDefinition } from "@/fonts/font-definitions"
import { loadFont } from "@/fonts/font-loader"

function applyFont(font: FontDefinition): void {
  const fontFamily = `"${font.family}", ${font.fallback}`
  document.documentElement.style.setProperty("--font-family-sans", fontFamily)
}

function getDefaultFont(): FontDefinition {
  return getFontById(DEFAULT_FONT_ID) ?? FONTS[0]
}

async function ensureFontLoaded(font: FontDefinition): Promise<boolean> {
  if (!font.googleFontsUrl) return true
  try {
    await loadFont(font)
    return true
  } catch {
    return false
  }
}

export function FontPicker() {
  const [currentFont, setCurrentFont] = createSignal<FontDefinition>(getDefaultFont())

  onMount(async () => {
    const font = currentFont()
    const loaded = await ensureFontLoaded(font)
    if (loaded) {
      applyFont(font)
    } else {
      applyFont(FONTS[0])
    }
  })

  async function handleSelect(font: FontDefinition | undefined) {
    if (!font) return

    const loaded = await ensureFontLoaded(font)
    if (!loaded) return

    setCurrentFont(font)
    applyFont(font)
  }

  async function handleHighlight(font: FontDefinition | undefined) {
    if (!font) return

    const loaded = await ensureFontLoaded(font)
    if (!loaded) return

    applyFont(font)
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      applyFont(currentFont())
    }
  }

  return (
    <SelectDialog
      title="Select Font"
      placeholder="Search fonts"
      emptyMessage="No fonts found"
      key={(f) => f.id}
      items={[...FONTS]}
      current={currentFont()}
      filterKeys={["name", "family"]}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      onOpenChange={handleOpenChange}
      trigger={
        <Tooltip class="shrink-0" value="Font">
          <Button variant="ghost" class="size-6 p-0">
            <Icon name="type" size="small" />
          </Button>
        </Tooltip>
      }
    >
      {(font) => (
        <div class="flex items-center gap-2" style={{ "font-family": `"${font.family}", monospace` }}>
          <span class="text-14-medium text-text-strong">{font.name}</span>
        </div>
      )}
    </SelectDialog>
  )
}
```

---

### 4. `packages/desktop/src/app.tsx`

**Code to remove (lines 19-26):**

```typescript
import { initTheme } from "@/components/theme-picker"
import { initFont } from "@/components/font-picker"

// Initialize theme and font from localStorage before render to prevent flash
if (typeof window !== "undefined") {
  initTheme()
  void initFont()
}
```

**After removal**: The two imports and the entire `if` block should be deleted. The app will rely on CSS defaults and component `onMount` handlers.

---

## Implementation Checklist

### Phase 1: Remove Early Initialization

- [x] Remove inline `<script>` block from `packages/desktop/index.html` (lines 21-53)

### Phase 2: Clean Up theme-picker.tsx

- [x] Remove `STORAGE_KEY_THEME` constant (line 8)
- [x] Remove `normalizeLegacyThemeId()` function (lines 36-39)
- [x] Remove `readStoredThemeId()` function (lines 41-47)
- [x] Remove `persistThemeId()` function (lines 49-55)
- [x] Simplify `getStoredTheme()` to `getDefaultTheme()` (lines 57-60)
- [x] Remove `initTheme()` export (lines 79-81)
- [x] Remove `persistThemeId()` call in `handleSelect()` (line 93)
- [x] Remove `previewTheme` variable tracking (no longer needed for persistence)
- [x] Simplify `handleOpenChange()` logic

### Phase 3: Clean Up font-picker.tsx

- [x] Remove `STORAGE_KEY_FONT` constant (line 9)
- [x] Remove `readStoredFontId()` function (lines 16-22)
- [x] Remove `persistFontId()` function (lines 24-30)
- [x] Simplify `getSavedFont()` to `getDefaultFont()` (lines 32-35)
- [x] Remove `initFont()` export (lines 47-55)
- [x] Remove `persistFontId()` call in `handleSelect()` (line 73)
- [x] Update `onMount` to apply default font
- [x] Remove `previewFont` variable tracking

### Phase 4: Clean Up app.tsx

- [x] Remove `import { initTheme }` statement (line 19)
- [x] Remove `import { initFont }` statement (line 20)
- [x] Remove initialization `if` block (lines 22-26)

### Phase 5: Testing

- [x] Verify app loads with default theme (Night Owl)
- [x] Verify app loads with default font (Meslo)
- [x] Verify theme picker works (changes theme in session)
- [x] Verify font picker works (changes font in session)
- [x] Verify no console errors related to localStorage
- [x] Verify app reloads to defaults (persistence removed as expected)

---

## Files Untouched (No Changes Needed)

The following files are part of the theme/font system but do NOT contain persistence logic and should remain unchanged:

| File                                             | Reason to Keep                                        |
| ------------------------------------------------ | ----------------------------------------------------- |
| `packages/desktop/src/fonts/font-definitions.ts` | Font metadata and `DEFAULT_FONT_ID` constant          |
| `packages/desktop/src/fonts/font-loader.ts`      | Dynamic Google Fonts loading (runtime only)           |
| `packages/desktop/src/theme/terminal-themes.ts`  | Theme application utilities                           |
| `packages/desktop/src/components/terminal.tsx`   | Theme change observer (watches DOM, not localStorage) |

---

## Rollback Plan

If issues arise, the git history will contain the complete persistence implementation. The key localStorage keys used were:

- `"theme"` - Theme ID string
- `"ui-font"` - Font ID string

---

## Notes for Future Persistence Implementation

When re-implementing persistence, consider these alternative approaches:

1. **Tauri Store Plugin** - Use `@tauri-apps/plugin-store` for native file-based storage
2. **Server-side persistence** - Store preferences in the opencode server/config
3. **IndexedDB** - More robust than localStorage for complex data
4. **URL parameters** - For shareable theme/font configurations
5. **CSS prefers-color-scheme** - For automatic dark/light mode detection

The current localStorage approach may have been failing due to:

- Tauri webview storage isolation
- Service worker caching issues
- CSP restrictions
- Storage quota limits
- Origin/protocol mismatches between dev and prod

Further investigation should be done before re-implementing.
