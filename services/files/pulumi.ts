import { R2Bucket, WorkersScript, WorkersRoute, getZoneOutput } from "@pulumi/cloudflare"
import { getStack } from "@pulumi/pulumi"
import { readFileSync } from "node:fs"

const stage = getStack()
const protect = stage === "production"
const domain = stage === "production" ? "opencode.ai" : stage === "dev" ? "dev.opencode.ai" : `${stage}.dev.opencode.ai`
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required")
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN is required")

const zone = getZoneOutput({ filter: { account: { id: accountId }, name: "opencode.ai" } })

const bucket = new R2Bucket(
  "files",
  {
    accountId,
    name: `opencode-${stage}-files`,
    jurisdiction: "default",
    storageClass: "Standard",
  },
  { protect },
)

const worker = new WorkersScript(
  "files",
  {
    accountId,
    scriptName: `opencode-${stage}-files`,
    compatibilityDate: "2026-08-01",
    mainModule: "worker.js",
    content: readFileSync(new URL("./dist/worker.js", import.meta.url), "utf8"),
    bindings: [{ name: "FILES", type: "r2_bucket", bucketName: bucket.name }],
  },
  { protect },
)

new WorkersRoute(
  "files",
  {
    zoneId: zone.zoneId,
    pattern: `${domain}/files/*`,
    script: worker.scriptName,
  },
  { protect },
)

export const bucketName = bucket.name
export const url = `https://${domain}/files/`
