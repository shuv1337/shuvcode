import { createSignal, onMount } from "solid-js"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { CLI_THEME_IDS, applyCliTheme, clearTerminalTheme, clearUiTheme } from "@/theme/terminal-themes"

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

const INITIAL_THEME_ID = normalizeLegacyThemeId(
  typeof window === "undefined" ? "nightowl" : (localStorage.getItem("theme") ?? "nightowl"),
)

type Theme = (typeof THEMES)[number]

function formatThemeName(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((word) => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ")
}

function normalizeLegacyThemeId(id: string): string {
  if (id === "oc-1") return "default"
  return id
}

function applyThemeSelection(theme: Theme, setCurrentTheme: (theme: Theme) => void) {
  setCurrentTheme(theme)
  localStorage.setItem("theme", theme.id)

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
  const [currentTheme, setCurrentTheme] = createSignal<Theme>(BASE_THEMES[1])

  onMount(() => {
    const savedTheme = normalizeLegacyThemeId(localStorage.getItem("theme") ?? "nightowl")
    const theme = THEMES.find((t) => t.id === savedTheme) ?? BASE_THEMES[1]
    applyThemeSelection(theme, setCurrentTheme)
  })

  function handleThemeChange(theme: Theme | undefined) {
    if (!theme) return
    applyThemeSelection(theme, setCurrentTheme)
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
      onSelect={handleThemeChange}
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
