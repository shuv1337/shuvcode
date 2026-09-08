import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect } from "bun:test"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { ConfigPluginSource } from "@opencode-ai/core/config/plugin/source"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Plugin } from "@opencode-ai/core/plugin"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Fiber, Layer, Logger, Schedule, Stream } from "effect"
import { Database } from "../../src/database/database"
import { tmpdir } from "../fixture/tmpdir"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)
const staticIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    ConfigPluginSource.node.replace(ConfigPluginSource.empty),
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)
const refreshNpm = makeGlobalNode({
  service: Npm.Service,
  layer: Layer.effect(
    Npm.Service,
    Effect.gen(function* () {
      const global = yield* Global.Service
      const directory = path.join(global.tmp, "background-refresh-plugin")
      const installed = { directory, name: "background-refresh-plugin", version: "1.0.0" }
      return Npm.Service.of({
        add: () => Effect.succeed(installed),
        resolve: () => Effect.succeed(installed),
        check: () =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Bun.write(path.join(directory, "refresh-requested"), ""))
            yield* waitForFile(path.join(directory, "refresh-release")).pipe(Effect.orDie)
            yield* Effect.promise(() => Bun.write(path.join(directory, "refresh-finished"), ""))
            return true
          }),
        update: () => Effect.die("Update checks must not install a new generation"),
        which: () => Effect.succeed(undefined),
      })
    }),
  ),
  deps: [Global.node],
})
const refreshIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node, Global.node]),
    [Global.node.replace(tempGlobalLayer), Npm.node.replace(refreshNpm), offlineModels],
  ),
)

