## [API](https://opencode.ai/docs/api)

Shuvcode exposes an HTTP API from its server.

In Code Mode, use the built-in `shuvcode` tool namespace first, called inside
`execute` as `tools.shuvcode.*`; find its tools with Code Mode's `search`, for
example `search({ namespace: "shuvcode" })`. For anything they do not cover, call
the API with `fetch("opencode:///api/...")`. It reaches this Shuvcode server,
already signed in, and uses the session's directory. `current` in place of a
session ID names the calling session:

```js
const session = await (await fetch("opencode:///api/session/current")).json()
```

Read `skill://shuvcode/api.md` for the available endpoints, then the file it
points to for the group you need.
