import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

// The launcher never runs a binary built for the other libc, so fixtures name the host's own variant.
const ldd = process.platform === "linux" ? spawnSync("ldd", ["--version"], { encoding: "utf8" }) : undefined
const musl =
  existsSync("/etc/alpine-release") || `${ldd?.stdout ?? ""}${ldd?.stderr ?? ""}`.toLowerCase().includes("musl")
const libc = musl ? "-musl" : ""
const hostBase = `shuvcode-${process.platform}-${process.arch}`
const hostDependency = `${hostBase}${libc}`
const supported =
  (process.platform === "darwin" || process.platform === "linux") &&
  (process.arch === "x64" || process.arch === "arm64")

async function install(input: {
  readonly version: string
  readonly dependencies: Record<string, string>
  readonly installed: Record<string, { readonly version: string; readonly script: string }>
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-launcher-case-"))
  directories.push(root)
  await mkdir(path.join(root, "bin"), { recursive: true })
  await copyFile(path.join(import.meta.dir, "../script/launcher.mjs"), path.join(root, "bin", "launcher.mjs"))
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "shuvcode",
      version: input.version,
      bin: { shuvcode: "./bin/launcher.mjs" },
      optionalDependencies: input.dependencies,
    }),
  )
  await Promise.all(
    Object.entries(input.installed).map(async ([name, item]) => {
      const packageRoot = path.join(root, "node_modules", name)
      await mkdir(path.join(packageRoot, "bin"), { recursive: true })
      await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name, version: item.version }))
      await writeFile(path.join(packageRoot, "bin", "shuvcode"), `#!/usr/bin/env node\n${item.script}\n`)
      await chmod(path.join(packageRoot, "bin", "shuvcode"), 0o755)
    }),
  )
  const child = Bun.spawn(["node", path.join(root, "bin", "launcher.mjs")], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

test.skipIf(process.platform === "win32")(
  "launches the installed platform binary without lifecycle scripts",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-launcher-"))
    directories.push(root)
    const platform = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined
    if (!platform) throw new Error(`Unsupported test platform: ${process.platform}`)
    const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : undefined
    if (!arch) throw new Error(`Unsupported test architecture: ${process.arch}`)
    const dependency = `shuvcode-${platform}-${arch}${libc}`
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
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: dependency, version: "2.0.0-alpha-2" }),
    )
    await writeFile(
      path.join(packageRoot, "bin", "shuvcode"),
      "#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\nprocess.exit(23)\n",
    )
    await chmod(path.join(packageRoot, "bin", "shuvcode"), 0o755)

    const child = Bun.spawn(["node", path.join(root, "bin", "launcher.mjs"), "hello", "two words"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(await child.exited).toBe(23)
    expect(await new Response(child.stdout).text()).toBe('["hello","two words"]\n')
    expect(await new Response(child.stderr).text()).toBe("")
  },
)

test.skipIf(process.platform === "win32")("rejects a stale platform package instead of launching it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-launcher-stale-"))
  directories.push(root)
  const platform = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined
  if (!platform) throw new Error(`Unsupported test platform: ${process.platform}`)
  const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : undefined
  if (!arch) throw new Error(`Unsupported test architecture: ${process.arch}`)
  const dependency = `shuvcode-${platform}-${arch}${libc}`
  const packageRoot = path.join(root, "node_modules", dependency)

  await mkdir(path.join(root, "bin"), { recursive: true })
  await mkdir(path.join(packageRoot, "bin"), { recursive: true })
  await copyFile(path.join(import.meta.dir, "../script/launcher.mjs"), path.join(root, "bin", "launcher.mjs"))
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "shuvcode",
      version: "2.0.25-shuv.1",
      bin: { shuvcode: "./bin/launcher.mjs" },
      optionalDependencies: { [dependency]: "2.0.25-shuv.1" },
    }),
  )
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: dependency, version: "2.0.24-shuv.1" }),
  )
  await writeFile(
    path.join(packageRoot, "bin", "shuvcode"),
    '#!/usr/bin/env node\nconsole.log("stale")\nprocess.exit(0)\n',
  )
  await chmod(path.join(packageRoot, "bin", "shuvcode"), 0o755)

  const child = Bun.spawn(["node", path.join(root, "bin", "launcher.mjs")], {
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(await child.exited).toBe(1)
  expect(await new Response(child.stdout).text()).toBe("")
  const stderr = await new Response(child.stderr).text()
  expect(stderr).toContain(`${dependency} is 2.0.24-shuv.1, expected 2.0.25-shuv.1`)
  expect(stderr).toContain("Reinstall shuvcode@2.0.25-shuv.1")
})

