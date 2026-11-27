import { isHiddenProvider } from "@opencode/util/hidden-provider"

export { isHiddenProvider }

// One order for every list that ranks providers: the Popular sections in Settings and the connect dialog, and
// the model pickers.
export const popularProviders = [
  "opencode-go",
  "opencode",
  "openai",
  "anthropic",
  "github-copilot",
  "google",
  "openrouter",
  "vercel",
]

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
