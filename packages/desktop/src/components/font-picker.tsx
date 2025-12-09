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

export function FontPicker() {
  const [currentFont, setCurrentFont] = createSignal<FontDefinition>(FONTS[0])
  let previewFont: FontDefinition | undefined

  onMount(async () => {
    const savedFontId = localStorage.getItem(STORAGE_KEY_FONT) ?? DEFAULT_FONT_ID
    const font = getFontById(savedFontId) ?? FONTS[0]

    if (font.googleFontsUrl) {
      try {
        await loadFont(font)
      } catch {
        setCurrentFont(FONTS[0])
        applyFont(FONTS[0])
        return
      }
    }

    setCurrentFont(font)
    applyFont(font)
  })

  async function handleSelect(font: FontDefinition | undefined) {
    if (!font) return
    previewFont = undefined

    if (font.googleFontsUrl) {
      try {
        await loadFont(font)
      } catch {
        return
      }
    }

    setCurrentFont(font)
    localStorage.setItem(STORAGE_KEY_FONT, font.id)
    applyFont(font)
  }

  async function handleHighlight(font: FontDefinition | undefined) {
    if (!font) return
    previewFont = font

    if (font.googleFontsUrl) {
      try {
        await loadFont(font)
      } catch {
        return
      }
    }

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
