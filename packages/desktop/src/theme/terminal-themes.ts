import type { Component } from "solid-js"

type Variant = {
  dark: string
  light: string
}

type ColorValue = string | Variant

type CliThemeJson = {
  defs?: Record<string, string>
  theme: Record<string, ColorValue>
}

type TerminalPalette = {
  background: string
  foreground: string
  cursor: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

const terminalVars: (keyof TerminalPalette)[] = [
  "background",
  "foreground",
  "cursor",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
]

import aura from "../../../opencode/src/cli/cmd/tui/context/theme/aura.json" assert { type: "json" }
import ayu from "../../../opencode/src/cli/cmd/tui/context/theme/ayu.json" assert { type: "json" }
import catppuccin from "../../../opencode/src/cli/cmd/tui/context/theme/catppuccin.json" assert { type: "json" }
import catppuccinMacchiato from "../../../opencode/src/cli/cmd/tui/context/theme/catppuccin-macchiato.json" assert { type: "json" }
import cobalt2 from "../../../opencode/src/cli/cmd/tui/context/theme/cobalt2.json" assert { type: "json" }
import dracula from "../../../opencode/src/cli/cmd/tui/context/theme/dracula.json" assert { type: "json" }
import everforest from "../../../opencode/src/cli/cmd/tui/context/theme/everforest.json" assert { type: "json" }
import flexoki from "../../../opencode/src/cli/cmd/tui/context/theme/flexoki.json" assert { type: "json" }
import github from "../../../opencode/src/cli/cmd/tui/context/theme/github.json" assert { type: "json" }
import gruvbox from "../../../opencode/src/cli/cmd/tui/context/theme/gruvbox.json" assert { type: "json" }
import kanagawa from "../../../opencode/src/cli/cmd/tui/context/theme/kanagawa.json" assert { type: "json" }
import material from "../../../opencode/src/cli/cmd/tui/context/theme/material.json" assert { type: "json" }
import matrix from "../../../opencode/src/cli/cmd/tui/context/theme/matrix.json" assert { type: "json" }
import mercury from "../../../opencode/src/cli/cmd/tui/context/theme/mercury.json" assert { type: "json" }
import monokai from "../../../opencode/src/cli/cmd/tui/context/theme/monokai.json" assert { type: "json" }
import nightowl from "../../../opencode/src/cli/cmd/tui/context/theme/nightowl.json" assert { type: "json" }
import nord from "../../../opencode/src/cli/cmd/tui/context/theme/nord.json" assert { type: "json" }
import onedark from "../../../opencode/src/cli/cmd/tui/context/theme/one-dark.json" assert { type: "json" }
import orng from "../../../opencode/src/cli/cmd/tui/context/theme/orng.json" assert { type: "json" }
import palenight from "../../../opencode/src/cli/cmd/tui/context/theme/palenight.json" assert { type: "json" }
import rosepine from "../../../opencode/src/cli/cmd/tui/context/theme/rosepine.json" assert { type: "json" }
import solarized from "../../../opencode/src/cli/cmd/tui/context/theme/solarized.json" assert { type: "json" }
import synthwave84 from "../../../opencode/src/cli/cmd/tui/context/theme/synthwave84.json" assert { type: "json" }
import tokyonight from "../../../opencode/src/cli/cmd/tui/context/theme/tokyonight.json" assert { type: "json" }
import vercel from "../../../opencode/src/cli/cmd/tui/context/theme/vercel.json" assert { type: "json" }
import vesper from "../../../opencode/src/cli/cmd/tui/context/theme/vesper.json" assert { type: "json" }
import zenburn from "../../../opencode/src/cli/cmd/tui/context/theme/zenburn.json" assert { type: "json" }

const CLI_THEME_MAP: Record<string, CliThemeJson> = {
  aura,
  ayu,
  catppuccin,
  "catppuccin-macchiato": catppuccinMacchiato,
  cobalt2,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  "one-dark": onedark,
  orng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vercel,
  vesper,
  zenburn,
}

export const CLI_THEME_IDS = Object.keys(CLI_THEME_MAP).sort()

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "")
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized
  const num = parseInt(value, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b)
    .toString(16)
    .padStart(2, "0")}`
}

function adjust(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount])
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex([r * (1 - amount), g * (1 - amount), b * (1 - amount)])
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex([ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount])
}

function resolveColor(
  value: ColorValue | undefined,
  defs: Record<string, string>,
  theme: CliThemeJson,
  mode: "dark" | "light",
): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") {
    if (value.startsWith("#")) return value
    if (defs[value]) return resolveColor(defs[value], defs, theme, mode)
    if (theme.theme[value]) return resolveColor(theme.theme[value], defs, theme, mode)
    return value
  }
  return resolveColor(value[mode], defs, theme, mode)
}

function toHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value
  return fallback
}

function basePalette(id: string): TerminalPalette | undefined {
  const theme = CLI_THEME_MAP[id]
  if (!theme) return undefined
  const defs = theme.defs ?? {}
  const mode: "dark" | "light" = "dark"

  const background = toHex(resolveColor(theme.theme.background, defs, theme, mode), "#011627")
  const foreground = toHex(resolveColor(theme.theme.text, defs, theme, mode), "#d6deeb")
  const cursor = toHex(resolveColor(theme.theme.accent ?? theme.theme.primary, defs, theme, mode), foreground)

  const paletteBase = {
    red: toHex(resolveColor(theme.theme.error, defs, theme, mode), "#ef5350"),
    green: toHex(resolveColor(theme.theme.success, defs, theme, mode), "#c5e478"),
    yellow: toHex(resolveColor(theme.theme.warning, defs, theme, mode), "#ecc48d"),
    blue: toHex(resolveColor(theme.theme.primary, defs, theme, mode), "#82aaff"),
    magenta: toHex(resolveColor(theme.theme.accent ?? theme.theme.secondary, defs, theme, mode), "#c792ea"),
    cyan: toHex(resolveColor(theme.theme.info, defs, theme, mode), "#7fdbca"),
  }

  const isDark = luminance(background) < 0.5
  const bright = (hex: string) => (isDark ? adjust(hex, 0.25) : darken(hex, 0.25))
  const brightFromBg = isDark ? adjust(background, 0.35) : darken(background, 0.35)
  const brightFromFg = isDark ? adjust(foreground, 0.2) : darken(foreground, 0.2)

  return {
    background,
    foreground,
    cursor,
    black: background,
    red: paletteBase.red,
    green: paletteBase.green,
    yellow: paletteBase.yellow,
    blue: paletteBase.blue,
    magenta: paletteBase.magenta,
    cyan: paletteBase.cyan,
    white: foreground,
    brightBlack: brightFromBg,
    brightRed: bright(paletteBase.red),
    brightGreen: bright(paletteBase.green),
    brightYellow: bright(paletteBase.yellow),
    brightBlue: bright(paletteBase.blue),
    brightMagenta: bright(paletteBase.magenta),
    brightCyan: bright(paletteBase.cyan),
    brightWhite: brightFromFg,
  }
}

export function resolveTerminalPalette(id: string): TerminalPalette | undefined {
  return basePalette(id)
}

function applyUiTheme(palette: TerminalPalette) {
  if (typeof document === "undefined") return

  const rootStyle = document.documentElement.style
  const isDark = luminance(palette.background) < 0.5
  const bg = palette.background
  const fg = palette.foreground
  const weakBg = isDark ? adjust(bg, 0.08) : darken(bg, 0.08)
  const strongBg = isDark ? adjust(bg, 0.15) : darken(bg, 0.12)
  const strongerBg = isDark ? adjust(bg, 0.06) : darken(bg, 0.04)
  const surface = isDark ? adjust(bg, 0.1) : darken(bg, 0.1)
  const surfaceHover = isDark ? adjust(surface, 0.05) : darken(surface, 0.05)
  const surfaceActive = isDark ? adjust(surface, 0.08) : darken(surface, 0.08)
  const floatBase = isDark ? adjust(bg, 0.12) : darken(bg, 0.12)
  const textWeak = mix(fg, bg, isDark ? 0.4 : 0.35)
  const textWeaker = mix(fg, bg, isDark ? 0.5 : 0.45)
  const iconWeak = mix(fg, bg, isDark ? 0.55 : 0.5)
  const border = mix(fg, bg, isDark ? 0.75 : 0.8)
  const borderStrong = mix(fg, bg, isDark ? 0.65 : 0.7)
  const borderSelected = palette.blue

  const set = (name: string, value: string) => rootStyle.setProperty(name, value)

  set("color-scheme", isDark ? "dark" : "light")
  set("--background-base", bg)
  set("--background-weak", weakBg)
  set("--background-strong", strongBg)
  set("--background-stronger", strongerBg)
  set("--surface-base", surface)
  set("--surface-base-hover", surfaceHover)
  set("--surface-base-active", surfaceActive)
  set("--surface-raised-base", surface)
  set("--surface-raised-base-hover", surfaceHover)
  set("--surface-raised-base-active", surfaceActive)
  set("--surface-raised-stronger-non-alpha", strongBg)
  set("--surface-weak", weakBg)
  set("--surface-strong", strongBg)
  set("--surface-float-base", floatBase)
  set("--text-base", fg)
  set("--text-strong", fg)
  set("--text-weak", textWeak)
  set("--text-weaker", textWeaker)
  set("--icon-base", textWeak)
  set("--icon-weak-base", iconWeak)
  set("--icon-strong-base", fg)
  set("--border-base", border)
  set("--border-weak-base", border)
  set("--border-weak-hover", border)
  set("--border-weak-active", borderStrong)
  set("--border-strong-base", borderStrong)
  set("--border-strong-hover", borderStrong)
  set("--border-strong-active", borderStrong)
  set("--border-strong-selected", borderSelected)
  set("--border-interactive-base", borderSelected)
  set("--border-interactive-hover", borderSelected)
  set("--border-interactive-active", borderSelected)
  set("--border-interactive-selected", borderSelected)
  set("--surface-interactive-base", palette.blue)
  set("--text-interactive-base", palette.blue)
  set("--surface-brand-base", palette.blue)
  set("--button-secondary-base", surface)
}

const uiVars = [
  "color-scheme",
  "--background-base",
  "--background-weak",
  "--background-strong",
  "--background-stronger",
  "--surface-base",
  "--surface-base-hover",
  "--surface-base-active",
  "--surface-raised-base",
  "--surface-raised-base-hover",
  "--surface-raised-base-active",
  "--surface-raised-stronger-non-alpha",
  "--surface-weak",
  "--surface-strong",
  "--surface-float-base",
  "--text-base",
  "--text-strong",
  "--text-weak",
  "--text-weaker",
  "--icon-base",
  "--icon-weak-base",
  "--icon-strong-base",
  "--border-base",
  "--border-weak-base",
  "--border-weak-hover",
  "--border-weak-active",
  "--border-strong-base",
  "--border-strong-hover",
  "--border-strong-active",
  "--border-strong-selected",
  "--border-interactive-base",
  "--border-interactive-hover",
  "--border-interactive-active",
  "--border-interactive-selected",
  "--surface-interactive-base",
  "--text-interactive-base",
  "--surface-brand-base",
  "--button-secondary-base",
]

export function clearUiTheme() {
  if (typeof document === "undefined") return
  const rootStyle = document.documentElement.style
  for (const key of uiVars) {
    rootStyle.removeProperty(key)
  }
}

export function applyCliTheme(id: string) {
  if (typeof document === "undefined") return
  const palette = resolveTerminalPalette(id)
  if (!palette) {
    clearTerminalTheme()
    clearUiTheme()
    return
  }
  applyTerminalTheme(id)
  applyUiTheme(palette)
  document.documentElement.setAttribute("data-theme", id)
}

export function applyTerminalTheme(id: string) {
  if (typeof document === "undefined") return

  const palette = resolveTerminalPalette(id)
  if (!palette) {
    clearTerminalTheme()
    return
  }

  const rootStyle = document.documentElement.style
  for (const key of terminalVars) {
    rootStyle.setProperty(`--terminal-${kebab(key)}`, palette[key])
  }
}

export function clearTerminalTheme() {
  if (typeof document === "undefined") return

  const rootStyle = document.documentElement.style
  for (const key of terminalVars) {
    rootStyle.removeProperty(`--terminal-${kebab(key)}`)
  }
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}