test.skipIf(process.platform !== "linux" || musl || !supported)(
  "never falls back to a musl binary on glibc Linux",
  async () => {
    const result = await install({
      version: "2.3.1-shuv.2",
      dependencies: { [hostBase]: "2.3.1-shuv.2", [`${hostBase}-musl`]: "2.3.1-shuv.2" },
      installed: { [`${hostBase}-musl`]: { version: "2.3.1-shuv.2", script: 'console.log("musl")' } },
    })
    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(`Missing platform binary package ${hostBase}@2.3.1-shuv.2`)
    expect(result.stderr).toContain("Reinstall shuvcode@2.3.1-shuv.2")
  },
)

test.skipIf(!supported)("names the missing platform package and the wrapper version to reinstall", async () => {
  const result = await install({
    version: "2.3.1-shuv.2",
    dependencies: { [hostDependency]: "2.3.1-shuv.2" },
    installed: {},
  })
  expect(result).toEqual({
    code: 1,
    stdout: "",
    stderr: `Missing platform binary package ${hostDependency}@2.3.1-shuv.2. Reinstall shuvcode@2.3.1-shuv.2.\n`,
  })
})

test.skipIf(!supported)("reports a missing binary file inside an installed platform package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-launcher-incomplete-"))
  directories.push(root)
  const packageRoot = path.join(root, "node_modules", hostDependency)
  await mkdir(path.join(root, "bin"), { recursive: true })
  await mkdir(packageRoot, { recursive: true })
  await copyFile(path.join(import.meta.dir, "../script/launcher.mjs"), path.join(root, "bin", "launcher.mjs"))
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "shuvcode",
      version: "2.3.1-shuv.2",
      bin: { shuvcode: "./bin/launcher.mjs" },
      optionalDependencies: { [hostDependency]: "2.3.1-shuv.2" },
    }),
  )
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: hostDependency, version: "2.3.1-shuv.2" }),
  )
  const child = Bun.spawn(["node", path.join(root, "bin", "launcher.mjs")], { stdout: "pipe", stderr: "pipe" })
  expect(await child.exited).toBe(1)
  expect(await new Response(child.stdout).text()).toBe("")
  const stderr = await new Response(child.stderr).text()
  expect(stderr).toContain(`Binary not found at ${path.join(packageRoot, "bin", "shuvcode")}`)
  expect(stderr).toContain("Reinstall shuvcode@2.3.1-shuv.2")
})

test.skipIf(!supported || process.arch !== "x64")(
  "launches a current same-libc variant when another candidate is stale",
  async () => {
    const baseline = `${hostBase}-baseline${libc}`
    const result = await install({
      version: "2.3.1-shuv.2",
      dependencies: { [hostDependency]: "2.3.1-shuv.2", [baseline]: "2.3.1-shuv.2" },
      installed: {
        [hostDependency]: { version: "2.3.1-shuv.1", script: 'console.log("stale")' },
        [baseline]: { version: "2.3.1-shuv.2", script: 'console.log("current")' },
      },
    })
    expect(result).toEqual({ code: 0, stdout: "current\n", stderr: "" })
  },
)
