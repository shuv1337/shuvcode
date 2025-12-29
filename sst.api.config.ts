/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "shuv-api",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
        cloudflare: "6.12.0",
      },
    }
  },
  async run() {
    const domain = (() => {
      if ($app.stage === "production") return "shuv.ai"
      if ($app.stage === "dev") return "dev.shuv.ai"
      return `${$app.stage}.dev.shuv.ai`
    })()

    const GITHUB_APP_ID = new sst.Secret("GITHUB_APP_ID")
    const GITHUB_APP_PRIVATE_KEY = new sst.Secret("GITHUB_APP_PRIVATE_KEY")
    const ADMIN_SECRET = new sst.Secret("ADMIN_SECRET")
    const bucket = new sst.cloudflare.Bucket("Bucket")

    new sst.cloudflare.Worker("Api", {
      domain: `api.${domain}`,
      handler: "packages/function/src/api.ts",
      environment: {
        WEB_DOMAIN: domain,
      },
      url: true,
      link: [bucket, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ADMIN_SECRET],
      transform: {
        worker: (args) => {
          args.logpush = true
          args.bindings = $resolve(args.bindings).apply((bindings) => [
            ...bindings,
            {
              name: "SYNC_SERVER",
              type: "durable_object_namespace",
              className: "SyncServer",
            },
          ])
          // For fresh deployment, use newSqliteClasses with v1 tag
          // After first successful deployment, change to oldTag: "v1", newTag: "v1"
          args.migrations = {
            newTag: "v1",
            newSqliteClasses: ["SyncServer"],
          }
        },
      },
    })
  },
})
