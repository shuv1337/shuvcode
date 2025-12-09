/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "shuv-desktop",
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
