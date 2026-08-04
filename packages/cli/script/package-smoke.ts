import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ForkDistribution } from "./publish-ownership"

export async function smokeDistribution(distribution: ForkDistribution) {
  const root = await mkdtemp(path.join(os.tmpdir(), `${distribution.name}-package-smoke-`))
  try {
    const packs = path.join(root, "packs")
    await Bun.write(path.join(root, "package.json"), '{"private":true,"type":"module"}\n')
    await Bun.$`mkdir -p ${packs}`.quiet()

    const compatible = distribution.packages.filter((name) => {
      const suffix = name.slice(distribution.packagePrefix.length)
      const platform = process.platform === "win32" ? "windows" : process.platform
      return suffix.startsWith(`${platform}-${process.arch}`)
    })
    if (compatible.length === 0) throw new Error(`No host package exists for ${distribution.name}`)

    const roots = [
      `${distribution.root}/${distribution.name}`,
      ...compatible.map((name) => `${distribution.root}/${name}`),
    ]
    const archives = roots.map((directory) => {
      run("npm", ["pack", "--pack-destination", packs], directory)
      return path.join(packs, `${path.basename(directory)}-${distribution.version}.tgz`)
    })
    run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", ...archives], root)

    const installed = path.join(root, "node_modules", distribution.name)
    const manifest: unknown = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"))
    if (!isRecord(manifest)) throw new Error(`${distribution.name} has no manifest`)
    if (!("version" in manifest) || manifest.version !== distribution.version)
      throw new Error(`Installed ${distribution.name} version does not match`)
    if (!("files" in manifest) || !Array.isArray(manifest.files) || !manifest.files.includes("bin"))
      throw new Error(`${distribution.name} does not declare its bin files`)
    if (!isRecord(manifest.bin)) throw new Error(`${distribution.name} does not declare its binary`)
    const binary = manifest.bin[distribution.binary]
    if (typeof binary !== "string") throw new Error(`${distribution.name} does not declare its binary`)
    await exists(path.join(installed, binary))

    if (distribution.name !== "shuvcode") return
    if (!manifest.files.includes("client")) throw new Error("shuvcode does not declare its client files")
    if (!isRecord(manifest.exports)) throw new Error("shuvcode does not declare exports")
    const client = manifest.exports["./client"]
    if (!isRecord(client)) {
      throw new Error("shuvcode does not declare its Promise client export")
    }
    if (typeof client.import !== "string" || typeof client.types !== "string")
      throw new Error("shuvcode Promise client export targets are invalid")
    await Promise.all([exists(path.join(installed, client.import)), exists(path.join(installed, client.types))])
    const clientTypes = await readFile(
      path.join(path.dirname(path.join(installed, client.types)), "generated/types.d.ts"),
      "utf8",
    )
    if (!clientTypes.includes("export type SessionPolicy =") || !clientTypes.includes("policy?: SessionPolicy"))
      throw new Error("shuvcode Promise client does not expose session tool policy")
    const module = await import(path.join(installed, client.import))
    const api = module.OpenCode.make({ baseUrl: "http://127.0.0.1" })
    for (const [group, method] of [
      ["health", "get"],
      ["auth", "status"],
      ["session", "create"],
      ["event", "subscribe"],
    ] as const) {
      if (typeof api[group]?.[method] !== "function") throw new Error(`Missing client API: ${group}.${method}`)
    }

    const help = run(path.join(root, "node_modules", ".bin", "shuvcode"), ["serve", "--help"], root)
    if (!help.includes("--stdio")) throw new Error("Installed CLI does not advertise serve --stdio")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function exists(file: string) {
  await stat(file)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}: ${result.stderr}`)
  return result.stdout
}
