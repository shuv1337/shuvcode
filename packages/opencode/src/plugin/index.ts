import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { pathToFileURL } from "node:url"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import * as path from "node:path"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const state = Instance.state(async () => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      $: Bun.$,
    }
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push("opencode-copilot-auth@0.0.9")
      plugins.push("opencode-anthropic-auth@0.0.5")
    }
    for (let plugin of plugins) {
      log.info("loading plugin", { path: plugin })
      let pluginUrl: string
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        // Convert to file:// URL for proper module resolution from the cache directory
        // Use pathToFileURL for cross-platform compatibility (especially Windows)
        pluginUrl = pathToFileURL(await BunProc.install(pkg, version)).href
      } else {
        // Resolve relative file:// paths against the working directory
        const filePath = plugin.substring("file://".length)
        if (!path.isAbsolute(filePath)) {
          pluginUrl = pathToFileURL(path.resolve(Instance.directory, filePath)).href
        } else {
          pluginUrl = plugin
        }
      }
      try {
        const mod = await import(pluginUrl)
        for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
          const init = await fn(input)
          hooks.push(init)
        }
      } catch (e) {
        const err = e as Error
        // Check for Windows-specific module resolution issues with subpath exports
        if (process.platform === "win32" && err.message?.includes("Cannot find module")) {
          log.error("failed to load plugin (Windows module resolution issue)", {
            plugin,
            error: err.message,
            hint: "This plugin may use subpath exports which have known issues on Windows. Try removing it from your config.",
          })
        } else {
          log.error("failed to load plugin", {
            plugin,
            error: err.message,
          })
        }
        throw e
      }
    }

    return {
      hooks,
      input,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "plugin.command">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function client() {
    return state().then((x) => x.input.client)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      await hook.config?.(config as any)
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
