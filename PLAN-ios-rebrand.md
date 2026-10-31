# PLAN: rebrand the OpenCode iOS app to shuvcode

Status: plan only. Nothing here is implemented. Correction to the first draft: there IS a native app.

## 1. What the native app is (facts, checked 2026-10-31)

| Fact | Value | Source |
|---|---|---|
| Listing | "Join the OpenCode beta", TestFlight public link | https://testflight.apple.com/join/EnFsKYQ1 (curl of public page) |
| Developer | Anomaly Innovations, Inc. | TestFlight listing (Lauren's screenshot) |
| Version / build | 0.1.0 (676) | TestFlight listing |
| What-to-test copy | "WELCOME ONE WELCOME ALL TO THE EXTRAORDINARY AMAZING OPENCODE iOS APP! … Simply run /pair on the latest version of opencode v2!" | TestFlight public page |
| Public since | Dax opened extra slots ~2026-10-09; listed in pluwen/awesome-testflight-link 2026-10-13 | gh search code "EnFsKYQ1" |

### Where the source lives: not public
- Not in `anomalyco/opencode` (any branch). Searched all upstream refs, including `ios-pwa-shell`, `mobile-*`,
  `ios-titlebar-safe-area`, `opencode/swift-nebula`, for `*.pbxproj`, `Info.plist`, `project.yml`, `*.swift`,
  `Fastfile`, `eas.json`, `app.json`, Capacitor config. None found. Those branches are PWA/mobile-web work only.
- Not in any public `anomalyco/*` repo (gh repo list anomalyco). Only `anomalyco/hex` has iOS code (`HEXMobile`, bundle `com.kitlangton.hex.mobile`), which is unrelated.
- `gh search code` for TestFlight/PRODUCT_BUNDLE_IDENTIFIER under anomalyco and in opencode: no hits for this app.
- Not in `shuv1337/*`. (`hermes-ios`, `pebble-mobileapp`, `zero-native` exist but are not this app.)
- No CI in opencode uploads to TestFlight. No `.github/workflows` references `altool`, `asc`, `fastlane`, or `xcodebuild`.
- Conclusion: the app is closed-source/private at Anomaly. Bundle ID, Apple team ID, signing, Info.plist,
  URL schemes, and the icon set are NOT inspectable by us. The bundle ID could be read from an installed build
  (for example from a device sysdiagnose or a decrypted IPA) or by asking Anomaly. I have not done that.

### What the fork does own: the contract the app speaks
The app pairs with a v2 server, so a shuvcode server must keep this wire contract:
- `packages/cli/src/commands/handlers/pair.ts`: prints `<server>/auth/connect/<code>` links plus a QR code of JSON `{"code","urls"}` (remote URLs only).
- `POST /api/pair` (`packages/client/src/promise/generated/client.ts:431`) and `server.connect({code})` → `{token}` (`packages/app/src/servers/connect/pairing.ts`).
- TUI `/pair` slash (`packages/tui/src/app.tsx:993`, alias `web`).
- The web app's QR scanner (`packages/app/src/servers/connect/scanner.tsx`, `qr-scanner`) is the PWA equivalent.

## 2. Options, since we can't edit their app

| | A. Use Anomaly's app as-is | B. Ask Anomaly for a white-label/source | C. Build our own native shuvcode app |
|---|---|---|---|
| Branding | Stays "OpenCode / Anomaly Innovations" | Theirs to grant | Fully ours |
| Bundle ID | Theirs | New one under our team (an App Store app can't be renamed into another team without an App Transfer, which Anomaly must start) | New, e.g. `dev.shuv.shuvcode` |
| Work | Keep pairing compatible | Licence + agreement | New codebase + Apple Developer account |
| Store | Their TestFlight | Ours | Ours (TestFlight first) |

App Transfer note: Apple transfers move the whole app record (bundle ID, reviews, testers) from Anomaly's team to ours.
It must be started by Anomaly's Account Holder. TestFlight-only apps with no App Store release can still be transferred only after at least one approved version. That's unlikely, and it would also take OpenCode's app away from upstream users.

## 3. Branding inventory for a shuvcode native app (option B or C)

Must change:
- Display name `CFBundleDisplayName` / `CFBundleName`: "OpenCode" → shuvcode.
- Bundle ID `PRODUCT_BUNDLE_IDENTIFIER`: new under our team. Don't reuse Anomaly's.
- Team / signing `DEVELOPMENT_TEAM`, distribution cert, provisioning profiles, App Store Connect API key in CI secrets.
- App icon set `AppIcon.appiconset` (1024 marketing plus sizes) and the launch screen.
- URL scheme / universal links: any `opencode://` scheme (desktop already uses `opencode://`, `packages/desktop/README.md:75`). Choose `shuvcode://` to avoid clashing with the OpenCode app on the same phone.
- In-app strings: About, onboarding ("run /pair on opencode v2" → `shuvcode pair`), links to opencode.ai.
- Permission strings: `NSCameraUsageDescription` (QR scan), `NSLocalNetworkUsageDescription`, `NSBonjourServices` if used.
- App Store Connect record: name, subtitle, description, privacy policy URL, support URL, category, screenshots.
- TestFlight copy: beta description, what-to-test, feedback email, public link.
- Copyright / seller: "Anomaly Innovations, Inc." → Lauren's entity or individual.

Nice to have:
- Theme/accent colours, haptics, widget/extension names if any.
- Usage analytics/crash reporting destinations (theirs → ours or off).

Sync-sensitive (server side, in this repo):
- Pairing contract above. Don't fork it, or Anomaly's app and ours both break.
- `opencode pair` vs `shuvcode pair`: keep both binaries printing the same payload.

## 4. Phases
0. Decide A/B/C (questions below). Nothing else starts until then.
1. If A: document in README/AGENTS.md that Anomaly's TestFlight app works with `shuvcode pair --remote`. Add a contract test on `pairingLink`/`/api/pair` so sync can't silently break it. No branding changes are possible.
2. If B/C: set up Apple Developer team, reserve bundle ID and scheme, create App Store Connect record. Lauren has to do this herself (paid account, 2FA, legal entity).
3. Codebase: obtain source (B) or scaffold (C). The lowest-effort C is a WKWebView/Capacitor shell around `packages/app`, with native QR scan. It reuses the fork's existing branding overlay.
4. Brand: apply the inventory in §3, with assets from Lauren.
5. CI: GitHub Actions macOS job → `xcodebuild archive` → upload via App Store Connect API key, internal TestFlight on push to a release branch. Secrets are stored in the repo, not on the box.
6. External TestFlight (needs Beta App Review), then optional App Store release.

## 5. PWA path still exists
`shuvcode pair --remote` + Safari "Add to Home Screen" uses `packages/app`. Rebranding it (manifest name, title,
`apple-mobile-web-app-title`, icons via `packages/app/vite.icons.ts`, pairing strings in `en.ts`) is a small,
fork-owned change from the first draft. It's a cheap interim step, and it's the base for a C-style shell.

## 6. Risks
- Can't touch Anomaly's binary. Anything branded "shuvcode" in the App Store is a new app under a new team.
- Trademark/confusion: shipping "OpenCode"-derived artwork or copy under our team could draw App Review "4.1 copycat" rejections. Use original artwork.
- Pairing drift: upstream may change `/api/pair` or the QR payload alongside their app. Watch for it in sync PRs.
- Two apps on one phone, both claiming `opencode://`. Use a distinct scheme.
- Signing secrets and Apple account are sensitive. They need Lauren's own account and approval.

## 7. Open questions for Lauren
1. Is "rebrand" option A (just use Anomaly's app with shuvcode), B (ask Anomaly), or C (our own native app)?
2. Apple Developer account: personal or a company? Team ID? Who's the Account Holder?
3. Bundle ID and URL scheme preference (e.g. `dev.shuv.shuvcode`, `shuvcode://`)?
4. Do you have access to Anomaly's app source, or a relationship with Dax/Anomaly to ask for it?
5. App Transfer from Anomaly: wanted at all? (Probably not, since it removes their app.)
6. Artwork and the exact name casing (`shuvcode`)?
7. Native (Swift) or a WebView shell around `packages/app`?
8. Do the PWA rebrand now as an interim step?

## 8. Source hunt for v2-compatible iOS clients (2026-10-31)

Option A is confirmed working (Anomaly TestFlight + `shuvcode pair --remote`). The official app's source is still not public.

Ryan Vogel = GitHub `R44VC0RP` ("work @ opencode", company @anomalyco). None of his public repos is the TestFlight app:
- `R44VC0RP/openpad`: iPad viewer, TS/Expo, last commit 2025-12-18, no licence, v1 only.
- `R44VC0RP/OpenCode-Island`: macOS notch app, `com.opencode.island`, Apache-2.0, 2025-12-29.
- `R44VC0RP/hark`: iPhone notifications/approvals (Expo + `harkctl`); routes OpenCode V2 permissions, not a client. Licence NOASSERTION.

| Repo | Licence | Last commit | Kind | v2 `/pair` (QR `{code,urls}` / `/auth/connect`) | Bundle ID | Fork viability |
|---|---|---|---|---|---|---|
| armanruzgar/opencode-ios | GPL-3.0-only | 2026-10-31 | Native Swift 6, 454 files, iOS 26.4+, opencode 2.0.25+ | Yes: VisionKit QR, link paste, `GET /auth/connect/<code>` (ARCHITECTURE.md:141-144), v2 2.0.32 fixtures | `$(BUNDLE_ID_PREFIX).client`, prefix `dev.opencodeios` (Config/Signing.xcconfig) | Best feature fit; prefix is one setting. GPL means a fork must stay GPL with source published. 0 stars, solo dev. |
| grapeot/opencode_ios_client | MIT | 2026-10-18 | Native Swift, 188 files, + watch app | No: v1 API; docs/v2_server_compatibility.md says v2 "waiting for parity" | `com.grapeot.OpenCodeClient` | Most mature/popular (275★, 55 forks, own TestFlight 2cWrmPVq), MIT-friendly, but needs a v2 port first. |
| sambitcreate/aiden-for-opencode-ios | MIT | 2026-10-08 | Native SwiftUI, 55 files | Partly: v2 API, but its own pairing payload (`kind`/`endpoint`), not upstream QR | (not set in pbxproj) | Clean MIT v2 base; needs upstream pairing added. |
| ShawnDiego/opencode-ios | none | 2026-10-06 | Native Swift, xcodegen | v2 API; host/port/password only | `ai.opencode.ios.client` | No licence, so we can't legally fork. |
| gogo564/opencode-ios-client | none | 2026-10-30 | Native Swift, 8 files | v2 API, minimal | `com.gogo564.OpenCodeClient` | Too small; no licence. |
| kkcode-app/kkcode | AGPL-3.0 | 2026-08-08 | TS (web/RN) | v2-ish API | — | AGPL, not native. |

Dead ends: jackwener/opencode-ios (Apache-2.0, v1, Feb 2026), PhillipChaffee/opencode-ios (MIT, v1), goniz/opencode-ios
(no Swift), Justintunsday/opencode-ios and repos1tory/opencode-ios (jailbreak ports of the CLI/server, not clients),
synthentica/opencode-fledly (unrelated plugin), the upstream `ios-*`/`mobile-*` branches (PWA only), and anomalyco public repos.

Recommendation, if we go beyond option A: fork armanruzgar/opencode-ios if GPL is acceptable (it already speaks upstream
`/pair`); otherwise fork sambitcreate/aiden (MIT, v2) and add `{code,urls}` + `/auth/connect` pairing. grapeot is the
fallback with most community, but it needs the v2 port.
