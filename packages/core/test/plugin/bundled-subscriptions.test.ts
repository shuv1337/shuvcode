import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ClaudePlugin } from "@shuvcode/claude-plugin"
import { ClaudeAgentPlugin } from "@opencode/core/plugin/provider/claude-agent/index"
import { GoogleSolsticePlugin } from "@shuvcode/antigravity-plugin"
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
  { plugin: GoogleSolsticePlugin, integration: "google", method: "google-solstice" },
  { plugin: GoogleSolsticePlugin, integration: "nous", method: "nous-device" },
]

describe("bundled subscription providers", () => {
  test("both implementations are in the default Core provider registry", () => {
    for (const plugin of [ClaudePlugin, GoogleSolsticePlugin]) {
      expect(ProviderPlugins).toContain(plugin)
      expect(ProviderPlugins.filter((entry) => entry.id === plugin.id)).toHaveLength(1)
    }
  })

  test("keeps Claude Pro/Max and does not register Claude Agent", () => {
    expect(ProviderPlugins).toContain(ClaudePlugin)
    expect(ProviderPlugins.filter((plugin) => plugin.id === ClaudePlugin.id)).toHaveLength(1)
    expect(ProviderPlugins.map((plugin) => plugin.id)).not.toContain("opencode.provider.claude-agent")
    expect(ProviderPlugins).not.toContain(ClaudeAgentPlugin)
  })

  it.effect("loads bundled providers without registering Claude Agent or exposing Nous as a provider", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const provider = yield* Provider.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin, "test")
      for (const entry of ProviderPlugins) {
        // SAFETY: PluginTestLayer provides the services these plugins read. The assertion
        // only hides requirements this test effect's type does not list.
        yield* entry.effect(host) as Effect.Effect<void>
      }
      expect(yield* integration.get(Integration.ID.make("claude-agent"))).toBeUndefined()
      expect(yield* provider.get(Provider.ID.claudeAgent)).toBeUndefined()
      expect(yield* provider.get(Provider.ID.make("nous"))).toBeUndefined()
      expect((yield* integration.get(Integration.ID.make("anthropic")))?.methods).toContainEqual(
        expect.objectContaining({ id: "claude-pro-max", type: "oauth" }),
      )
      expect((yield* integration.get(Integration.ID.make("google")))?.methods).toContainEqual(
        expect.objectContaining({ id: "google-solstice", type: "oauth" }),
      )
      expect((yield* integration.get(Integration.ID.make("nous")))?.methods).toContainEqual(
        expect.objectContaining({ id: "nous-device", type: "oauth" }),
      )
    }),
  )

  it.effect("registers bundled login methods without external plugin configuration", () =>
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin, "test")
      const loaded = new Set<string>()
      for (const entry of required) {
        if (!loaded.has(entry.plugin.id)) {
          yield* entry.plugin.effect(host)
          loaded.add(entry.plugin.id)
        }
        expect((yield* integration.get(Integration.ID.make(entry.integration)))?.methods).toContainEqual(
          expect.objectContaining({ id: entry.method, type: "oauth" }),
        )
      }
    }),
  )
})
