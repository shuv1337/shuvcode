/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "shuv-share",
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

    const SECRET = {
      R2AccessKey: new sst.Secret("R2AccessKey"),
      R2SecretKey: new sst.Secret("R2SecretKey"),
    }

    const storage = new sst.cloudflare.Bucket("ShareStorage")

    new sst.cloudflare.x.SolidStart("Share", {
      domain: "share." + domain,
      path: "packages/enterprise",
      buildCommand: "bun run build:cloudflare",
      environment: {
        OPENCODE_STORAGE_ADAPTER: "r2",
        OPENCODE_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
        OPENCODE_STORAGE_ACCESS_KEY_ID: SECRET.R2AccessKey.value,
        OPENCODE_STORAGE_SECRET_ACCESS_KEY: SECRET.R2SecretKey.value,
        OPENCODE_STORAGE_BUCKET: storage.name,
      },
    })
  },
})
