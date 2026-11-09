import { configDiagnostics, formatConfigDiagnostic, type OpenCodeClient } from "@opencode/client"

export async function requireConfig(client: OpenCodeClient, directory: string, signal?: AbortSignal) {
  const entries = await client.config.get({ location: { directory } }, { signal })
  const diagnostics = configDiagnostics(entries)
  if (diagnostics.length)
    throw new Error("Invalid configuration:\n" + diagnostics.map(formatConfigDiagnostic).join("\n"))
  return entries
}
