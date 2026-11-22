import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

// The desktop OAuth callback requires Node HTTP. Bun and Node installs always
// resolve the real bundled package; this non-CLI host has no local callback.
export const GoogleSolsticePlugin = define({
  id: "shuvcode.provider.google-solstice",
  effect: () => Effect.void,
})

export const GoogleAntigravityPlugin = GoogleSolsticePlugin
