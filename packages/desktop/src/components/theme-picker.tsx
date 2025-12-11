import { createMemo, onMount } from "solid-js"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLayout } from "@/context/layout"
import { THEMES, getThemeById, applyTheme, type Theme } from "@/theme/apply-theme"

export function ThemePicker() {
  const layout = useLayout()
  const currentTheme = createMemo(() => getThemeById(layout.theme.current()))

  onMount(() => applyTheme(currentTheme().id))

  function handleSelect(theme: Theme | undefined) {
    if (!theme) return
    layout.theme.set(theme.id)
    applyTheme(theme.id)
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      applyTheme(currentTheme().id)
    }
  }

  return (
    <SelectDialog
      title="Select Theme"
      placeholder="Search themes"
      emptyMessage="No themes found"
      key={(t) => t.id}
      items={() => [...THEMES]}
      current={currentTheme()}
      filterKeys={["name", "id"]}
      onSelect={handleSelect}
      onOpenChange={handleOpenChange}
      trigger={
        <Tooltip class="shrink-0" value="Theme">
          <Button variant="ghost" class="size-6 p-0">
            <Icon name="glasses" size="small" />
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
