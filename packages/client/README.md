# @opencode-ai/client

Private generation target for clients derived directly from OpenCode's authoritative Effect `HttpApi`.

## Entrypoints

- `@opencode-ai/client`: zero-Effect Promise client using `fetch`.
- `@opencode-ai/client/effect`: rich Effect network client using an environment-provided `HttpClient`.

The generated surface includes every standard HTTP group from Server's concrete API. The build compiler reads `@opencode-ai/server/api`; the generated Effect runtime imports a client-local projection built from Protocol, with a generation-equivalence test preventing transport drift. Custom transports such as the PTY WebSocket connection remain outside the generic HTTP client. Run `bun run generate` after changing the contract and `bun run check:generated` to detect committed-output drift.

The Effect entrypoint uses canonical decoded values such as `Session.ID`, `Location.Ref`, and `Prompt`. These datatypes come from the lightweight `@opencode-ai/schema` package and are re-exported so callers depend only on the client surface. Protocol owns endpoint construction and middleware placement; Server supplies the concrete middleware keys used by the build-time API.

The Promise root remains structural and has no Core or Effect runtime dependency. `/effect` depends only on Effect, Schema, and Protocol and is browser-bundle safe. Bundle-boundary tests enforce both import graphs.

Fork releases bundle the Promise surface into the matching `shuvcode` CLI package. External fork consumers should import `OpenCode` and generated request/response types from `shuvcode/client`; `@opencode-ai/client` remains the upstream package name.

The packed Promise client creates a deny-by-default review session with an exact tool allowlist:

```ts
import { OpenCode } from "shuvcode/client"

const client = OpenCode.make({ baseUrl })
const session = await client.session.create({
  location: { directory: workspace },
  policy: { tools: { allow: ["read", "grep", "glob"] } },
})
```

The server persists this policy, intersects it with process and agent permissions at actual dispatch, and allows forked sessions to inherit or narrow it. Prompt text, metadata, events, and model output cannot widen it.

Packed clients can inspect non-sensitive authentication readiness without making a provider request:

```ts
const status = await client.auth.status()
```

`status.data.verification` is always `"not_performed"`: the server checks only local credential structure, OAuth expiry metadata, and whether a configured environment value is non-empty. It does not refresh OAuth, contact a provider, consume model quota, or prove that a provider will accept a credential. Expired OAuth is therefore reported unusable until the normal connection path refreshes it. The response never includes credential values, environment variable names, filesystem paths, request headers, or raw provider/storage errors.

Effect consumers construct canonical decoded inputs:

```ts
import { AbsolutePath, Location, OpenCode, Prompt } from "@opencode-ai/client/effect"

const client = yield * OpenCode.make({ baseUrl: "https://opencode.example" })
yield *
  client.sessions.create({
    location: Location.Ref.make({ directory: AbsolutePath.make("/workspace") }),
  })
yield * client.sessions.prompt({ sessionID, prompt: Prompt.make({ text: "Hello" }) })
```
