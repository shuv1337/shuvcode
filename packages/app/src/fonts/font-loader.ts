import type { FontDefinition } from "./font-definitions"

const loadedFonts = new Set<string>()
const loadingFonts = new Map<string, Promise<void>>()

export async function loadFont(font: FontDefinition): Promise<void> {
  // Skip if already loaded or if it's a bundled font (no Google Fonts URL)
  if (loadedFonts.has(font.id) || !font.googleFontsUrl) {
    return
  }

  // Return existing promise if already loading
  const existingPromise = loadingFonts.get(font.id)
  if (existingPromise) {
    return existingPromise
  }

  const loadPromise = new Promise<void>((resolve, reject) => {
    // Check if link already exists in the document
    const existingLink = document.querySelector(`link[data-font-id="${font.id}"]`)
    if (existingLink) {
      loadedFonts.add(font.id)
      resolve()
      return
    }

    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = font.googleFontsUrl
    link.setAttribute("data-font-id", font.id)

    link.onload = () => {
      loadedFonts.add(font.id)
      loadingFonts.delete(font.id)
      resolve()
    }

    link.onerror = () => {
      loadingFonts.delete(font.id)
      reject(new Error(`Failed to load font: ${font.name}`))
    }

    document.head.appendChild(link)
  })

  loadingFonts.set(font.id, loadPromise)
  return loadPromise
}

export function isFontLoaded(fontId: string): boolean {
  return loadedFonts.has(fontId)
}
