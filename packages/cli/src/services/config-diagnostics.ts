import { configDiagnostics, formatConfigDiagnostic, type OpenCodeClient } from "@opencode/client"

export async function requireConfig(
  client: OpenCodeClient,
  directory: string,
  signal?: AbortSignal,
  fail: "never" | "any" | "file" = "never",
) {
  const entries = await client.config.get({ location: { directory } }, { signal })
  const diagnostics = configDiagnostics(entries)
  if (diagnostics.length)
    process.stderr.write("Invalid configuration:\n" + diagnostics.map(formatConfigDiagnostic).join("\n") + "\n")
  const invalid = diagnostics.some((diagnostic) => fail === "any" || (fail === "file" && diagnostic.path === "$"))
  if (invalid) process.exitCode = 1
  return !invalid
}
