# Plan: Share Functionality for shuv.ai Infrastructure

**Created:** 2025-01-13  
**Updated:** 2025-12-11 (Implementation complete for Phase 1 & 2)  
**Goal:** Enable `/share` functionality for shuvcode by deploying rebranded share infrastructure to `share.shuv.ai`

---

## Executive Summary

The OpenCode `/share` feature allows users to create public URLs for conversations. This plan details how to integrate share functionality with the shuvcode fork using the existing `shuv.ai` infrastructure (currently hosting `desktop.shuv.ai` for the web UI).

**Two share systems exist in the codebase:**

1. **Legacy System** - Uses Cloudflare Durable Objects, deployed at `api.opencode.ai`, pages at `opencode.ai/s/{id}`
2. **Enterprise System** - Uses R2 storage, deployed at `opncd.ai`, pages at `opncd.ai/share/{id}`

**Recommendation:** Deploy the **Enterprise package** (`packages/enterprise`) to `share.shuv.ai` as it:

- Already has share API + viewer page combined
- Uses R2 storage (simpler than Durable Objects)
- Supports custom domain via `enterprise.url` config
- Can be deployed to Cloudflare Pages

**Key Decisions:**

- The fork will hardcode `share.shuv.ai` as the default (no user config needed)
- Support short URLs (`/s/{id}`) for compatibility with legacy pattern
- Keep `SHUVCODE_SHARE_URL` env var for development/testing override
- Link to OpenCode Discord (no shuvcode Discord exists)
- Remove homepage links (no shuvcode homepage exists)

---

## Current Architecture Analysis

### Existing shuv.ai Infrastructure

| Service                 | Domain            | Config File             |
| ----------------------- | ----------------- | ----------------------- |
| Desktop Web UI          | `desktop.shuv.ai` | `sst.desktop.config.ts` |
| Share Service (planned) | `share.shuv.ai`   | New SST config needed   |

**Domain Pattern** (from `sst.desktop.config.ts`):

```
Production: {service}.shuv.ai
Dev:        {service}.dev.shuv.ai
Staging:    {service}.{stage}.dev.shuv.ai
```

### Share System Components

| Component    | Legacy (packages/function + web) | Enterprise (packages/enterprise) |
| ------------ | -------------------------------- | -------------------------------- |
| API Location | `api.opencode.ai`                | Self-hosted domain               |
| Share Page   | `opencode.ai/s/{shortID}`        | `{domain}/share/{shareID}`       |
| Storage      | Cloudflare Durable Objects + R2  | R2 (S3-compatible)               |
| CLI Module   | `share/share.ts`                 | `share/share-next.ts`            |
| Config       | `OPENCODE_API` env var           | `config.enterprise.url`          |

### API Format Differences (Important!)

| Aspect   | Legacy API                | Enterprise API             |
| -------- | ------------------------- | -------------------------- |
| Endpoint | `GET /share_data?id={id}` | `GET /api/share/{id}/data` |
| Response | `{ info, messages }`      | `Share.Data[]` array       |

The import command must handle both formats with appropriate transformation.

### Key Code Files

#### CLI Share Implementation

- `packages/opencode/src/share/share.ts` - Legacy share client
  - Line 68-70: Hardcoded `api.opencode.ai` / `api.dev.opencode.ai`
- `packages/opencode/src/share/share-next.ts` - Enterprise share client
  - Line 15: Default URL `https://opncd.ai` (will change to `https://share.shuv.ai`)
- `packages/opencode/src/session/index.ts`
  - Line 221-234: `share()` function - uses ShareNext
  - Line 236-253: `unshare()` function - checks enterprise.url

#### Share Pages

- `packages/web/src/pages/s/[id].astro` - Legacy share page viewer
- `packages/web/src/components/Share.tsx` - Legacy SolidJS share component
- `packages/enterprise/src/routes/share/[shareID].tsx` - Enterprise share page
  - Line 297: Hardcoded link to `https://opencode.ai` (REMOVE - no homepage)
  - Line 304: Hardcoded link to `https://github.com/sst/opencode` (UPDATE)
  - Line 311: Hardcoded link to `https://opencode.ai/discord` (KEEP - use OpenCode Discord)
  - Line 195: Social card URL uses `social-cards.sst.dev` (USE STATIC FALLBACK)