describe("PluginSupervisor config", () => {
  it.live("applies selectors in order", () =>
    withLocation(
      { plugins: ["-opencode.provider.*", "opencode.provider.openai"] },
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* ready()
        expect(
          (yield* plugins.list())
            .flatMap((plugin) => (plugin.id ? [plugin.id] : []))
            .filter((id) => id.startsWith("opencode.provider.")),
        ).toEqual([Plugin.ID.make("opencode.provider.openai")])
      }),
    ),
  )
  it.live("allows the built-in Plan agent to be disabled", () =>
    withLocation(
      { agents: { plan: { disabled: true } } },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("plan"))).toBeUndefined()
      }),
    ),
  )

  it.live("loads configured Promise plugins with options", () =>
    withLocation(
      {
        plugins: [
          "-*",
          {
            package: "./fixtures/config-promise-plugin",
            options: { description: "Loaded from config" },
          },
        ],
      },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const plugins = yield* Plugin.Service
        expect(yield* agents.get(Agent.ID.make("configured"))).toMatchObject({
          description: "Loaded from config",
          mode: "subagent",
        })
        const location = yield* Location.Service
        expect((yield* plugins.list()).find((plugin) => plugin.id === "config-promise-plugin")).toEqual({
          id: Plugin.ID.make("config-promise-plugin"),
          source: {
            type: "local",
            path: path.join(location.directory, "fixtures/config-promise-plugin/server.ts"),
          },
          state: { status: "active" },
          features: { server: true, tui: true },
        })
      }),
    ),
  )

  it.live("disables configured plugins by exported ID", () => {
    const plugin = "./fixtures/config-promise-plugin"
    return withLocation(
      { plugins: [plugin, "-config-promise-plugin"] },
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        const agents = yield* Agent.Service
        expect((yield* plugins.list()).map((item) => String(item.id))).not.toContain("config-promise-plugin")
        expect(yield* agents.get(Agent.ID.make("configured"))).toBeUndefined()
      }),
    )
  })

  it.live("does not disable configured plugins by package target", () => {
    const plugin = "./fixtures/config-promise-plugin"
    return withLocation(
      { plugins: [plugin, `-${plugin}`] },
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        expect((yield* plugins.list()).map((item) => String(item.id))).toContain("config-promise-plugin")
      }),
    )
  })

  it.live("loads configured Effect plugins with options", () =>
    withLocation(
      {
        plugins: [
          "-*",
          {
            package: "./fixtures/config-effect-plugin",
            options: { description: "Effect plugin from config" },
          },
        ],
      },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("effect-configured"))).toMatchObject({
          description: "Effect plugin from config",
          mode: "subagent",
        })
      }),
    ),
  )

  it.live("logs invalid packages and continues loading", () => {
    const output: string[] = []
    const logger = Logger.map(Logger.formatStructured, (entry) => {
      if (!Array.isArray(entry.message) || entry.message[0] !== "failed to load plugin") return
      const details = entry.message[1]
      if (typeof details !== "object" || details === null || !("target" in details)) return
      if (typeof details.target === "string") output.push(details.target)
    })
    return withLocation(
      {
        plugins: [
          "-*",
          "./fixtures/missing-plugin",
          "./fixtures/invalid-plugin",
          {
            package: "./fixtures/config-promise-plugin",
            options: { description: "Loaded after invalid plugins" },
          },
        ],
      },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const plugins = yield* Plugin.Service
        expect(yield* agents.get(Agent.ID.make("configured"))).toMatchObject({
          description: "Loaded after invalid plugins",
        })
        const location = yield* Location.Service
        expect(output).toEqual([
          path.join(location.directory, "fixtures/missing-plugin"),
          path.join(location.directory, "fixtures/invalid-plugin"),
        ])
        expect(
          (yield* plugins.list()).filter((plugin) => plugin.state.status === "failed").map((plugin) => plugin.source),
        ).toEqual([
          { type: "local", path: path.join(location.directory, "fixtures/missing-plugin") },
          { type: "local", path: path.join(location.directory, "fixtures/invalid-plugin") },
        ])
      }),
    ).pipe(Effect.provide(Logger.layer([logger])))
  })

  it.live("loads auto-discovered plugin files", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("directory"))).toMatchObject({
          description: "Loaded from plugin directory",
        })
      }),
      true,
    ),
  )

  it.live("prefers server entrypoints and falls back to index for discovered directories", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        const ids = (yield* plugins.list()).map((plugin) => String(plugin.id))
        expect(ids).toContain("package-server")
        expect(ids).toContain("package-index")
        expect(ids).not.toContain("shadowed-index")
      }),
      false,
      async (directory) => {
        await Promise.all([
          writeDiscoveredPackage(directory, "server", { "server.ts": "package-server", "index.js": "shadowed-index" }),
          writeDiscoveredPackage(directory, "index", { "index.js": "package-index" }),
        ])
      },
    ),
  )

  it.live("keeps auto-discovered package entrypoints inside the package directory", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        const ids = (yield* plugins.list()).map((plugin) => String(plugin.id))
        expect(ids).toContain("contained-plugin")
        expect(ids).not.toContain("escaped-entrypoint")
        expect(ids).not.toContain("symlink-fallback")
      }),
      false,
      async (directory) => {
        await fs.mkdir(path.join(directory, ".opencode"), { recursive: true })
        await fs.writeFile(path.join(directory, ".opencode", "escape.js"), discoveredPlugin("escaped-entrypoint"))
        await writeDiscoveredPackage(directory, "contained", { "server.js": "contained-plugin" })
        await writeDiscoveredPackage(directory, "symlink", { "index.js": "symlink-fallback" })
        await fs.symlink(
          path.join(directory, ".opencode", "escape.js"),
          path.join(directory, ".opencode", "plugins", "symlink", "server.js"),
        )
      },
    ),
  )

  staticIt.live("uses only internal and SDK plugins when the static source is wired", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(define({ id: "static-sdk", effect: () => Effect.void }))
      yield* withLocation(
        { plugins: ["-*", "./fixtures/config-promise-plugin"] },
        Effect.gen(function* () {
          yield* ready()
          const plugins = yield* Plugin.Service
          const inventory = yield* plugins.list()
          const ids = inventory.map((plugin) => String(plugin.id))
          expect(ids).toContain("opencode.agent")
          expect(ids).toContain("static-sdk")
          expect(ids).not.toContain("config-promise-plugin")
          expect(inventory.find((plugin) => plugin.id === "static-sdk")?.source).toEqual({ type: "sdk" })

          const agents = yield* Agent.Service
          expect(yield* agents.get(Agent.ID.make("directory"))).toBeUndefined()
          expect(yield* agents.get(Agent.ID.make("configured"))).toBeUndefined()
        }),
        true,
      )
    }),
  )

  it.live("reloads an auto-discovered plugin when its file changes", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const location = yield* Location.Service
        const plugins = yield* Plugin.Service
        const file = path.join(location.directory, ".opencode", "plugin", "mutable.ts")
        const first = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id

        expect(first).toBeDefined()
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("first")

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.promise(async () => {
          await fs.writeFile(file, mutablePlugin("second"))
          const modified = new Date(Date.now() + 5_000)
          await fs.utimes(file, modified, modified)
        })
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))

        const current = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id
        expect(current).toBe(first)
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")
      }),
      false,
      async (directory) => {
        const plugin = path.join(directory, ".opencode", "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await fs.writeFile(path.join(plugin, "mutable.ts"), mutablePlugin("first"))
      },
    ),
  )

  it.live("reloads a configured plugin when its source file changes", () =>
    withLocation(
      { plugins: ["-*", "./external/mutable"] },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const location = yield* Location.Service
        const file = path.join(location.directory, "external/mutable/server.ts")

        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("first")

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.promise(async () => {
          await fs.writeFile(file, mutablePlugin("second"))
          const modified = new Date(Date.now() + 5_000)
          await fs.utimes(file, modified, modified)
        })
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))

        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")
      }),
      false,
      async (directory) => {
        // Outside any {plugin,plugins} config-source directory, so only the
        // configured-entrypoint watch can observe the edit.
        const external = path.join(directory, "external/mutable")
        await fs.mkdir(external, { recursive: true })
        await fs.writeFile(path.join(external, "server.ts"), mutablePlugin("first"))
      },
    ),
  )

  it.live("applies explicit removals after auto-discovery", () =>
    withLocation(
      { plugins: ["-*"] },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("directory"))).toBeUndefined()
      }),
      true,
    ),
  )

  it.live("lets an explicit plugin source replace an auto-discovered plugin with the same ID", () =>
    withLocation(
      { plugins: ["./explicit"] },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("duplicate-source"))).toMatchObject({
          description: "explicit",
        })
      }),
      false,
      async (directory) => {
        const discovered = path.join(directory, ".opencode", "plugins")
        await fs.mkdir(discovered, { recursive: true })
        await fs.writeFile(
          path.join(discovered, "duplicate.ts"),
          mutablePluginWithID("duplicate-source", "duplicate-source", "discovered"),
        )
        await fs.mkdir(path.join(directory, "explicit"))
        await fs.writeFile(
          path.join(directory, "explicit/server.ts"),
          mutablePluginWithID("duplicate-source", "duplicate-source", "explicit"),
        )
      },
    ),
  )

  it.live("loads user plugins before internal post plugins", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(define({ id: "sdk-order", effect: () => Effect.void }))
      yield* withLocation(
        {
          plugins: ["./fixtures/config-promise-plugin", "./fixtures/variant-source-plugin"],
        },
        Effect.gen(function* () {
          yield* ready()
          const registry = yield* Plugin.Service
          const ids = (yield* registry.list()).map((plugin) => String(plugin.id))
          expect(ids.indexOf("opencode.agent")).toBeLessThan(ids.indexOf("sdk-order"))
          expect(ids.indexOf("sdk-order")).toBeLessThan(ids.indexOf("config-promise-plugin"))
          expect(ids.indexOf("config-promise-plugin")).toBeLessThan(ids.indexOf("variant-source"))
          expect(ids.indexOf("variant-source")).toBeLessThan(ids.indexOf("opencode.config.provider"))
          expect(ids.indexOf("opencode.config.provider")).toBeLessThan(ids.indexOf("opencode.variant"))

          const catalog = yield* Catalog.Service
          expect(
            (yield* catalog.model.get(Provider.ID.make("configured"), Model.ID.make("glm-5.2")))?.variants,
          ).toEqual([
            expect.objectContaining({ id: "high", headers: { custom: "true" } }),
            expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
          ])
        }),
      )
    }),
  )

  it.live("allows variant generation to be disabled", () =>
    withLocation(
      {
        plugins: ["./fixtures/variant-source-plugin", "-opencode.variant"],
      },
      Effect.gen(function* () {
        yield* ready()
        const registry = yield* Plugin.Service
        expect((yield* registry.list()).map((plugin) => String(plugin.id))).not.toContain("opencode.variant")

        const catalog = yield* Catalog.Service
        expect((yield* catalog.model.get(Provider.ID.make("configured"), Model.ID.make("glm-5.2")))?.variants).toEqual([
          expect.objectContaining({ id: "high", headers: { custom: "true" } }),
        ])
      }),
    ),
  )

  it.live("settles activation when plugin setup fails and keeps healthy plugins", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(define({ id: "failed-setup", effect: () => Effect.die("setup failed") }))
      yield* sdk.register(define({ id: "healthy-setup", effect: () => Effect.void }))
      yield* withLocation(
        undefined,
        Effect.gen(function* () {
          yield* ready().pipe(Effect.timeout("2 seconds"))
          const plugins = yield* Plugin.Service
          expect(
            (yield* plugins.list())
              .filter((plugin) => plugin.id === "failed-setup" || plugin.id === "healthy-setup")
              .map((plugin) => ({ id: plugin.id, status: plugin.state.status })),
          ).toEqual([
            { id: Plugin.ID.make("failed-setup"), status: "failed" },
            { id: Plugin.ID.make("healthy-setup"), status: "active" },
          ])
        }),
      )
    }),
  )

  refreshIt.live("checks active package plugins after setup without blocking activation or installing updates", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const directory = path.join(global.tmp, "background-refresh-plugin")
      const activated = path.join(directory, "activated")
      const release = path.join(directory, "release")
      const refreshed = path.join(directory, "refresh-requested")
      const refreshRelease = path.join(directory, "refresh-release")
      const refreshFinished = path.join(directory, "refresh-finished")
      yield* Effect.promise(async () => {
        await fs.mkdir(directory, { recursive: true })
        await fs.writeFile(
          path.join(directory, "package.json"),
          JSON.stringify({ name: "background-refresh-plugin", exports: { "./server": "./index.js" } }),
        )
        await fs.writeFile(
          path.join(directory, "index.js"),
          `export default {
            id: "background-refresh-plugin",
            async setup() {
              await Bun.write(${JSON.stringify(activated)}, "")
              while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(10)
            },
          }`,
        )
      })

      yield* withLocation(
        { plugins: ["background-refresh-plugin"] },
        Effect.gen(function* () {
          yield* waitForFile(activated)
          yield* Effect.sleep("100 millis")
          expect(yield* Effect.promise(() => Bun.file(refreshed).exists())).toBeFalse()
          yield* Effect.promise(() => Bun.write(release, ""))
          yield* waitForFile(refreshed)
          yield* ready().pipe(Effect.timeout("2 seconds"))
          const plugins = yield* Plugin.Service
          expect((yield* plugins.list()).find((plugin) => plugin.id === "background-refresh-plugin")).toMatchObject({
            state: { status: "active" },
            source: { type: "package", target: "background-refresh-plugin", version: "1.0.0" },
          })
          expect(yield* Effect.promise(() => Bun.file(refreshFinished).exists())).toBeFalse()
          yield* Effect.promise(() => Bun.write(refreshRelease, ""))
          yield* waitForFile(refreshFinished)
          const outdated = yield* plugins.list().pipe(
            Effect.map((inventory) => inventory.find((plugin) => plugin.id === "background-refresh-plugin")),
            Effect.filterOrFail((plugin) => plugin?.source.type === "package" && plugin.source.outdated === true),
            Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
          )
          expect(outdated?.state.status).toBe("active")
        }),
      )
    }),
  )
})

