import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ClaudePlugin } from "@shuvcode/claude-plugin"
import { ClaudeAgentPlugin } from "@opencode/core/plugin/provider/claude-agent/index"
import { GoogleAntigravityPlugin } from "@shuvcode/antigravity-plugin"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const required = [
  { plugin: ClaudePlugin, integration: "anthropic", method: "claude-pro-max" },
  { plugin: GoogleAntigravityPlugin, integration: "google", method: "google-ai-pro" },
]

describe("bundled subscription providers", () => {
  test("both implementations are in the default Core provider registry", () => {
    for (const entry of required) {
      expect(ProviderPlugins).toContain(entry.plugin)
      expect(ProviderPlugins.filter((plugin) => plugin.id === entry.plugin.id)).toHaveLength(1)
    }
  })

  test("keeps Claude Pro/Max and does not register Claude Agent", () => {
    expect(ProviderPlugins).toContain(ClaudePlugin)
    expect(ProviderPlugins.filter((plugin) => plugin.id === ClaudePlugin.id)).toHaveLength(1)
    expect(ProviderPlugins.map((plugin) => plugin.id)).not.toContain("opencode.provider.claude-agent")
    expect(ProviderPlugins).not.toContain(ClaudeAgentPlugin)
  })

  it.effect("loads bundled providers without registering Claude Agent", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const provider = yield* Provider.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      for (const entry of ProviderPlugins) {
        // Bundled plugins ask for more services than this test's effect type lists.
        // The fixture layer provides them; the cast only widens the checker.
        yield* entry.effect(host) as Effect.Effect<void>
      }
      expect(yield* integration.get(Integration.ID.make("claude-agent"))).toBeUndefined()
      expect(yield* provider.get(Provider.ID.claudeAgent)).toBeUndefined()
      expect((yield* integration.get(Integration.ID.make("anthropic")))?.methods).toContainEqual(
        expect.objectContaining({ id: "claude-pro-max", type: "oauth" }),
      )
    }),
  )

  it.effect("registers both login methods without external plugin configuration", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      for (const entry of required) {
        yield* entry.plugin.effect(host)
        expect((yield* integration.get(Integration.ID.make(entry.integration)))?.methods).toContainEqual(
          expect.objectContaining({ id: entry.method, type: "oauth" }),
        )
      }
    }),
  )
})
