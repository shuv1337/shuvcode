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
import { Global } from "../global"
import * as path from "node:path"
import * as crypto from "node:crypto"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  /**
   * Bundle a local plugin file with its dependencies.
   * This ensures that local plugins can use npm dependencies that are installed
   * in their parent directory's node_modules.
   */
  async function bundleLocalPlugin(filePath: string): Promise<string> {
    const bundledDir = path.join(Global.Path.cache, "bundled-local")
    await Bun.file(bundledDir)
      .exists()
      .then(async (exists) => {
        if (!exists) await Bun.$`mkdir -p ${bundledDir}`
      })

    // Create a hash of the file path and its modification time for cache invalidation
    const stat = await Bun.file(filePath)
      .stat()
      .catch(() => null)
    const mtime = stat?.mtimeMs ?? 0
    const hash = crypto.createHash("md5").update(`${filePath}:${mtime}`).digest("hex").slice(0, 12)
    const baseName = path.basename(filePath, path.extname(filePath))
    const bundledFile = path.join(bundledDir, `${baseName}-${hash}.js`)

    // Check if already bundled
    if (await Bun.file(bundledFile).exists()) {
      log.info("using cached bundled local plugin", { path: filePath, bundled: bundledFile })
      return bundledFile
    }

    log.info("bundling local plugin with dependencies", { path: filePath, bundled: bundledFile })

    try {
      const result = await Bun.build({
        entrypoints: [filePath],
        outdir: bundledDir,
        naming: `${baseName}-${hash}.js`,
        target: "bun",
        format: "esm",
        // Bundle all dependencies to resolve imports like 'jsonc-parser'
        packages: "bundle",
      })

      if (!result.success) {
        log.error("failed to bundle local plugin", {
          path: filePath,
          logs: result.logs,
        })
        // Fall back to direct import (will fail if deps are missing)
        return filePath
      }

      return bundledFile
    } catch (e) {
      log.error("failed to bundle local plugin", {
        path: filePath,
        error: (e as Error).message,
      })
      // Fall back to direct import
      return filePath
    }
  }

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
        // BunProc.install now returns the bundled file path directly
        const pluginPath = await BunProc.install(pkg, version)
        pluginUrl = pathToFileURL(pluginPath).href
      } else {
        // Resolve relative file:// paths against the working directory
        const filePath = plugin.substring("file://".length)
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(Instance.directory, filePath)
        // Bundle local plugins with their dependencies for compiled binary compatibility
        const bundledPath = await bundleLocalPlugin(absolutePath)
        pluginUrl = pathToFileURL(bundledPath).href
      }
      try {
        // Use dynamic import() with absolute file:// URLs for ES module compatibility
        // pathToFileURL ensures proper URL encoding regardless of import.meta.url context
        const mod = await import(pluginUrl)
        for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
          const init = await fn(input)
          hooks.push(init)
        }
      } catch (e) {
        const err = e as Error
        // Check for module resolution issues
        if (err.message?.includes("Cannot find module") || err.message?.includes("Cannot find package")) {
          log.error("failed to load plugin", {
            plugin,
            error: err.message,
            hint: "Make sure all plugin dependencies are installed. Run 'bun install' in the plugin directory.",
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
