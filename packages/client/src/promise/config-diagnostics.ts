import type { ConfigDiagnostic, ConfigEntry } from "./generated/types.js"

export function configDiagnostics(entries: readonly ConfigEntry[]) {
  return entries.flatMap((entry) => (entry.type === "document" ? (entry.experimental?.diagnostics ?? []) : []))
}

export function formatConfigDiagnostic(diagnostic: ConfigDiagnostic) {
  const position = diagnostic.line === undefined ? "" : `:${diagnostic.line}:${diagnostic.column ?? 1}`
  return `${diagnostic.source}${position} (${diagnostic.path}): ${diagnostic.message}`
}
