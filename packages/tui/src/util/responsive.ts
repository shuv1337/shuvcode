import { Locale } from "./locale"

export function homePromptMaxWidth(width: number, configured: number | "auto" | undefined) {
  const available = Math.max(1, width - 4)
  if (configured === "auto") return Math.min(available, Math.max(40, Math.floor(width * 0.7)))
  return Math.min(available, configured ?? 75)
}

export function showHomeLogo(width: number, height: number) {
  return width >= 80 && height >= 24
}

export function homeFooterLayout(width: number, versionWidth: number, mcpWidth: number) {
  const compact = width < 70
  return {
    directoryWidth: Math.max(2, width - 8 - versionWidth - (compact ? 0 : mcpWidth)),
    gap: compact ? 1 : 2,
    showMcp: !compact,
  }
}

export function promptMetadata(width: number, model: string) {
  const compact = width < 70
  return {
    compact,
    model: compact ? Locale.truncate(model, Math.max(8, width - 28)) : model,
  }
}
