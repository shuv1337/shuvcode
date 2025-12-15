import { createMemo, onMount } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { THEMES, getThemeById, applyTheme, type Theme } from "@/theme/apply-theme"

export function ThemePicker() {
  const layout = useLayout()
  const dialog = useDialog()
  const currentTheme = createMemo(() => getThemeById(layout.theme.current()))

  onMount(() => applyTheme(currentTheme().id))

  function handleSelect(theme: Theme | undefined) {
    if (!theme) return
    layout.theme.set(theme.id)
    applyTheme(theme.id)
    dialog.pop()
  }

  function openDialog() {
    const originalTheme = currentTheme().id
    dialog.push(
      <Dialog title="Select Theme">
        <List
          search={{ placeholder: "Search themes", autofocus: true }}
          emptyMessage="No themes found"
          key={(t: Theme) => t.id}
          items={() => [...THEMES]}
          current={currentTheme()}
          filterKeys={["name", "id"]}
          onSelect={handleSelect}
        >
          {(theme: Theme) => (
            <div class="flex items-center gap-2">
              <span class="text-14-medium text-text-strong">{theme.name}</span>
            </div>
          )}
        </List>
      </Dialog>,
      () => applyTheme(originalTheme),
    )
  }

  return (
    <Tooltip class="shrink-0" value="Theme">
      <Button variant="ghost" class="size-6 p-0" onClick={openDialog}>
        <Icon name="glasses" size="small" />
      </Button>
    </Tooltip>
  )
}
