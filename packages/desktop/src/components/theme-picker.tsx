import { createSignal, onMount } from "solid-js"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { THEMES, getThemeById, applyTheme, DEFAULT_THEME_ID, type Theme } from "@/theme/apply-theme"

function getDefaultTheme(): Theme {
  return getThemeById(DEFAULT_THEME_ID)
}

export function ThemePicker() {
  const [currentTheme, setCurrentTheme] = createSignal<Theme>(getDefaultTheme())
  const [previewTheme, setPreviewTheme] = createSignal<Theme | undefined>()

  onMount(() => applyTheme(currentTheme().id))

  function handleSelect(theme: Theme | undefined) {
    if (!theme) return
    setCurrentTheme(theme)
    setPreviewTheme(undefined)
    applyTheme(theme.id)
  }

  function handleOpenChange(open: boolean) {
    if (!open && previewTheme()) {
      applyTheme(currentTheme().id)
      setPreviewTheme(undefined)
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
      onOpenChange={handleOpenChange}
      trigger={
        <Tooltip class="shrink-0" value="Theme">
          <Button variant="ghost" class="size-6 p-0">
            <Icon name="dot-grid" size="small" />
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