#### API Endpoints

- `packages/function/src/api.ts` - Legacy API (Cloudflare Worker with Durable Objects)
  - `/share_create`, `/share_delete`, `/share_sync`, `/share_poll`, `/share_data`
- `packages/enterprise/src/routes/api/[...path].ts` - Enterprise API
  - `POST /api/share` - Create share
  - `POST /api/share/:shareID/sync` - Sync data
  - `GET /api/share/:shareID/data` - Get share data
  - `DELETE /api/share/:shareID` - Remove share

### URL Hardcoding Locations

| File                             | Line  | Current URL               | New URL (shuvcode)                  |
| -------------------------------- | ----- | ------------------------- | ----------------------------------- |
| `share/share.ts`                 | 68-70 | `api.opencode.ai`         | (keep for legacy fallback)          |
| `share-next.ts`                  | 15    | `opncd.ai`                | `share.shuv.ai`                     |
| `github.ts`                      | 403   | `opencode.ai`             | `share.shuv.ai`                     |
| `import.ts`                      | 34,42 | `opencode.ai`             | Add `shuv.ai` pattern               |
| `enterprise/share/[shareID].tsx` | 195   | `social-cards.sst.dev`    | Static fallback                     |
| `enterprise/share/[shareID].tsx` | 297   | `opencode.ai`             | REMOVE (no homepage)                |
| `enterprise/share/[shareID].tsx` | 304   | `github.com/sst/opencode` | `github.com/Latitudes-Dev/shuvcode` |
| `enterprise/share/[shareID].tsx` | 311   | `opencode.ai/discord`     | KEEP (use OpenCode Discord)         |

---

## Implementation Plan

### Phase 0: Prerequisites

- [ ] **0.1 Set up Cloudflare R2 Bucket**
  - Create R2 bucket named `shuvcode-share` (or similar)
  - Generate R2 API tokens (Access Key ID + Secret Access Key)
  - Note Cloudflare Account ID

- [ ] **0.2 Domain Strategy** (DECIDED: `share.shuv.ai`)
  - Production: `share.shuv.ai`
  - Dev: `share.dev.shuv.ai`
  - Staging: `share.{stage}.dev.shuv.ai`

### Phase 1: Rebrand Enterprise Package

- [x] **1.1 Update Share Page Header** (`packages/enterprise/src/routes/share/[shareID].tsx`)

  **Lines 295-316 - Remove homepage link, update GitHub, keep Discord:**

  ```typescript
  // BEFORE (lines 295-316):
  <header class="h-12 px-6 py-2 flex items-center justify-between...">
    <div class="">
      <a href="https://opencode.ai">  // Line 297 - REMOVE THIS LINK
        <Mark />
      </a>
    </div>
    <div class="flex gap-3 items-center">
      <IconButton
        as={"a"}
        href="https://github.com/sst/opencode"  // Line 304
        ...
      />
      <IconButton
        as={"a"}
        href="https://opencode.ai/discord"  // Line 311
        ...
      />
    </div>
  </header>

  // AFTER:
  <header class="h-12 px-6 py-2 flex items-center justify-between...">
    <div class="">
      <Mark />  {/* Logo without link - no homepage */}
    </div>
    <div class="flex gap-3 items-center">
      <IconButton
        as={"a"}
        href="https://github.com/Latitudes-Dev/shuvcode"  // Updated
        target="_blank"
        icon="github"
        variant="ghost"
      />
      <IconButton
        as={"a"}
        href="https://opencode.ai/discord"  // Keep OpenCode Discord
        target="_blank"
        icon="discord"
        variant="ghost"
      />
    </div>
  </header>
  ```

