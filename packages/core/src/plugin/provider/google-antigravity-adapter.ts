/**
 * Narrow Shuvcode default-activation adapter for `@shuvcode/antigravity-plugin`.
 *
 * The plugin implementation lives in the package and uses only public
 * `@opencode-ai/plugin` / `@opencode-ai/schema` entrypoints. This file is the
 * least-coupled Core seam that still installs it by default: `ProviderPlugins`
 * already boots every in-tree provider, and config can disable this id with
 * `-opencode.provider.google-antigravity`.
 */
export { GoogleAntigravityPlugin } from "#antigravity-plugin"
