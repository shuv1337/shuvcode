# Claude subscription plugin

Included and enabled by default in every Shuvcode Bun and Node install. No
separate package installation or `plugins` config entry is required.
`@shuvcode/claude-plugin` uses only the public `@opencode/plugin` Effect API.

## Host adapter

```ts
export { ClaudePlugin } from "@shuvcode/claude-plugin"
```

Core's `ProviderPlugins` registry already registers `ClaudePlugin`. Its ID is
`shuvcode.provider.claude`. The package also exports `createPlugin(options)`,
`integrationID` (`anthropic`), `methodID` (`claude-pro-max`), and a default plugin.
`createPlugin` accepts injected OAuth `fetch` and `now` boundaries for offline tests.
It does not own inference transport.

- Registers Claude Pro/Max OAuth and the `CLAUDE_CODE_OAUTH_TOKEN` /
  `ANTHROPIC_API_KEY` environment sources, retaining existing environment names.
- OAuth method credentials and `sk-ant-oat` setup tokens use subscription shaping;
  ordinary API keys remain untouched.
- Resolves the active connection on every request. Never rewrites the URL or wraps
  a transport. Restores tool names using the matched request, not current auth.
- Buffers complete SSE events and UTF-8, preserving status, headers, cancellation,
  unknown events, and tool input arguments. Original tool-name spelling is retained.
- Sets subscription model `cost = []`; public credential events reload that view.

## Auth safety

The host owns persistence and the access-only expiry gate: OAuth credentials with
`metadata.shuvcodeAuthImport === 'access-only'` must have `refresh: ''`, and resolution
must fail locally at `expires <= now + 5 minutes` without invoking refresh.
The plugin independently rejects marked refresh attempts before network access,
including mistakenly retained refresh tokens. Native OAuth refresh preserves
metadata and supports cancellation. No credentials are read directly by this package.

## Verification

```sh
cd packages/claude-plugin
bun test
bun typecheck
```

Tests use injected network functions and local streams, not external providers or
global mocks. Pure wire helpers derive from the old fork's Claude Code provider;
this port also preserves first-block instructions, shapes forced tool choice, and
restores only tool-use envelopes rather than rewriting every JSON `name` field.

Offline parity does **not** establish current subscription billing eligibility.
Recheck the historical identity/header/environment assumptions with the separately
authorized isolated live suite before claiming Pro/Max billing parity.
