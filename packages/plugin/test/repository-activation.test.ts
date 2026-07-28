import { afterAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-repository-plugin-"))

afterAll(() => fs.rm(directory, { recursive: true, force: true }))

test("repository plugins activate with a stale local V1 package", async () => {
  const root = path.resolve(import.meta.dir, "../../..")
  const plugins = path.join(directory, ".opencode", "plugins")
  const stale = path.join(directory, ".opencode", "node_modules", "@opencode-ai", "plugin")

  await fs.mkdir(plugins, { recursive: true })
  await fs.mkdir(stale, { recursive: true })
  await fs.mkdir(path.join(directory, "packages"), { recursive: true })
  await fs.symlink(path.join(root, "packages", "plugin"), path.join(directory, "packages", "plugin"), "dir")
  await fs.symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir")
  await fs.writeFile(
    path.join(stale, "package.json"),
    JSON.stringify({ name: "@opencode-ai/plugin", version: "1.17.17", type: "module", exports: "./index.js" }),
  )
  await fs.writeFile(path.join(stale, "index.js"), 'throw new Error("stale V1 plugin package was loaded")\n')

  const ids = await Promise.all(
    ["github-triage.ts", "github-pr-search.ts"].map(async (name) => {
      await fs.copyFile(path.join(root, ".opencode", "plugins", name), path.join(plugins, name))
      return (await import(path.join(plugins, name))).default.id
    }),
  )

  expect(ids).toEqual(["repository.github-triage", "repository.github-pr-search"])
})
