import { createMemo, createSignal, onMount } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { FONTS, getFontById, type FontDefinition } from "@/fonts/font-definitions"
import { useLayout } from "@/context/layout"
import { applyFontWithLoad, ensureFontLoaded, applyFont } from "@/fonts/apply-font"

function DialogSelectFont(props: { originalFont: string }) {
  const layout = useLayout()
  const dialog = useDialog()
  const [previewFont, setPreviewFont] = createSignal(props.originalFont)
  const currentFont = createMemo(() => getFontById(previewFont()) ?? FONTS[0])

  async function handleSelect(font: FontDefinition | undefined) {
    if (!font) return

    const loaded = await ensureFontLoaded(font)
    if (!loaded) return

    layout.font.set(font.id)
    applyFont(font.id)
    dialog.pop()
  }

  async function handleActiveChange(font: FontDefinition | undefined) {
    if (!font) return

    const loaded = await ensureFontLoaded(font)
    if (!loaded) return

    setPreviewFont(font.id)
    applyFont(font.id)
  }

  return (
    <Dialog title="Select Font">
      <List
        search={{ placeholder: "Search fonts", autofocus: true }}
        emptyMessage="No fonts found"
        key={(f: FontDefinition) => f.id}
        items={() => [...FONTS]}
        current={currentFont()}
        filterKeys={["name", "family"]}
        onSelect={handleSelect}
        onActiveChange={handleActiveChange}
      >
        {(font: FontDefinition) => (
          <div class="flex items-center gap-2" style={{ "font-family": `"${font.family}", monospace` }}>
            <span class="text-14-medium text-text-strong">{font.name}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}

export function FontPicker() {
  const layout = useLayout()
  const dialog = useDialog()
  const currentFont = createMemo(() => getFontById(layout.font.current()) ?? FONTS[0])

  onMount(() => applyFontWithLoad(currentFont()))

  function openDialog() {
    const originalFont = currentFont().id
    dialog.replace(
      () => <DialogSelectFont originalFont={originalFont} />,
      () => applyFont(originalFont),
    )
  }

  return (
    <Tooltip class="shrink-0" value="Font">
      <Button variant="ghost" class="size-6 p-0" onClick={openDialog}>
        <Icon name="code-lines" size="small" />
      </Button>
    </Tooltip>
  )
}
