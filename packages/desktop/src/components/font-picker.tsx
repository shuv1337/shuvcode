import { createSignal, onMount } from "solid-js"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { FONTS, DEFAULT_FONT_ID, getFontById, type FontDefinition } from "@/fonts/font-definitions"
import { loadFont } from "@/fonts/font-loader"

const STORAGE_KEY_FONT = "ui-font"

function applyFont(font: FontDefinition): void {
  const fontFamily = `"${font.family}", ${font.fallback}`
  document.documentElement.style.setProperty("--font-family-sans", fontFamily)
}

function readStoredFontId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_FONT) ?? DEFAULT_FONT_ID
  } catch {
    return DEFAULT_FONT_ID
  }
}

function persistFontId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY_FONT, id)
  } catch {
    /* ignore */
  }
}

function getSavedFont(): FontDefinition {
  const savedFontId = readStoredFontId()
  return getFontById(savedFontId) ?? FONTS[0]
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

export async function initFont() {
  const font = getSavedFont()
  const loaded = await ensureFontLoaded(font)
  if (!loaded) {
    applyFont(FONTS[0])
    return
  }
  applyFont(font)
}

export function FontPicker() {
  const [currentFont, setCurrentFont] = createSignal<FontDefinition>(getSavedFont())
  let previewFont: FontDefinition | undefined

  onMount(() => {
    void initFont()
  })

  async function handleSelect(font: FontDefinition | undefined) {
    if (!font) return
    previewFont = undefined

    const loaded = await ensureFontLoaded(font)
    if (!loaded) return

    setCurrentFont(font)
    persistFontId(font.id)
    applyFont(font)
  }

  async function handleHighlight(font: FontDefinition | undefined) {
    if (!font) return
    previewFont = font

    const loaded = await ensureFontLoaded(font)
    if (!loaded) return

    applyFont(font)
  }

  function handleOpenChange(open: boolean) {
    if (!open && previewFont) {
      applyFont(currentFont())
      previewFont = undefined
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
