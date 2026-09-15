import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

// The desktop OAuth callback requires Node HTTP. Bun and Node installs always
// resolve the real bundled package; this non-CLI host has no local callback.
export const GoogleAntigravityPlugin = define({
  id: "opencode.provider.google-antigravity",
  effect: () => Effect.void,
})
