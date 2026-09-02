# Research: In-tree Google AI Pro / Antigravity for V2

**Date:** 2026-08-14 (PDT)
**Status:** Ready to implement. Research only in this file.
**Decision:** In-tree `/connect` method. Google models only. Primary: Gemini 3.7 Flash. No Claude, no GPT-OSS.

## Verdict

Ship this the same way Claude Pro/Max is shipped: an in-tree provider plugin that adds an OAuth method to `/connect`, stores the refresh token in Integration, and rewrites native Gemini HTTP into Cloud Code `v1internal`.

Do **not** port ZeroGravity (LS MITM). Do **not** impersonate the Electron IDE. Do **not** expose Claude or GPT-OSS even though Cloud Code serves them.

Live MITM of official `agy` 1.1.13 on this host (2026-08-14 PDT) is the wire source of truth. Community V1 plugins and ZeroGravity were useful for protocol hints and then wrong on host, User-Agent, and headers.

## Decisions locked

| Decision        | Choice                                                                                                         | Why                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Where it lives  | In-tree `packages/core/src/plugin/provider/google-antigravity.ts` (+ helpers), registered in `ProviderPlugins` | User wants it on `/connect` by default, same as Claude Pro/Max                                                                    |
| Integration id  | `google`                                                                                                       | `/connect` already ranks Google. Add a method, do not invent a second provider row unless API-key Gemini must stay fully separate |
| Method id       | `google-ai-pro`                                                                                                | Label: `Google AI Pro / Antigravity`                                                                                              |
| Models          | Google Gemini only                                                                                             | Claude/GPT share a separate quota group; third-party models are what got similar projects banned                                  |
| Primary model   | `gemini-3.7-flash-high`                                                                                        | Official `defaultAgentModelId` today. Variants low/medium/high                                                                    |
| Client identity | Official **CLI**, not Electron webview                                                                         | That is what `agy` actually sends                                                                                                 |
| Endpoint        | `https://daily-cloudcode-pa.googleapis.com`                                                                    | Live `agy` host. Not `*.sandbox.googleapis.com`                                                                                   |
| Accounts        | One. No rotator                                                                                                | Rotation is the abuse pattern                                                                                                     |
| Token source    | Import official `agy`/IDE first, OAuth `/connect` second                                                       | Tokens minted by random third-party clients have a worse reputation                                                               |

## Live capture (2026-08-14)

`agy` honors `HTTPS_PROXY` + `SSL_CERT_FILE`. One Flash session through mitmproxy produced this outbound set:

| Host                                | Paths                                                                                                                                                                                                         | Plugin should                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `daily-cloudcode-pa.googleapis.com` | `loadCodeAssist`, `fetchUserInfo`, `retrieveUserQuotaSummary`, `fetchAdminControls`, `fetchAvailableModels`, `setUserSettings`, `listExperiments`, `streamGenerateContent?alt=sse`, `recordCodeAssistMetrics` | Call the first five at connect / catalog refresh. Generate via `streamGenerateContent`. Skip Unleash, Play log, auto-updater, avatar |
| `www.googleapis.com`                | `GET /oauth2/v2/userinfo`                                                                                                                                                                                     | Optional label after OAuth                                                                                                           |
| `antigravity-unleash.goog`          | feature flags                                                                                                                                                                                                 | Ignore                                                                                                                               |
| `play.googleapis.com`               | `/log`                                                                                                                                                                                                        | Ignore                                                                                                                               |

`agy models` and `fetchAvailableModels` agree: default agent model is `gemini-3.7-flash-high`.

`loadCodeAssist` on this account returned `paidTier.id = g1-pro-tier`, name `Google AI Pro`, and `cloudaicompanionProject = canvas-wallaby-dvmxc`. Quota is split:

- **Gemini Models** — `gemini-weekly` + `gemini-5h`
- **Claude and GPT models** — `3p-weekly` + `3p-5h`

That split is the product reason to never offer Claude/GPT. They are a different bucket and the thing people farmed.

## Wire format from official CLI

### Headers (generate)

Only these request headers appeared on `streamGenerateContent`:

