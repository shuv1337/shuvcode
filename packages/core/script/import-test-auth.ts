import { parseArgs } from "node:util"
import { isAbsolute } from "node:path"
import { Schema } from "effect"
import { CredentialImport } from "../src/credential/import.js"

// No source discovery, service startup, plugin acquisition, or refresh capability.
async function main() {
  const args = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      source: { type: "string" },
      target: { type: "string" },
      "window-end": { type: "string" },
      "legacy-accounts": { type: "string" },
      mapping: { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean" },
    },
  }).values
  if (args.help) {
    console.log(
      "bun run script/import-test-auth.ts --source /absolute/checkpointed.db --target /absolute/new-private-root --window-end 2026-09-15T16:00:00-07:00 [--dry-run] [--mapping /absolute/mapping.json] [--legacy-accounts /absolute/antigravity-accounts.json]",
    )
    return
  }
  if (!args.source || !args.target || !args["window-end"] || !/(Z|[+-]\d{2}:\d{2})$/.test(args["window-end"]))
    throw new CredentialImport.ImportError()
  if (args.mapping && !isAbsolute(args.mapping)) throw new CredentialImport.ImportError()
  const mapping = args.mapping
    ? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(await Bun.file(args.mapping).text())
    : undefined
  // The importer validates this complete unknown boundary before acquiring its private graph.
  const options = {
    source: args.source,
    target: args.target,
    windowEnd: Date.parse(args["window-end"]),
    legacyAccounts: args["legacy-accounts"],
    dryRun: args["dry-run"],
    mapping,
  }
  console.log(JSON.stringify(await CredentialImport.run(options)))
}

await main().catch(() => {
  console.error(new CredentialImport.ImportError().message)
  process.exitCode = 1
})