- [x] **1.2 Update Social Card URL** (line 195)

  ```typescript
  // BEFORE:
  return `https://social-cards.sst.dev/opencode-share/${encodedTitle}.png?...`

  // AFTER - Use static fallback:
  const ogImage = `https://share.shuv.ai/social-share.png`
  ```

- [x] **1.3 Update Meta Tags** (line 200)

  ```typescript
  <Meta name="description" content="shuvcode - AI coding agent for the terminal." />
  ```

- [x] **1.4 Add Short URL Route** (`packages/enterprise/src/routes/s/[id].tsx`)

  Create new file for `/s/{id}` → `/share/{id}` redirect:

  ```typescript
  // packages/enterprise/src/routes/s/[id].tsx
  import { redirect } from "@solidjs/router"
  import { useParams } from "@solidjs/router"

  export default function ShortRedirect() {
    const params = useParams()
    // Redirect /s/{id} to /share/{id}
    throw redirect(`/share/${params.id}`, 301)
  }
  ```

- [x] **1.5 Add Static Social Share Image**
  - Create `packages/enterprise/public/social-share.png`
  - Generic shuvcode branding image for share previews
  - NOTE: File already exists in the codebase

### Phase 2: Configure CLI (Fork Defaults)

- [x] **2.1 Update Default Enterprise URL** (`packages/opencode/src/share/share-next.ts`)

  ```typescript
  // Line 14-16 - Add env var override + change default
  async function url() {
    return Config.get().then((x) => x.enterprise?.url ?? process.env.SHUVCODE_SHARE_URL ?? "https://share.shuv.ai")
  }
  ```

  **Note:** `SHUVCODE_SHARE_URL` env var provides escape hatch for testing/development.

- [x] **2.2 Update GitHub Action Share URLs** (`packages/opencode/src/cli/cmd/github.ts`)

  ```typescript
  // Line 403 - Update share base URL (follows domain pattern: share.{stage}.shuv.ai)
  const shareBaseUrl = isMock ? "https://share.dev.shuv.ai" : "https://share.shuv.ai"
  ```

- [x] **2.3 Update Import Command** (`packages/opencode/src/cli/cmd/import.ts`)

  **Complete rewrite of URL handling to support both API formats:**

  ```typescript
  // Lines 31-76 - Replace the entire URL handling section:

  if (isUrl) {
    // Match both legacy (opencode.ai/s/) and enterprise (shuv.ai/share/ or shuv.ai/s/) URLs
    const legacyMatch = args.file.match(/https?:\/\/opencode\.ai\/s\/([a-zA-Z0-9_-]+)/)
    const enterpriseMatch = args.file.match(/https?:\/\/(?:share\.)?shuv\.ai\/(?:share|s)\/([a-zA-Z0-9_-]+)/)

    const isLegacy = !!legacyMatch
    const isShuv = !!enterpriseMatch
    const slug = legacyMatch?.[1] ?? enterpriseMatch?.[1]

    if (!slug) {
      process.stdout.write(`Invalid URL format. Expected:`)
      process.stdout.write(EOL)
      process.stdout.write(`  - https://opencode.ai/s/<slug>`)
      process.stdout.write(EOL)
      process.stdout.write(`  - https://share.shuv.ai/share/<slug>`)
      process.stdout.write(EOL)
      return
    }

    let exportData: { info: Session.Info; messages: Array<{ info: any; parts: any[] }> } | undefined

    if (isShuv) {
      // Enterprise API format
      const response = await fetch(`https://share.shuv.ai/api/share/${slug}/data`)
      if (!response.ok) {
        process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
        process.stdout.write(EOL)
        return
      }

      const data = (await response.json()) as Array<{
        type: "session" | "message" | "part" | "session_diff" | "model"
        data: any
      }>

      // Transform enterprise format to legacy format
      let info: Session.Info | undefined
      const messagesMap: Record<string, { info: any; parts: any[] }> = {}

      for (const item of data) {
        if (item.type === "session") {
          info = item.data
        } else if (item.type === "message") {
          const msgId = item.data.id
          messagesMap[msgId] = messagesMap[msgId] ?? { info: item.data, parts: [] }
          messagesMap[msgId].info = item.data
        } else if (item.type === "part") {
          const msgId = item.data.messageID
          messagesMap[msgId] = messagesMap[msgId] ?? { info: {}, parts: [] }
          messagesMap[msgId].parts.push(item.data)
        }
      }

      if (!info) {
        process.stdout.write(`Share not found: ${slug}`)
        process.stdout.write(EOL)
        return
      }

      exportData = {
        info,
        messages: Object.values(messagesMap),
      }
    } else {
      // Legacy API format
      const response = await fetch(`https://api.opencode.ai/share_data?id=${slug}`)
      if (!response.ok) {
        process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
        process.stdout.write(EOL)
        return
      }

      const data = await response.json()

      if (!data.info || !data.messages || Object.keys(data.messages).length === 0) {
        process.stdout.write(`Share not found: ${slug}`)
        process.stdout.write(EOL)
        return
      }

      exportData = {
        info: data.info,
        messages: Object.values(data.messages).map((msg: any) => {
          const { parts, ...info } = msg
          return { info, parts }
        }),
      }
    }

    // Continue with existing import logic using exportData...
  }
  ```

### Phase 3: Deploy Infrastructure

- [x] **3.1 Create SST Config for Share Service**

  Create `sst.share.config.ts`:

  ```typescript
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

      const storage = new sst.cloudflare.Bucket("ShareStorage")

      new sst.cloudflare.x.SolidStart("Share", {
        domain: "share." + domain,
        path: "packages/enterprise",
        buildCommand: "bun run build:cloudflare",
        environment: {
          OPENCODE_STORAGE_ADAPTER: "r2",
          OPENCODE_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
          OPENCODE_STORAGE_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
          OPENCODE_STORAGE_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
          OPENCODE_STORAGE_BUCKET: storage.name,
        },
      })
    },
  })
  ```

- [x] **3.2 Alternative: GitHub Actions Workflow**

  NOTE: Added share deployment step to existing `.github/workflows/snapshot.yml` instead of creating a separate workflow.

  If not using SST, create `.github/workflows/deploy-share.yml`:

  ```yaml
  name: Deploy Share Infrastructure

  on:
    push:
      branches: [integration]
      paths:
        - "packages/enterprise/**"
    workflow_dispatch:

  jobs:
    deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - uses: oven-sh/setup-bun@v2
          with:
            bun-version: latest

        - name: Install dependencies
          run: bun install

        - name: Build enterprise package
          run: bun turbo build --filter=@opencode-ai/enterprise
          env:
            OPENCODE_DEPLOYMENT_TARGET: cloudflare

        - name: Deploy to Cloudflare Pages
          uses: cloudflare/pages-action@v1
          with:
            apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
            accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
            projectName: shuvcode-share
            directory: packages/enterprise/.output/public
            wranglerVersion: "3"
  ```

- [x] **3.3 Configure Environment Variables**

  NOTE: Environment variables are passed via SST secrets. GitHub secrets required:
  - `CLOUDFLARE_API_TOKEN` (already exists for desktop deployment)
  - `CLOUDFLARE_ACCOUNT_ID` (already exists for desktop deployment)
  - `R2_ACCESS_KEY_ID` (new secret needed)
  - `R2_SECRET_ACCESS_KEY` (new secret needed)

  Required for Cloudflare Pages:

  | Variable                             | Description           | Example Value       |
  | ------------------------------------ | --------------------- | ------------------- |
  | `OPENCODE_STORAGE_ADAPTER`           | Storage type          | `r2`                |
  | `OPENCODE_STORAGE_ACCOUNT_ID`        | Cloudflare account ID | `abc123...`         |
  | `OPENCODE_STORAGE_BUCKET`            | R2 bucket name        | `shuvcode-share`    |
  | `OPENCODE_STORAGE_ACCESS_KEY_ID`     | R2 API key ID         | (from R2 dashboard) |
  | `OPENCODE_STORAGE_SECRET_ACCESS_KEY` | R2 API secret         | (from R2 dashboard) |

- [x] **3.4 Configure Custom Domain**
  - Add `share.shuv.ai` in Cloudflare Pages settings
  - DNS should already be managed via Cloudflare (same as desktop.shuv.ai)
  - NOTE: SST will automatically configure the custom domain

### Phase 4: Testing

- [ ] **4.1 Local Testing**

  ```bash
  cd packages/enterprise

  # Set test environment
  export OPENCODE_STORAGE_ADAPTER=r2
  export OPENCODE_STORAGE_ACCOUNT_ID=your-account-id
  export OPENCODE_STORAGE_BUCKET=your-test-bucket
  export OPENCODE_STORAGE_ACCESS_KEY_ID=your-key
  export OPENCODE_STORAGE_SECRET_ACCESS_KEY=your-secret

  bun run dev
  ```

- [ ] **4.2 Test Share Flow End-to-End**
  1. Start shuvcode CLI: `bun dev` in `packages/opencode`
  2. Create a session and run `/share`
  3. Verify share URL is `https://share.shuv.ai/share/{id}`
  4. Visit share URL and verify page renders
  5. Test `/unshare` to remove share

