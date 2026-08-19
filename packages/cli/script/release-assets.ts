import { mkdir, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { buildTargets, targetName } from "./build-targets"

export const releaseAssetNames = buildTargets
  .map((target) => targetName(target) + (target.os === "linux" ? ".tar.gz" : ".zip"))
  .toSorted()

export type UploadedReleaseAsset = { name: string; size: number }

export async function archiveReleaseAssets(dist: string) {
  const available = new Set(
    (await readdir(dist, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  )
  const targets = buildTargets.map(targetName)
  const missing = targets.filter((target) => !available.has(target))
  if (missing.length) throw new Error(`Missing standalone CLI targets: ${missing.join(", ")}`)

  const output = path.join(dist, "release")
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })

  const assets: string[] = []
  for (const target of buildTargets) {
    const name = targetName(target)
    const bin = path.join(dist, name, "bin")
    const binary = target.os === "win32" ? "shuvcode.exe" : "shuvcode"
    const file = path.join(bin, binary)
    if (!(await Bun.file(file).exists())) throw new Error(`Standalone CLI target has no binary: ${name}`)
    const info = await stat(file)
    if (!info.isFile()) throw new Error(`Standalone CLI target has no binary: ${name}`)
    if (target.os !== "win32" && !(info.mode & 0o111)) {
      throw new Error(`Standalone CLI target is not executable: ${name}`)
    }
    const asset = path.join(output, name + (target.os === "linux" ? ".tar.gz" : ".zip"))
    const command = target.os === "linux"
      ? ["tar", "-czf", asset, "-C", bin, binary]
      : ["zip", "-q", asset, binary]
    const process = Bun.spawn(command, {
      cwd: target.os === "linux" ? undefined : bin,
      stdout: "ignore",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
    if (exitCode !== 0) throw new Error(`Failed to archive ${name}: ${stderr.trim()}`)
    if ((await stat(asset)).size === 0) throw new Error(`Release asset is empty: ${asset}`)
    assets.push(asset)
  }
  assets.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
  return assets
}

export function verifyUploadedReleaseAssets(assets: readonly UploadedReleaseAsset[]) {
  const expected = new Set(releaseAssetNames)
  const duplicates = assets.filter((asset, index) => assets.findIndex((item) => item.name === asset.name) !== index)
  if (duplicates.length)
    throw new Error(`Duplicate GitHub release assets: ${duplicates.map((asset) => asset.name).join(", ")}`)
  const unexpected = assets.filter((asset) => !expected.has(asset.name))
  if (unexpected.length)
    throw new Error(`Unexpected GitHub release assets: ${unexpected.map((asset) => asset.name).join(", ")}`)
  const missing = releaseAssetNames.filter((name) => !assets.some((asset) => asset.name === name))
  if (missing.length) throw new Error(`Missing GitHub release assets: ${missing.join(", ")}`)
  const empty = assets.filter((asset) => asset.size <= 0)
  if (empty.length) throw new Error(`Empty GitHub release assets: ${empty.map((asset) => asset.name).join(", ")}`)
  return releaseAssetNames
}

if (import.meta.main) {
  const dist = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "..", "dist"))
  for (const asset of await archiveReleaseAssets(dist)) console.log(asset)
}