```
User-Agent: antigravity/cli/1.1.13 (aidev_client; os_type=linux; arch=amd64; cl=964361259; auth_method=consumer)
Authorization: Bearer ya29.…
Content-Type: application/json
Accept-Encoding: gzip
```

No `Client-Metadata`. No `X-Goog-Api-Client`. No `x-machine-id`. No Electron UA. Community plugins that send those are impersonating a different client than the one we are cloning.

Use a CLI UA of that shape. Pin `1.1.13` / `cl=964361259` until we decide to track `agy --version`. `auth_method=consumer` matches Google AI Pro.

### Envelope

```json
{
  "project": "canvas-wallaby-dvmxc",
  "requestId": "agent/{session}/{epochMs}/{trajectory}/2",
  "model": "gemini-3.7-flash-low",
  "userAgent": "antigravity",
  "requestType": "agent",
  "request": {
    "contents": [{ "role": "user", "parts": [{ "text": "<USER_REQUEST>\n…\n</USER_REQUEST>" }] }],
    "systemInstruction": { "role": "user", "parts": [{ "text": "…" }] },
    "tools": [{ "functionDeclarations": [{ "name": "…" }] }],
    "toolConfig": { "functionCallingConfig": { "mode": "VALIDATED" } },
    "labels": {
      "last_step_index": "1",
      "model_enum": "MODEL_PLACEHOLDER_M300",
      "request_id": "{trajectory}-0",
      "trajectory_id": "{uuid}",
      "used_claude": "false",
      "used_claude_conservative": "false",
      "used_non_gemini_model": "false"
    },
    "generationConfig": {
      "maxOutputTokens": 65536,
      "thinkingConfig": { "includeThoughts": true, "thinkingBudget": 1000 }
    },
    "sessionId": "-3750763034362895579"
  }
}
```

Notes from the capture:

- `model` is the **catalog id**, e.g. `gemini-3.7-flash-low`, not the Vertex dated name. `labels.model_enum` is the placeholder (`MODEL_PLACEHOLDER_M300` for 3.7 Flash Low).
- `systemInstruction` is an object with `role` + `parts`, not a bare string. Official CLI used `role: "user"` on that object.
- `requestType` is `"agent"` for chat and `"checkpoint"` for the title-gen side call (`gemini-3.1-flash-lite`). We should not emit checkpoint/title calls.
- `toolConfig.mode` is `VALIDATED`.
- Thought signatures are **siblings** of `functionCall` or empty `text` on the last SSE event.
- SSE `Content-Type: text/event-stream`. Each event: `{ response, traceId, metadata }`. Unwrap `response` for the native Gemini parser.
- `used_claude` / `used_non_gemini_model` are explicit `"false"` strings. Keep them false. Never send true.

Title-gen side request used `gemini-3.1-flash-lite` with `thinkingBudget: 0`. Ignore that path.

### Connect-time RPCs

`POST /v1internal:loadCodeAssist` body:

```json
{ "metadata": { "ideType": "ANTIGRAVITY" } }
```

Returns `cloudaicompanionProject`, `paidTier`, `currentTier`. Store the project id in `credential.metadata.projectId`.

`POST /v1internal:fetchAvailableModels` body `{ "project": "…" }` is the catalog. Filter `modelProvider === "MODEL_PROVIDER_GOOGLE"` and skip `isInternal` / tab / image-only ids unless we later want them.

`POST /v1internal:retrieveUserQuotaSummary` is optional UX (remaining Gemini weekly / 5h). Do not call Claude/GPT buckets for anything except display, and do not display them if we are not offering those models.

### Auth

Same Antigravity OAuth client the official binaries embed:

- Authorize: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- Scopes: `cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs`
- `access_type=offline`, `prompt=consent`, PKCE S256
- Access `ya29.` ~3600s. Refresh `1//…`. Google does **not** rotate this refresh token. Still single-flight via `Integration.connection.resolve` (`packages/core/src/integration.ts`).

Preferred obtain order on this machine:

1. Official Antigravity / `agy` state (`state.vscdb` keys `antigravityUnifiedStateSync.oauthToken`, `antigravityAuthStatus`).
2. Existing V1 file `~/.local/share/opencode/antigravity-accounts.json` (already has `refreshToken` + `projectId`).
3. Browser `/connect` with `mode: "auto"` localhost callback.

