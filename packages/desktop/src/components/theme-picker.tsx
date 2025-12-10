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
