export type Density = "auto" | "comfortable" | "compact"

export function compactMetadata(density: Density | undefined, width: number) {
  if (density === "compact") return true
  if (density === "comfortable") return false
  return width < 70
}

export function showLogo(density: Density | undefined, width: number, height: number) {
  if (density === "compact") return false
  if (density === "comfortable") return true
  return width >= 80 && height >= 24
}