const ready = Effect.fnUntraced(function* () {
  const plugins = yield* Plugin.Service
  yield* plugins.awaitActivation
})

const waitForFile = (file: string) =>
  Effect.promise(() => Bun.file(file).exists()).pipe(
    Effect.filterOrFail((exists) => exists),
    Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
    Effect.timeout("2 seconds"),
  )

function withLocation<A, E, R>(
  config: unknown,
  effect: Effect.Effect<A, E, R>,
  fixtures = false,
  prepare?: (directory: string) => Promise<void>,
) {
  return Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
    Effect.tap((tmp) =>
      Effect.promise(async () => {
        await prepareFixtures(tmp.path)
        await prepare?.(tmp.path)
        if (fixtures) {
          const directory = path.join(tmp.path, ".opencode/plugin")
          await fs.mkdir(directory, { recursive: true })
          await fs.writeFile(
            path.join(directory, "directory.ts"),
            mutablePluginWithID("directory-plugin", "directory", "Loaded from plugin directory"),
          )
        }
        if (config !== undefined) {
          const directory = tmp.path
          await fs.mkdir(directory, { recursive: true })
          await fs.writeFile(path.join(directory, "opencode.json"), JSON.stringify(config))
        }
      }),
    ),
    Effect.flatMap((tmp) =>
      effect.pipe(
        Effect.scoped,
        Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }))),
      ),
    ),
  )
}

