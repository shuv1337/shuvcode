# @shuvcode/antigravity-plugin

Google AI Pro / Antigravity for OpenCode V2: an OAuth method on `/connect`, Cloud Code `v1internal` request shaping, and Gemini-only catalog overlay.

Shuvcode installs this plugin by default through a narrow Core adapter. Disable it with:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["-opencode.provider.google-antigravity"],
}
```

Install it yourself on a host that does not use the adapter:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@shuvcode/antigravity-plugin"],
}
```

## Requirements

- Reading official Antigravity IDE `state.vscdb` credentials uses **Bun SQLite** (`bun:sqlite`). Node and workerd hosts skip that import and still accept `~/.local/share/opencode/antigravity-accounts.json`.
- HTTP hooks are scoped to provider `google` so OpenAI WebSocket remains eligible.
