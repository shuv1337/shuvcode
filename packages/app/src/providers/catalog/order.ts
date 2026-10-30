export const popularProviders = [
  "opencode-go",
  "opencode",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]

// Connect dialog group order. Matches the TUI priority list.
export const connectPopular = ["opencode", "opencode-go", "openai", "github-copilot", "anthropic", "google"]

// Upstream Claude Agent stays out of every Shuvcode catalog, even when an
// older server still returns the integration.
const hiddenProviderIDs = new Set(["claude-agent"])

export function isHiddenProvider(id: string) {
  return hiddenProviderIDs.has(id)
}

export function withoutHiddenProviders<T extends { id: string }>(items: readonly T[]) {
  return items.filter((item) => !isHiddenProvider(item.id))
}

export function omitHiddenProviderCatalog<T>(catalog: {
  all: Map<string, T>
  connected: readonly string[]
  default: Record<string, string>
}) {
  if (![...catalog.all.keys()].some(isHiddenProvider) && catalog.connected.every((id) => !isHiddenProvider(id))) {
    return catalog
  }

  const all = new Map([...catalog.all].filter(([id]) => !isHiddenProvider(id)))

  return {
    all,
    connected: catalog.connected.filter((id) => !isHiddenProvider(id)),
    default: Object.fromEntries(Object.entries(catalog.default).filter(([id]) => !isHiddenProvider(id))),
  }
}