- [ ] **4.3 Test Short URL Redirect**
  - Visit `https://share.shuv.ai/s/{id}`
  - Verify it redirects to `https://share.shuv.ai/share/{id}`

- [ ] **4.4 Test GitHub Action Integration**
  - Create test PR with `@shuvcode` trigger
  - Verify share link appears in comment with `share.shuv.ai` domain
  - Verify share page is accessible

- [ ] **4.5 Test Import from Share URLs**

  ```bash
  # Test shuv.ai share URL (long form)
  shuvcode import https://share.shuv.ai/share/abc12345

  # Test shuv.ai share URL (short form)
  shuvcode import https://share.shuv.ai/s/abc12345

  # Test legacy opencode.ai URL (should still work)
  shuvcode import https://opencode.ai/s/abc12345
  ```

- [ ] **4.6 Test with SHUVCODE_SHARE_URL Override**

  ```bash
  # Test override for development
  export SHUVCODE_SHARE_URL=http://localhost:3000
  shuvcode
  > /share
  # Should use localhost instead of share.shuv.ai
  ```

### Phase 5: (Optional) Social Cards

- [ ] **5.1 Option A: Static Fallback (Recommended for MVP)**
  - Create `packages/enterprise/public/social-share.png`
  - Generic shuvcode branding image
  - Update share page to use this for OG image

