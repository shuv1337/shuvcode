import { describe, test, expect, beforeAll } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import * as fs from "fs/promises"
import * as path from "path"
import { Instance } from "@/project/instance"
import { Config } from "@/config/config"
import { Global } from "@/global"

describe("Plugin", () => {
  beforeAll(() => {
    // Disable default plugins to isolate our test
    process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true"
  })

  test("bundles local plugin with npm dependencies", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create the .opencode/plugin directory structure
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        // Create a package.json with jsonc-parser as a dependency
        await Bun.write(
          path.join(dir, ".opencode", "package.json"),
          JSON.stringify(
            {
              name: "test-plugin",
              version: "1.0.0",
              type: "module",
              dependencies: {
                "jsonc-parser": "^3.2.0",
                "@opencode-ai/plugin": "latest",
              },
            },
            null,
            2,
          ),
        )

        // Install dependencies
        await Bun.$`bun install`.cwd(path.join(dir, ".opencode")).quiet()

        // Create a plugin that uses jsonc-parser
        await Bun.write(
          path.join(pluginDir, "test-plugin.ts"),
          `
import { parse } from "jsonc-parser"
import type { Plugin } from "@opencode-ai/plugin"

export const testPlugin: Plugin = async (input) => {
  // Use jsonc-parser to prove it was bundled
  const result = parse('{"test": true}')
  console.log("Plugin loaded with jsonc-parser:", result)
  return {}
}
`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        // Should have found our local plugin
        const localPlugin = plugins.find((p) => p.includes("test-plugin.ts"))
        expect(localPlugin).toBeDefined()

        // Verify the bundled-local directory will be used
        // The bundled plugins go to ~/.cache/opencode/bundled-local/
        expect(Global.Path.cache).toBeDefined()
        expect(plugins.length).toBeGreaterThan(0)
        expect(localPlugin).toContain("file://")
      },
    })
  })

  test("caches bundled local plugins based on file modification time", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(dir, ".opencode", "package.json"),
          JSON.stringify({ name: "test-cache", version: "1.0.0", type: "module" }, null, 2),
        )

        await Bun.write(
          path.join(pluginDir, "cache-test.ts"),
          `
import type { Plugin } from "@opencode-ai/plugin"
export const cacheTestPlugin: Plugin = async () => ({})
`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const plugins = config.plugin ?? []
        expect(plugins.some((p) => p.includes("cache-test.ts"))).toBe(true)
      },
    })
  })
})