Do not mint tokens with a different client id.

## Google catalog to ship

From live `fetchAvailableModels`. Ship recommended Gemini agent models. Primary first.

| Catalog id                                 | Display                   | Variants / notes                                                        |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------- |
| `gemini-3.8-flash-high`                    | Gemini 3.8 Flash (High)   | No `modelEnum` captured. Live generate succeeds                         |
| `gemini-3.8-flash-medium`                  | Gemini 3.8 Flash (Medium) | No `modelEnum` captured                                                 |
| `gemini-3.8-flash-low`                     | Gemini 3.8 Flash (Low)    | No `modelEnum` captured                                                 |
| `gemini-3.8-flash`                         | —                         | **Not shipped.** Live generate returns `Requested entity was not found` |
| `gemini-3.7-flash-high`                    | Gemini 3.7 Flash (High)   | **Default.** `MODEL_PLACEHOLDER_M298`. Official `defaultAgentModelId`   |
| `gemini-3.7-flash-medium`                  | Gemini 3.7 Flash (Medium) | `M299`                                                                  |
| `gemini-3.7-flash-low`                     | Gemini 3.7 Flash (Low)    | `M300`. Live generate used this when flags ate the prompt               |
| `gemini-3.6-flash-{high,medium,low}`       | Gemini 3.6 Flash          | Bonus                                                                   |
| `gemini-3-flash-agent`                     | Gemini 3.5 Flash (High)   | Bonus                                                                   |
| `gemini-3.5-flash-low`                     | Gemini 3.5 Flash (Medium) | Bonus                                                                   |
| `gemini-3.1-pro-high` / `gemini-pro-agent` | Gemini 3.1 Pro (High)     | Bonus. Deprecated alias `gemini-3.1-pro-high` → `gemini-pro-agent`      |
| `gemini-3.1-pro-low`                       | Gemini 3.1 Pro (Low)      | Bonus                                                                   |

Do **not** ship: `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`, internal `chat_*`, tab models, image models (until asked).

Context 1_048_576 / output 65_536 for Flash. `cost: []` while on subscription.

Thinking: official low used `thinkingBudget: 1000` + `includeThoughts: true`. Map V2 variants `low|medium|high` onto the three 3.7 ids rather than inventing a fourth budget if the catalog already splits them.

## V2 surfaces

Copy `packages/core/src/plugin/provider/anthropic.ts` + `openai.ts`.

1. `ctx.integration.transform` → `method.update` OAuth `google-ai-pro` on integration `google`. `draft.method.update` creates the integration if needed (`packages/core/src/integration.ts` L292–303). `/connect` lists whatever methods exist. TUI already prioritizes `google`.
2. `authorize` `mode: "auto"` (localhost callback, like ChatGPT). After exchange: `loadCodeAssist`, store `{ projectId, email, paidTier }` in `credential.metadata`.
3. `refresh` against `oauth2.googleapis.com/token`. Keep the same refresh if Google omits a new one.
4. `ctx.catalog.transform` when that OAuth connection is active:
   - Keep provider `google` or overlay a sibling `google-antigravity` if we must not hide API-key Gemini. Prefer **overlay**: subscription models enabled, `package` stays `@opencode-ai/ai/providers/google` / `aisdk:@ai-sdk/google`, `cost: []`, default model `gemini-3.7-flash-high`. API-key Gemini can remain as the key method on the same integration.
   - If overlaying `google` fights models.dev ids, register provider `google-antigravity` with `integrationID: google` and only the Cloud Code Gemini models.
5. `ctx.session.hook("http.request")` when the active credential is `google-ai-pro`:
   - Resolve token via `ctx.integration.connection.resolve` (5‑minute refresh window, single-flight).
   - Rewrite URL to `https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`.
   - Delete `x-goog-api-key`. Set `Authorization: Bearer`. Native Google puts OAuth access into `apiKey` → `x-goog-api-key` (`packages/core/src/model-resolver.ts` L288–301).
   - Set the CLI `User-Agent`.
   - Wrap the Gemini JSON body in the envelope. Clean tool JSON Schema (`const`→`enum`, strip `$ref`/`$defs`/`$schema`/`default`).
   - Force `used_claude=false`, `used_non_gemini_model=false`.
