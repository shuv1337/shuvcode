export type FontDefinition = {
  id: string
  name: string
  family: string
  googleFontsUrl: string // Empty string for fonts already loaded
  fallback: string
}

export const FONTS: FontDefinition[] = [
  {
    id: "geist",
    name: "Geist",
    family: "Geist",
    googleFontsUrl: "", // Already bundled in UI package
    fallback: '"Geist Fallback", sans-serif',
  },
  {
    id: "inter",
    name: "Inter",
    family: "Inter",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap",
    fallback: "sans-serif",
  },
  {
    id: "nunito",
    name: "Nunito",
    family: "Nunito",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;700&display=swap",
    fallback: "sans-serif",
  },
  {
    id: "roboto-condensed",
    name: "Roboto Condensed",
    family: "Roboto Condensed",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;700&display=swap",
    fallback: "sans-serif",
  },
  {
    id: "oswald",
    name: "Oswald",
    family: "Oswald",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;700&display=swap",
    fallback: "sans-serif",
  },
  {
    id: "forum",
    name: "Forum",
    family: "Forum",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Forum&display=swap",
    fallback: "serif",
  },
  {
    id: "rubik",
    name: "Rubik",
    family: "Rubik",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&display=swap",
    fallback: "sans-serif",
  },
  {
    id: "meslo",
    name: "Meslo",
    family: "meslo",
    googleFontsUrl: "", // Already loaded via jsDelivr in index.html
    fallback: '"Menlo", "Monaco", "Courier New", monospace',
  },
  {
    id: "ubuntu-mono",
    name: "Ubuntu Mono",
    family: "Ubuntu Mono",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Ubuntu+Mono:wght@400;700&display=swap",
    fallback: "monospace",
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    family: "JetBrains Mono",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap",
    fallback: "monospace",
  },
  {
    id: "inconsolata",
    name: "Inconsolata",
    family: "Inconsolata",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;500;700&display=swap",
    fallback: "monospace",
  },
]

export const DEFAULT_FONT_ID = "meslo"

export function getFontById(id: string): FontDefinition | undefined {
  return FONTS.find((f) => f.id === id)
}
