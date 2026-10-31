# Plan: rebrand the iOS app to shuvcode

Status: plan only. Nothing here is implemented yet.

## What "the iOS app" is

Neither this fork nor upstream `anomalyco/opencode` has a native iOS app. A
search of `integration-v2`, `upstream/dev`, `upstream/v2`, `origin/dev`, and
`origin/shuvdev` finds no `*.pbxproj`, `Info.plist`, `*.entitlements` for iOS,
Expo/EAS/Capacitor config, or Swift sources. Upstream closed its React Native
PR (#10624) unmerged. Its mobile answer (issue #10288) is the installable web
app (PWA) served by `pair --remote`.

On iOS, the app is therefore `packages/app` added to the Home Screen from
Safari. Every iOS-visible brand surface lives in that web app and in the icon
sets it borrows from `packages/desktop/icons/<channel>/ios`.

That means none of the following exist to change: a bundle ID, an App Store
listing, signing, entitlements, a URL scheme, associated domains, or an iOS CI
workflow. If Lauren means a native App Store app, that is new work. See the
open questions.

## Inventory

### Must change (shown on iOS)

| Surface | Path | Current |
| --- | --- | --- |
| Home Screen name (PWA) | `packages/app/manifest.json` `name`, `short_name` | `OpenCode` |
| Home Screen title fallback (iOS reads `<title>` when no `apple-mobile-web-app-title` exists) | `packages/app/index.html` | `<title data-sm>OpenCode</title>`, no `apple-mobile-web-app-title` |
| Runtime title | `packages/app/src/app.tsx:60` | `<Title>OpenCode</Title>` |
| Session title | `packages/app/src/session/route.tsx:251` | `` `${value} · OpenCode` `` |
| Home Screen icon (180px) | `packages/app/vite.icons.ts` → `packages/desktop/icons/<channel>/ios/AppIcon-60x60@3x.png` | OpenCode artwork |
| Manifest icons 192/512 | `vite.icons.ts` → `desktop/icons/<channel>/android/...ic_launcher.png`, `icon.png` | OpenCode artwork |
| Favicon | `vite.icons.ts` → `desktop/icons/<channel>/icon.ico` | OpenCode artwork |
| Connect-screen brand mark | `packages/app/src/servers/connect/screen.tsx:117` | `aria-label="OpenCode"` plus logo |
| Pairing errors | `packages/app/src/runtime/i18n/en.ts:431,437` | "not an OpenCode pairing code", "older version of OpenCode" |
| About page | `packages/app/src/settings/about/about.tsx:149`; `settings.about.website` in every locale | `https://opencode.ai`, `www.opencode.ai` |
| Social share image | `index.html` `og:image`/`twitter:image` → `/social-share.png` | OpenCode image |

The pairing hint strings already say `shuvcode pair` (`en.ts:419-433`,
`screen.tsx:249`). Follow that pattern.

### Nice to have

- The remaining "OpenCode" strings in `en.ts` (36 total) and the other locales.
  Most are product prose, such as the desktop menu `desktop.menu.app`.
- External links to `opencode.ai`: `desktop-feedback` (`shell/errors/error.tsx:416`,
  `home/projects/controller.tsx:171`, `titlebar.tsx:767`), docs
  (`desktop-menu.ts:275`, `appearance.tsx:116`, `project-extensions.tsx:382`),
  and `GO_URL` (`usage-exceeded-dialogs.tsx:19`). Decide per link whether to
  keep upstream docs or point at a shuvcode page.
- `theme_color`/`background_color` `#080808` in the manifest, if shuvcode
  wants its own palette.
- `apple-mobile-web-app-status-bar-style`, and a dedicated iOS launch image
  (none exists today).

### Leave alone (sync-sensitive or not user-visible)

- Package names `@opencode/app`, `@opencode/ui`, and so on, the placeholder
  tokens `%OPENCODE_FAVICON%`, `oc-theme-preload.js`, and the
  `opencode-app:icons` plugin name. They are internal, and renaming them would
  conflict on every sync.
- `packages/ui/src/theme/themes/oc-2.json` `"name": "OpenCode"`: a theme name,
  not the product.
- `packages/desktop/icons/{dev,beta}` content: the desktop app is still
  branded OpenCode (`electron-builder.config.ts:221,239,258`). Desktop
  branding was out of scope in `PLAN-fresh-v2-rewrite.md`.
- `packages/console/**` and `packages/web/**` (opencode.ai's own site and
  docs). The fork doesn't ship them.

## Fork pattern to mirror

The fork brands by overlay, not by rename. The CLI package and bin are
`shuvcode` (`packages/cli/package.json`), XDG uses `app = "shuvcode"`, the
TUI logo is a separate `packages/tui/src/shuv-logo.ts`, the default theme is
`nightowl`, and the app's pairing copy says `shuvcode pair`. Desktop has no
shuvcode branding yet, and there is no Android or other mobile target.

## Approach

Keep the diff small and isolated, so that sync conflicts land in files the fork
already owns:

1. Add `packages/app/brand.ts`, exporting `productName = "shuvcode"`, the
   website URL, and an icon root.
2. Add fork-owned icons under `packages/app/icons/shuvcode/` (ios 180, 192,
   512, ico, maskable). Point `vite.icons.ts` at that directory. Don't
   overwrite `packages/desktop/icons/**`, which upstream regenerates.
3. Have `vite.icons.ts` (already a transform step) override `name` and
   `short_name` in the emitted `site.webmanifest`, and replace `<title>` plus a
   new `apple-mobile-web-app-title` in `transformIndexHtml`. The upstream
   `manifest.json` and `index.html` then barely change.
4. Use `brand.productName` in `app.tsx`, `session/route.tsx`, and the
   connect-screen aria-label.
5. Strings: edit `en.ts` for the user-visible lines. For the other locales,
   either replace mechanically "OpenCode"→"shuvcode" in brand-only keys, or
   let them fall back. A one-file sed script under `script/` keeps this
   repeatable after each sync.
6. Tests: one test asserting the built `site.webmanifest` and `index.html`
   carry `shuvcode`, and that no emitted iOS icon equals the upstream bytes.
   Add a hygiene grep that fails on `OpenCode` in a list of brand-only keys.

## Phases

1. **Decide.** Lauren answers the open questions, especially whether this is
   only the PWA or a native app, and provides icon artwork.
2. **PWA identity.** Make steps 1–4 and the icons, then verify by building the
   app, serving it with `shuvcode pair --remote`, and doing Add to Home Screen on
   an iPhone. Check the name, icon, title, splash colour, and connect screen.
3. **Strings and links.** Make step 5 and settle the link decisions.
4. **Guardrails.** Add the step 6 tests and hygiene, plus a line in
   `AGENTS.md` (Shuvcode Fork) and the sync plans: "iOS/PWA brand overlay
   lives in `packages/app/brand.ts` + `packages/app/icons/shuvcode`."
5. **Optional, separate:** desktop branding, or a native iOS app.

## Risks

- **Sync friction:** `index.html`, `manifest.json`, `app.tsx`, and `en.ts`
  change upstream often. The overlay keeps the fork's edits to one-line
  imports. Expect locale conflicts if every locale is edited by hand.
- **Home Screen caching:** iOS caches the Home Screen name and icon when the
  app is added. Existing users must remove and re-add the shortcut. The
  manifest `id: "/"` stays, so storage and pairing survive.
- **Shared icons:** `vite.icons.ts` reads desktop icons. Changing those in
  place would rebrand desktop as a side effect and fight upstream icon
  updates.
- **Native app (if wanted):** this needs an Apple Developer team, a new bundle
  ID such as `dev.shuv.shuvcode`, and a new App Store record. There is no
  existing opencode App Store app to take over. It also needs signing secrets
  in CI, App Review, and a client codebase (fork a community client or build
  one). That is a separate project, not a rebrand.

## Open questions for Lauren

1. Is the target the PWA from `shuvcode pair --remote` (today's iOS
   experience), or a native App Store or TestFlight app?
2. Icon artwork: is there a shuvcode mark? The TUI has only ASCII
   (`shuv-logo.ts`).
3. Display name casing: `shuvcode`, `Shuvcode`, or `ShuvCode`? The CLI uses
   `shuvcode`, and the TUI Discord copy and AGENTS use "Shuvcode".
4. Should About, docs, and feedback links stay on opencode.ai or move to
   shuv.dev / GitHub?
5. Should desktop branding come along in the same pass? It shares icon
   plumbing.
6. If native: which Apple team ID and bundle ID? Fork an existing community
   client (for example `grapeot/opencode_ios_client`, which needs a licence
   check), or build new?