async function prepareFixtures(directory: string) {
  // Configured plugins are directories; keep their sources local to each test.
  const promise = `export default {
    id: "config-promise-plugin",
    async setup(ctx) {
      await ctx.agent.transform((agents) => {
        agents.update("configured", (agent) => {
          agent.description = ctx.options.description
          agent.mode = "subagent"
        })
      })
    },
  }`
  const effect = `
    import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))}
    export default {
      id: "config-effect-plugin",
      effect: (ctx) => ctx.agent.transform((agents) => {
        agents.update("effect-configured", (agent) => {
          agent.description = ctx.options.description
          agent.mode = "subagent"
        })
      }).pipe(Effect.asVoid),
    }`
  const variants = `
    import { Provider } from ${JSON.stringify(import.meta.resolve("@opencode-ai/core/provider"))}
    export default {
      id: "variant-source",
      async setup(ctx) {
        await ctx.catalog.transform((catalog) => {
          catalog.provider.update("configured", (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          })
          catalog.model.update("configured", "glm-5.2", (model) => {
            model.modelID = "glm-5.2"
            model.package = Provider.aisdk("@ai-sdk/openai-compatible")
            model.variants = [{ id: "high", settings: {}, headers: { custom: "true" }, body: {} }]
          })
        })
      },
    }`
  await Promise.all(
    Object.entries({
      "config-promise-plugin": promise,
      "config-effect-plugin": effect,
      "variant-source-plugin": variants,
      "invalid-plugin": "export default {}",
    }).map(async ([name, source]) => {
      const target = path.join(directory, "fixtures", name)
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, "server.ts"), source)
    }),
  )
  await fs.writeFile(path.join(directory, "fixtures/config-promise-plugin/tui.ts"), "export default {}")
}

function mutablePlugin(description: string) {
  return mutablePluginWithID("mutable-plugin", "mutable", description)
}

function mutablePluginWithID(id: string, agentID: string, description: string) {
  const plugin = pathToFileURL(path.join(import.meta.dir, "../../../plugin/src/promise/index.ts")).href
  return `
import { Plugin } from ${JSON.stringify(plugin)}

export default Plugin.define({
  id: ${JSON.stringify(id)},
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update(${JSON.stringify(agentID)}, (agent) => {
        agent.description = ${JSON.stringify(description)}
        agent.mode = "subagent"
      })
    })
  },
})
`
}

function discoveredPlugin(id: string) {
  return `export default { id: ${JSON.stringify(id)}, setup() {} }`
}

async function writeDiscoveredPackage(directory: string, name: string, files: Record<string, string>) {
  const plugin = path.join(directory, ".opencode", "plugins", name)
  await fs.mkdir(plugin, { recursive: true })
  await Promise.all(
    Object.entries(files).map(([file, id]) => fs.writeFile(path.join(plugin, file), discoveredPlugin(id))),
  )
}
