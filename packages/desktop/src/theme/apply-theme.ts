import { CLI_THEME_IDS, applyCliTheme, clearTerminalTheme, clearUiTheme } from "@/theme/terminal-themes"

export const DEFAULT_THEME_ID = "nightowl"

const BASE_THEMES = [
  { id: DEFAULT_THEME_ID, name: "Night Owl" },
  { id: "oc-2-paper", name: "Paper" },
]

const baseThemeIds = new Set(BASE_THEMES.map((t) => t.id))

const CLI_THEMES = CLI_THEME_IDS.filter((id) => !baseThemeIds.has(id)).map((id) => ({
  id,
  name: formatThemeName(id),
}))

export const THEMES = [...BASE_THEMES, ...CLI_THEMES]

export type Theme = (typeof THEMES)[number]

function normalizeThemeId(id: string): string {
  if (id === "default") return DEFAULT_THEME_ID
  return id
}

export function formatThemeName(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((word) => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ")
}

export function getThemeById(id: string): Theme {
  const normalized = normalizeThemeId(id)
  return THEMES.find((t) => t.id === normalized) ?? BASE_THEMES[0]
}

export function applyTheme(themeId: string) {
  const theme = getThemeById(themeId)
  document.documentElement.setAttribute("data-theme", theme.id)

  if (baseThemeIds.has(theme.id)) {
    clearTerminalTheme()
    clearUiTheme()
  } else {
    applyCliTheme(theme.id)
  }

  document.documentElement.dispatchEvent(new CustomEvent("terminal-theme-changed"))
}
