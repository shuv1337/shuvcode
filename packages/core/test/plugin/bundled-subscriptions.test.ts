import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ClaudePlugin } from "@shuvcode/claude-plugin"
import { GoogleAntigravityPlugin } from "@shuvcode/antigravity-plugin"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
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
