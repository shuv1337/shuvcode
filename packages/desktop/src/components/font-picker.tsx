import { createSignal, onMount } from "solid-js"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { FONTS, getFontById, type FontDefinition } from "@/fonts/font-definitions"
import { applyFontWithLoad, ensureFontLoaded, applyFont } from "@/fonts/apply-font"

const DEFAULT_FONT_ID = "meslo"

function getDefaultFont(): FontDefinition {
  return getFontById(DEFAULT_FONT_ID) ?? FONTS[0]
}

export function FontPicker() {
  const [currentFont, setCurrentFont] = createSignal<FontDefinition>(getDefaultFont())
  const [previewFont, setPreviewFont] = createSignal<FontDefinition | undefined>()

  onMount(() => applyFontWithLoad(currentFont()))

  async function handleSelect(font: FontDefinition | undefined) {
    if (!font) return

    const loaded = await ensureFontLoaded(font)
    if (!loaded) return

    setCurrentFont(font)
    setPreviewFont(undefined)
    applyFont(font.id)
  }

  function handleOpenChange(open: boolean) {
    if (!open && previewFont()) {
      applyFont(currentFont().id)
      setPreviewFont(undefined)
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
      onOpenChange={handleOpenChange}
      trigger={
        <Tooltip class="shrink-0" value="Font">
          <Button variant="ghost" class="size-6 p-0">
            <Icon name="code-lines" size="small" />
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