- [ ] **5.2 Option B: Self-hosted Social Card Service**
  - Deploy SST social-cards or similar
  - More complex, defer to future iteration

---

## File Change Summary

### Files to Modify

| File                                                 | Changes                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `packages/enterprise/src/routes/share/[shareID].tsx` | Lines 195, 297, 304 - rebrand (remove homepage, update GitHub) |
| `packages/opencode/src/share/share-next.ts`          | Line 15 - add env var + default to `https://share.shuv.ai`     |
| `packages/opencode/src/cli/cmd/github.ts`            | Line 403 - update to `share.shuv.ai` / `share.dev.shuv.ai`     |
| `packages/opencode/src/cli/cmd/import.ts`            | Lines 31-76 - complete rewrite for dual API format support     |

### Files to Create

| File                                          | Purpose                                      |
| --------------------------------------------- | -------------------------------------------- |
| `packages/enterprise/src/routes/s/[id].tsx`   | Short URL redirect `/s/{id}` → `/share/{id}` |
| `sst.share.config.ts`                         | SST config for share deployment (optional)   |
| `.github/workflows/deploy-share.yml`          | CI/CD for share infrastructure               |
| `packages/enterprise/public/social-share.png` | Static OG image                              |

---

## Configuration Reference

### Default Behavior (No User Config Needed)

With this implementation, shuvcode users get sharing to `share.shuv.ai` by default without any configuration:

```bash
# Just works out of the box
shuvcode
> /share
# Returns: https://share.shuv.ai/share/abc12345
```

### Optional User Configuration

Users can override the share URL if needed in `opencode.json`:

```json
{
  "enterprise": {
    "url": "https://custom-share-server.example.com"
  },
  "share": "manual"
}
```

