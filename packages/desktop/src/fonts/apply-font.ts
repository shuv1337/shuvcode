import { FONTS, getFontById, type FontDefinition } from "@/fonts/font-definitions"
import { loadFont } from "@/fonts/font-loader"

function applyFontDefinition(font: FontDefinition): void {
  const fontFamily = `"${font.family}", ${font.fallback}`
  document.documentElement.style.setProperty("--font-family-sans", fontFamily)
}

export function applyFont(fontId: string): void {
  const font = getFontById(fontId) ?? FONTS[0]
  applyFontDefinition(font)
}

export async function ensureFontLoaded(font: FontDefinition): Promise<boolean> {
  if (!font.googleFontsUrl) return true
  try {
    await loadFont(font)
    return true
  } catch {
    return false
  }
}

export async function applyFontWithLoad(font: FontDefinition): Promise<void> {
  const loaded = await ensureFontLoaded(font)
  if (loaded) {
    applyFontDefinition(font)
  } else {
    applyFontDefinition(FONTS[0])
  }
}
