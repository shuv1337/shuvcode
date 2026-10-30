import { isHiddenProvider } from "@opencode/util/hidden-provider"

export { isHiddenProvider }

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

// App catalogs that call these helpers omit the upstream Claude Agent id.
// Other list surfaces call isHiddenProvider themselves.
export function withoutHiddenProviders<T extends { id: string }>(items: readonly T[]) {
  return items.filter((item) => !isHiddenProvider(item.id))
}

export function omitHiddenProviderCatalog<T>(catalog: {
  all: Map<string, T>
  connected: readonly string[]
  default: Record<string, string>
}) {
  const all = new Map([...catalog.all].filter(([id]) => !isHiddenProvider(id)))
  const connected = catalog.connected.filter((id) => !isHiddenProvider(id))

  return {
    all,
    connected,
    default: Object.fromEntries(Object.entries(catalog.default).filter(([id]) => !isHiddenProvider(id))),
  }
}
