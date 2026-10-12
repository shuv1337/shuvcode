import { domain } from "./stage"
import { EMAILOCTOPUS_API_KEY } from "./app"
import { SECRET } from "./secret"

////////////////
// GATEWAY
////////////////

const zenLiteProduct = new stripe.Product("ZenLite", {
  name: "OpenCode Go",
})
const zenLiteCouponFirstMonth50 = new stripe.Coupon("ZenLiteCouponFirstMonth50", {
  name: "First month 50% off",
  percentOff: 50,
  appliesToProducts: [zenLiteProduct.id],
  duration: "once",
})
const zenLiteCouponFirstMonth100 = new stripe.Coupon("ZenLiteCouponFirstMonth100", {
  name: "First month 100% off",
  percentOff: 100,
  appliesToProducts: [zenLiteProduct.id],
  duration: "once",
})
const zenLiteCouponThreeMonths100 = new stripe.Coupon("ZenLiteCoupon3Months100", {
  name: "3 months 100% off",
  percentOff: 100,
  appliesToProducts: [zenLiteProduct.id],
  duration: "repeating",
  durationInMonths: 3,
})
const zenLiteCouponSixMonths100 = new stripe.Coupon("ZenLiteCoupon6Months100", {
  name: "6 months 100% off",
  percentOff: 100,
  appliesToProducts: [zenLiteProduct.id],
  duration: "repeating",
  durationInMonths: 6,
})
const zenLiteCouponTwelveMonths100 = new stripe.Coupon("ZenLiteCoupon12Months100", {
  name: "12 months 100% off",
  percentOff: 100,
  appliesToProducts: [zenLiteProduct.id],
  duration: "repeating",
  durationInMonths: 12,
})
const zenLitePrice = new stripe.Price("ZenLitePrice", {
  product: zenLiteProduct.id,
  currency: "usd",
  recurring: {
    interval: "month",
    intervalCount: 1,
  },
  unitAmount: 1000,
})
const ZEN_LITE_PRICE = new sst.Linkable("ZEN_LITE_PRICE", {
  properties: {
    // Use existing Go resources in dev's checkout Stripe account.
    product: $app.stage === "dev" ? "prod_U1tUscpmwtV2bG" : zenLiteProduct.id,
    price: $app.stage === "dev" ? "price_1T3phhE7fOCwHSD4zS6w2NPy" : zenLitePrice.id,
    priceInr: 92900,
    firstMonth50Coupon: zenLiteCouponFirstMonth50.id,
    firstMonth100Coupon: zenLiteCouponFirstMonth100.id,
    threeMonths100Coupon: zenLiteCouponThreeMonths100.id,
    sixMonths100Coupon: zenLiteCouponSixMonths100.id,
    twelveMonths100Coupon: zenLiteCouponTwelveMonths100.id,
  },
})

const zenBlackProduct = new stripe.Product("ZenBlack", {
  name: "OpenCode Black",
})
const zenBlackPriceProps = {
  product: zenBlackProduct.id,
  currency: "usd",
  recurring: {
    interval: "month",
    intervalCount: 1,
  },
}
const zenBlackPrice200 = new stripe.Price("ZenBlackPrice", { ...zenBlackPriceProps, unitAmount: 20000 })
const zenBlackPrice100 = new stripe.Price("ZenBlack100Price", { ...zenBlackPriceProps, unitAmount: 10000 })
const zenBlackPrice20 = new stripe.Price("ZenBlack20Price", { ...zenBlackPriceProps, unitAmount: 2000 })
const ZEN_BLACK_PRICE = new sst.Linkable("ZEN_BLACK_PRICE", {
  properties: {
    product: zenBlackProduct.id,
    plan200: zenBlackPrice200.id,
    plan100: zenBlackPrice100.id,
    plan20: zenBlackPrice20.id,
  },
})

// Preview stages have no new Console or inference deployment to forward to.
const migrationDomain =
  $app.stage === "production" ? "opencode.ai" : $app.stage === "dev" ? "dev.opencode.ai" : undefined
const consoleMigration = new sst.Linkable("ConsoleMigration", {
  properties: {
    consoleUrl: migrationDomain ? `https://${migrationDomain}/console` : "",
    inferenceUrl: migrationDomain ? `https://${migrationDomain}/inference` : "",
  },
})

////////////////
// CONSOLE
////////////////

// Archived Zen request/response dumps (writer removed May 2026). Retained on purpose; nothing reads or writes them.
new sst.cloudflare.Bucket("ZenData")
new sst.cloudflare.Bucket("ZenDataNew")

const DISCORD_INCIDENT_WEBHOOK_URL = new sst.Secret("DISCORD_INCIDENT_WEBHOOK_URL")
const AWS_SES_ACCESS_KEY_ID = new sst.Secret("AWS_SES_ACCESS_KEY_ID")
const AWS_SES_SECRET_ACCESS_KEY = new sst.Secret("AWS_SES_SECRET_ACCESS_KEY")
const ENTERPRISE_SALES_INBOX_EMAIL = new sst.Secret("ENTERPRISE_SALES_INBOX_EMAIL")

const SALESFORCE_CLIENT_ID = new sst.Secret("SALESFORCE_CLIENT_ID")
const SALESFORCE_CLIENT_SECRET = new sst.Secret("SALESFORCE_CLIENT_SECRET")
const SALESFORCE_INSTANCE_URL = new sst.Secret("SALESFORCE_INSTANCE_URL")

const logProcessor = new sst.cloudflare.Worker("LogProcessor", {
  handler: "packages/console/function/src/log-processor.ts",
  link: [SECRET.HoneycombApiKey],
})

new sst.cloudflare.x.SolidStart("Console", {
  domain,
  path: "packages/console/app",
  link: [
    consoleMigration,
    DISCORD_INCIDENT_WEBHOOK_URL,
    SECRET.HoneycombWebhookSecret,
    EMAILOCTOPUS_API_KEY,
    AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY,
    ENTERPRISE_SALES_INBOX_EMAIL,
    SALESFORCE_CLIENT_ID,
    SALESFORCE_CLIENT_SECRET,
    SALESFORCE_INSTANCE_URL,
    new sst.Secret("CLOUDFLARE_ACCESS_CLIENT_ID"),
  ],
  environment: {
    //VITE_DOCS_URL: web.url.apply((url) => url!),
    //VITE_API_URL: gateway.url.apply((url) => url!),
    VITE_CONSOLE_MARKETING_ENABLED: $app.stage === "dev" ? "true" : "false",
  },
  transform: {
    server: {
      placement: { region: "aws:us-east-2" },
      transform: {
        worker: (args) => {
          args.compatibilityFlags = $resolve(args.compatibilityFlags).apply((flags) => [
            ...(flags ?? []),
            "global_fetch_strictly_public",
          ])
          args.tailConsumers = [{ service: logProcessor.nodes.worker.scriptName }]
        },
      },
    },
  },
})
