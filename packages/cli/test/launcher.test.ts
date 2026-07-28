import { afterEach, expect, test } from "bun:test"
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test.skipIf(process.platform === "win32")("launches the installed platform binary without lifecycle scripts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-launcher-"))
  directories.push(root)
  const platform = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined
  if (!platform) throw new Error(`Unsupported test platform: ${process.platform}`)
  const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : undefined
  if (!arch) throw new Error(`Unsupported test architecture: ${process.arch}`)
  const dependency = `shuvcode-${platform}-${arch}`
  const packageRoot = path.join(root, "node_modules", dependency)

  await mkdir(path.join(root, "bin"), { recursive: true })
  await mkdir(path.join(packageRoot, "bin"), { recursive: true })
  await copyFile(path.join(import.meta.dir, "../script/launcher.mjs"), path.join(root, "bin", "launcher.mjs"))
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "shuvcode",
      bin: { shuvcode: "./bin/launcher.mjs" },
      optionalDependencies: { [dependency]: "2.0.0-alpha-2" },
    }),
  )
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: dependency, version: "2.0.0-alpha-2" }))
  await writeFile(
    path.join(packageRoot, "bin", "shuvcode"),
    '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\nprocess.exit(23)\n',
  )
  await chmod(path.join(packageRoot, "bin", "shuvcode"), 0o755)

  const child = Bun.spawn(["node", path.join(root, "bin", "launcher.mjs"), "hello", "two words"], {
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(await child.exited).toBe(23)
  expect(await new Response(child.stdout).text()).toBe('["hello","two words"]\n')
  expect(await new Response(child.stderr).text()).toBe("")
})
