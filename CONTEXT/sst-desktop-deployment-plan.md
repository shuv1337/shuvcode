# SST Desktop Deployment Plan

## Overview

Deploy the shuvcode desktop UI to `desktop.shuv.ai` using SST with Cloudflare.

## Cloudflare Configuration

- **Domain:** shuv.ai
- **Desktop subdomain:** desktop.shuv.ai
- **Zone ID:** 89b56654a1e7378f9d90921aac8d8e91
- **Account ID:** 771240435fb4f1407f2b4669085dc79d

## API Token Permissions

Create a custom API token in Cloudflare with:

**Account-level:**

- Cloudflare Pages - Edit
- Workers Scripts - Edit
- Workers KV Storage - Edit (required for SST state)
- Workers R2 Storage - Edit (required for SST state)
- Account Settings - Read

**Zone-level (shuv.ai):**

- DNS - Edit

## Files to Modify

### 1. Create `sst.desktop.config.ts` (new file)

```typescript
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
```

### 2. Update `packages/opencode/src/server/server.ts`

Change line ~2433 from:

```typescript
: process.env.SHUVCODE_DESKTOP_URL || "https://desktop.opencode.ai"
```

To:

```typescript
: process.env.SHUVCODE_DESKTOP_URL || "https://desktop.shuv.ai"
```

### 3. Update `.github/workflows/snapshot.yml`

Add after the Publish step:

```yaml
- name: Deploy Desktop to Cloudflare
  continue-on-error: true
  run: |
    bunx sst deploy --stage production --config sst.desktop.config.ts
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_DEFAULT_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

## GitHub Secrets Required

Add these to the repository settings (Settings → Secrets and variables → Actions):

1. **CLOUDFLARE_API_TOKEN** - The API token created above
2. **CLOUDFLARE_ACCOUNT_ID** - Already configured

## Manual Deployment (Optional)

To deploy manually from local machine:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="771240435fb4f1407f2b4669085dc79d"
bunx sst deploy --stage production --config sst.desktop.config.ts
```

## Why a Separate Config?

The main `sst.config.ts` deploys additional infrastructure (API workers, console, database connections, etc.) that require secrets we don't have (Stripe, PlanetScale, GitHub App). The desktop-only config avoids those dependencies.

## Verification

After deployment:

1. Visit https://desktop.shuv.ai to verify the desktop UI loads
2. Run `shuvcode` and verify it connects to the correct desktop URL
