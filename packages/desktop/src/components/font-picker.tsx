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
