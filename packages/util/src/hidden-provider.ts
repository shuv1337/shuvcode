// Shuvcode keeps the upstream Claude Agent SDK on disk and does not offer it.
const hiddenProviderIDs = new Set(["claude-agent", "opencode.provider.claude-agent"])

export function isHiddenProvider(id: string) {
  return hiddenProviderIDs.has(id)
}