6. `ctx.session.hook("http.response")`: `TransformStream` unwrap `event.response` so the native Gemini SSE parser sees candidates/usage/thought parts.
7. `ctx.event.subscribe()` / in-tree `Bus` on `integration.connection.updated` → `catalog.reload()`.
8. Optional loopback proxy only if we need request-time token refresh the way Anthropic does. HTTP hooks plus `connection.resolve` at hook time may be enough because we already re-resolve per request.

HTTP hooks run for every LLM request (`packages/core/src/session/model-request.ts` L245–274). `aisdk.hook("sdk")` does **not** run for `@ai-sdk/google` (native-mapped in `aisdk-native.ts`).

### In-tree file plan

```
packages/core/src/plugin/provider/google-antigravity.ts        # plugin: oauth + catalog + hooks
packages/core/src/plugin/provider/google-antigravity-oauth.ts  # pkce, exchange, refresh, loadCodeAssist
packages/core/src/plugin/provider/google-antigravity-wire.ts   # envelope, schema clean, UA, unwrap
packages/core/test/plugin/provider-google-antigravity.test.ts
```

Register in `packages/core/src/plugin/provider.ts` `ProviderPlugins`.

No `packages/ai` Cloud Code protocol in v1 of this work unless hooks get too ugly. A dedicated `@opencode-ai/ai/providers/google-antigravity` is a later cleanup.

## What we are explicitly not doing

- ZeroGravity LS spawn, iptables, BoringSSL, warmup RPCs.
- Electron `Mozilla/5.0 … Antigravity/1.107.0 Chrome/… Electron/…` UA.
- `Client-Metadata` / `X-Goog-Api-Client` / fabricated `x-machine-id`.
- `daily-cloudcode-pa.sandbox.googleapis.com` unless live `agy` moves there.
- Claude, GPT-OSS, multi-account rotation, Gemini CLI quota fallback.
- External npm plugin as the product. Local plugin is fine for a spike; `/connect` default means in-tree.

## Implementation checklist

1. OAuth method on `google`, label `Google AI Pro / Antigravity`, `mode: "auto"`.
2. Import path from `agy` / `state.vscdb` / V1 accounts so this host can skip the browser the first time.
3. `loadCodeAssist` → persist `projectId`. Refuse to generate without it.
4. `fetchAvailableModels` → enable Google recommended models only. Default `gemini-3.7-flash-high`.
5. Request hook: Bearer, CLI UA, envelope, schema clean, `used_claude=false`.
6. Response hook: unwrap SSE `response`.
7. Prove `shuvcode` `/connect` shows the method and a 3.7 Flash prompt completes. Dev db is `opencode-local.db`; installed is `opencode.db`.
8. Tests: envelope wrap/unwrap, header rewrite, Google-only catalog filter, refresh single-flight. No live Google in CI.
9. Never add Claude/GPT model ids without a new explicit decision.

## Risks that remain

- Cloud Code is still an unofficial client surface. Cloning official `agy` is the least-wrong presentation, not a ToS blessing.
- `agy` also sends ~30KB of Antigravity system prompt. We will send OpenCode/shuvcode system + tools, not that blob. That is the same class of difference as Claude Pro/Max vs Claude Code. If generate starts failing, the first experiment is a short identity line, not the 30KB dump.
- `VALIDATED` tool mode plus OpenCode tool names may 400. Fall back to `AUTO` only after a captured 400.
- `labels.model_enum` should match `fetchAvailableModels[].model`. Do not hardcode `M300` for every 3.7 id.
- Plugin API is beta. Keep shaping in one module.

## Confidence

High on: host, path, envelope keys, auth header, CLI UA, project id RPC, Google-only catalog, in-tree `/connect` shape, “do not ship Claude”.

Medium on: whether overlaying `google` vs a sibling provider id is cleaner in the TUI; whether `VALIDATED` survives OpenCode tools; whether we need Anthropic-style loopback for token freshness.

Low on: whether Google will treat a non-`agy` binary with the CLI UA as the CLI. We cannot make that true. We can avoid the fingerprints that already burned people (Electron cosplay, Claude farming, account rotation, sandbox host, `x-machine-id`).

I am happy to implement from this note.
