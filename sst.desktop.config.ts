/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "shuvcode-desktop",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
    }
  },
  async run() {
    const domain = (() => {
      if ($app.stage === "production") return "shuv.ai"
      if ($app.stage === "dev") return "dev.shuv.ai"
      return `${$app.stage}.dev.shuv.ai`
    })()

    const zoneID = "89b56654a1e7378f9d90921aac8d8e91"

    new cloudflare.RegionalHostname("RegionalHostname", {
      hostname: "desktop." + domain,
      regionKey: "us",
      zoneId: zoneID,
    })

    new sst.cloudflare.StaticSite("Desktop", {
      domain: "desktop." + domain,
      path: "packages/desktop",
      build: {
        command: "bun turbo build",
        output: "./dist",
      },
    })
  },
})
