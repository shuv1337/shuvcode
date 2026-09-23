import { NodeServices } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, FileSystem } from "effect"
import { realpathSync, statSync } from "node:fs"
import path from "node:path"
import { RetainedImage } from "../src/services/retained-image"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)
// Hard links to a running image are a Windows concern, and /tmp is often another filesystem elsewhere.
const windows = process.platform === "win32" ? it.live : it.live.skip

windows("retain hard-links the running image for the scope and sweeps only links of exited processes", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "shuvcode-retained-" })
    // pid 999999999 does not exist; pid 4 is System, alive but not openable (EPERM).
    const kept = ["shuvcode-service-4-aa.exe", `shuvcode-service-${process.pid}-bb.exe`, "unrelated.exe"]
    yield* Effect.forEach([...kept, "shuvcode-upgrade-999999999-cc.exe"], (name) =>
      fs.writeFileString(path.join(directory, name), name),
    )
    const image = statSync(realpathSync(process.execPath))
    yield* Effect.scoped(
      Effect.gen(function* () {
        const link = yield* RetainedImage.retain(directory, "upgrade")
        if (!link) return yield* Effect.die("Expected a link")
        expect(path.basename(link)).toMatch(new RegExp(`^shuvcode-upgrade-${process.pid}-[0-9a-f]{8}\\.exe$`))
        expect(statSync(link).ino).toBe(image.ino)
        expect(statSync(link).nlink).toBe(image.nlink + 1)
        expect((yield* fs.readDirectory(directory)).sort()).toEqual([...kept, path.basename(link)].sort())
      }),
    )
    // The running test process does not lock the image's other links, so the release removes it.
    expect((yield* fs.readDirectory(directory)).sort()).toEqual(kept.sort())
  }),
)

windows("retain tolerates a directory it cannot link into", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "shuvcode-retained-" })
    const file = path.join(root, "not-a-directory")
    yield* fs.writeFileString(file, "")
    expect(yield* Effect.scoped(RetainedImage.retain(file, "service"))).toBeUndefined()
  }),
)

windows("relocate moves only retained links out of a directory", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "shuvcode-retained-" })
    const cache = path.join(root, "cache")
    const tmp = path.join(root, "tmp")
    yield* fs.makeDirectory(cache)
    yield* fs.writeFileString(path.join(cache, "shuvcode-upgrade-1-ab.exe"), "link")
    yield* fs.writeFileString(path.join(cache, "models.json"), "{}")
    yield* RetainedImage.relocate(cache, tmp)
    expect(yield* fs.readDirectory(cache)).toEqual(["models.json"])
    expect(yield* fs.readDirectory(tmp)).toEqual(["shuvcode-upgrade-1-ab.exe"])
  }),
)

it.live("installed accepts Shuvcode package-manager binaries only", () =>
  Effect.gen(function* () {
    const home = path.join(path.sep, "home", "someone")
    const original = process.execPath
    yield* Effect.addFinalizer(() => Effect.sync(() => (process.execPath = original)))
    const cases = [
      [
        path.join(home, ".bun", "install", "global", "node_modules", "shuvcode-windows-x64", "bin", "shuvcode.exe"),
        true,
      ],
      [path.join(home, "node_modules", "shuvcode-node-windows-x64", "bin", "shuvcode-node.exe"), true],
      [path.join(home, ".opencode", "bin", "opencode.exe"), false],
      [path.join(home, "AppData", "Local", "Programs", "Shuvcode", "resources", "shuvcode.exe"), false],
      [path.join(home, "node_modules", "bun", "bin", "bun.exe"), false],
    ] as const
    const results = cases.map(([executable]) => {
      process.execPath = executable
      return RetainedImage.installed()
    })
    expect(results).toEqual(cases.map(([, expected]) => expected))
  }),
)