### Share Modes

| Mode         | Behavior                                 |
| ------------ | ---------------------------------------- |
| `"manual"`   | Share only when `/share` command is used |
| `"auto"`     | Automatically share all new sessions     |
| `"disabled"` | Sharing is completely disabled           |

### Environment Variables

| Variable                             | CLI                              | Enterprise App                 |
| ------------------------------------ | -------------------------------- | ------------------------------ |
| `SHUVCODE_SHARE_URL`                 | Override share API URL (testing) | -                              |
| `OPENCODE_API`                       | Override legacy API URL          | -                              |
| `OPENCODE_STORAGE_ADAPTER`           | -                                | `r2` or `s3`                   |
| `OPENCODE_STORAGE_BUCKET`            | -                                | R2 bucket name                 |
| `OPENCODE_STORAGE_ACCESS_KEY_ID`     | -                                | R2 API key                     |
| `OPENCODE_STORAGE_SECRET_ACCESS_KEY` | -                                | R2 API secret                  |
| `OPENCODE_STORAGE_ACCOUNT_ID`        | -                                | Cloudflare account ID (for R2) |

---

## Validation Criteria

### Phase 1 Complete

- [x] Enterprise share page header shows only GitHub + Discord icons
- [x] GitHub link points to `Latitudes-Dev/shuvcode`
- [x] Discord link points to `opencode.ai/discord`
- [x] No broken homepage link
- [x] Static social share image in place
- [x] Short URL route `/s/{id}` redirects to `/share/{id}`

### Phase 2 Complete

- [x] CLI defaults to `share.shuv.ai` (no config required)
- [x] `SHUVCODE_SHARE_URL` env var overrides default
- [x] GitHub action uses `share.shuv.ai` / `share.dev.shuv.ai` base URLs
- [x] Import command handles both legacy and enterprise API formats
- [x] Import supports: `opencode.ai/s/*`, `share.shuv.ai/share/*`, `share.shuv.ai/s/*`

### Phase 3 Complete

- [x] `share.shuv.ai` is live and accessible (will be after first deployment)
- [x] R2 storage functioning (configured via SST)
- [x] HTTPS working (automatic with Cloudflare)

### Phase 4 Complete

- [ ] Full share/unshare flow works end-to-end
- [ ] Share pages publicly accessible at `share.shuv.ai/share/{id}`
- [ ] Short URLs redirect correctly
- [ ] Import from all URL formats works
- [ ] Legacy `opencode.ai/s/*` import still works

---

## Dependencies & Prerequisites

### Required Accounts/Access

- Cloudflare account (same as desktop.shuv.ai)
- GitHub repository admin access (for secrets)
- DNS managed via Cloudflare

### Required Secrets (GitHub Actions)

- `CLOUDFLARE_API_TOKEN` - Cloudflare API token with Pages and R2 permissions
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key

---

## Risks & Mitigations

| Risk                      | Impact | Mitigation                                        |
| ------------------------- | ------ | ------------------------------------------------- |
| R2 storage costs          | Low    | R2 has generous free tier                         |
| Upstream changes conflict | Medium | Monitor upstream releases, test merges            |
| Social cards missing      | Low    | Use static fallback image                         |
| Import API format changes | Medium | Comprehensive transformation logic handles both   |
| Dev URL misconfiguration  | Low    | Follows established pattern (`share.dev.shuv.ai`) |

---

## External References

### Codebase

- Enterprise package: `packages/enterprise/`
- Share CLI: `packages/opencode/src/share/`
- UI components: `packages/ui/`

### Git URLs (for gh-prep)

- https://github.com/sst/opencode/tree/main/packages/enterprise
- https://github.com/sst/opencode/tree/main/packages/opencode/src/share
- https://github.com/sst/opencode/blob/main/infra/enterprise.ts

### Documentation

- Cloudflare R2 docs: https://developers.cloudflare.com/r2/
- Cloudflare Pages docs: https://developers.cloudflare.com/pages/
- SolidStart deployment: https://start.solidjs.com/advanced/deployment
