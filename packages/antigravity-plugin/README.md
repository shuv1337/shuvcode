# Google (Solstice) provider plugin

Included and enabled by default in every Shuvcode Bun and Node install. No
separate package installation or `plugins` config entry is required.

Public Effect plugin for Google (Solstice) per-user-quota Gemini inference,
brokered through Nous Portal. Exports `GoogleSolsticePlugin` (also default) and
`createPlugin(options?)`, with plugin ID `shuvcode.provider.google-solstice`,
auth-only prerequisite integration `nous` (OAuth method `nous-device`), and
Google subscription method `google-solstice` on integration `google`.

Core's default provider registry supplies `@opencode/plugin`'s public Context.
Bun and Node builds bundle the real implementation; the non-CLI workerd host
uses a stub for its Node-only loopback callback surface. There are no Core
imports, SDK transport wrappers, or proxy servers.

- **Two-step sign-in**:
  1. Sign in to `Nous Portal` (`nous` / `nous-device`) via RFC 8628 device
     authorization. `nous` is auth-only and is never registered as a provider in
     model pickers.
  2. Connect `Google (Solstice)` (`google` / `google-solstice`), which discovers
     the brokered OAuth client from Nous Portal, uses PKCE S256 + constant-time
     `state` on an ephemeral `127.0.0.1:0` callback (`/gemini-auth/callback`)
     with pasted redirect fallback for SSH/remote sessions, and exchanges the
     code through Nous Portal.
- **Native Gemini wire**: Rewrites `generativelanguage.googleapis.com`
  `generateContent` / `streamGenerateContent` URLs to
  `https://generativelanguage.googleapis.com/v1alpha/models/<model>:<method>PerUserQuota`,
  swaps `x-goog-api-key` for `Authorization: Bearer <access>`, preserves the
  request body bytes untouched, and sets `chunkTimeout: 1_200_000` (20 minutes).
  Native Gemini SSE and error payloads flow directly to `@opencode/ai`.
- **Shipped models**: Enables `gemini-3.1-pro-preview`, `gemini-4-argon` (with
  64k streaming output floor), `gemini-3.8-flash`, and `gemini-3.5-flash-lite`
  at zero cost. Other catalog models are zero-costed and disabled so explicit
  `opencode.json` model overrides can enable future Gemini slugs cleanly.
- **Dead-grant isolation**: Only explicit `invalid_grant` or
  `unauthorized_client` errors from Solstice refresh mark the Google grant dead
  (fingerprinted by SHA-256 prefix in plugin storage, never storing raw tokens).
  Nous Portal 401s mark `nous` `needs_auth` without marking Google dead; 5xx,
  edge challenges (`x-vercel-mitigated`), and non-JSON proxy errors stay
  transient.
- **Legacy upgrade**: Retired `google-ai-pro` (Antigravity) credentials are
  flagged `needs_auth` with migration guidance and fail closed on inference.
  API-key and env-var Google connections remain untouched.

## Verification

From this directory: `bun test` and `bun run typecheck`.

Real host/editor coverage lives in
`packages/core/test/plugin/provider-antigravity.test.ts` and
`packages/core/test/session-antigravity-error.test.ts`; run those tests from
`packages/core`. All tests use fixture credentials and injected or loopback
HTTP, never a real model or provider endpoint.
