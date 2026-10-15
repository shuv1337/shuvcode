import { shortDomain } from "./stage"

// Retains existing share data until it is deleted separately.
new sst.cloudflare.Bucket("EnterpriseStorage")

new sst.cloudflare.Worker("Share", {
  domain: shortDomain,
  handler: "packages/function/src/share.ts",
})
