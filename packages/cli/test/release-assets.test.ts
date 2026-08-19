import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildTargets, targetName } from "../script/build-targets"
import { archiveReleaseAssets, releaseAssetNames, verifyUploadedReleaseAssets } from "../script/release-assets"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test.skipIf(process.platform === "win32")(
  "archives Linux targets as tarballs and macOS and Windows targets as zip files",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shuvcode-release-assets-"))
    roots.push(root)
    const dist = path.join(root, "dist")
    for (const target of buildTargets.map(targetName)) {
      const bin = path.join(dist, target, "bin")
      await mkdir(bin, { recursive: true })
      const binary = path.join(bin, target.startsWith("shuvcode-windows-") ? "shuvcode.exe" : "shuvcode")
      await Bun.write(binary, target)
      if (!target.startsWith("shuvcode-windows-")) await chmod(binary, 0o755)
      await Bun.write(path.join(bin, "chunk.js.map"), "not a release binary")
    }
    await mkdir(path.join(dist, "shuvcode"), { recursive: true })
    await mkdir(path.join(dist, "node", "shuvcode-node-linux-x64"), { recursive: true })

    const assets = await archiveReleaseAssets(dist)
    const names = assets.map((asset) => path.basename(asset))

    expect(names).toEqual(releaseAssetNames)
    expect(await archiveEntries(assets[names.indexOf("shuvcode-darwin-arm64.zip")])).toEqual(["shuvcode"])
    expect(await archiveEntries(assets[names.indexOf("shuvcode-linux-x64.tar.gz")])).toEqual(["shuvcode"])
    expect(await archiveEntries(assets[names.indexOf("shuvcode-windows-x64.zip")])).toEqual(["shuvcode.exe"])

    await chmod(path.join(dist, "shuvcode-linux-arm64", "bin", "shuvcode"), 0o644)
    expect(await failureMessage(archiveReleaseAssets(dist))).toContain("Standalone CLI target is not executable")
  },
)

test("fails when standalone build artifacts are missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shuvcode-release-assets-"))
  roots.push(root)
  expect(await failureMessage(archiveReleaseAssets(root))).toContain("Missing standalone CLI targets")
})

test("requires the exact non-empty GitHub asset set", () => {
  const assets = releaseAssetNames.map((name) => ({ name, size: 1 }))
  expect(verifyUploadedReleaseAssets(assets)).toEqual(releaseAssetNames)
  expect(() => verifyUploadedReleaseAssets(assets.slice(1))).toThrow("Missing GitHub release assets")
  expect(() => verifyUploadedReleaseAssets([...assets, { name: "extra.zip", size: 1 }])).toThrow(
    "Unexpected GitHub release assets",
  )
  expect(() => verifyUploadedReleaseAssets(assets.map((asset, index) => ({ ...asset, size: index ? 1 : 0 })))).toThrow(
    "Empty GitHub release assets",
  )
  expect(() => verifyUploadedReleaseAssets([...assets, assets[0]])).toThrow("Duplicate GitHub release assets")
})

async function failureMessage(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
}

async function archiveEntries(asset: string) {
  const command = asset.endsWith(".tar.gz") ? ["tar", "-tzf", asset] : ["unzip", "-Z1", asset]
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(stderr.trim())
  return stdout
    .split("\n")
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter(Boolean)
}
