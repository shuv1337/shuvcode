import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { restoreExecutableBinaries } from "../script/binary-modes"
import type { ForkDistribution } from "../script/publish-ownership"

async function distributionFixture(input?: { omitBinary?: string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-binary-modes-"))
  const distribution: ForkDistribution = {
    root,
    name: "shuvcode",
    binary: "shuvcode",
    packagePrefix: "shuvcode-",
    packages: ["shuvcode-linux-x64", "shuvcode-windows-x64"],
    binaries: { "shuvcode-linux-x64": "1.2.3", "shuvcode-windows-x64": "1.2.3" },
    version: "1.2.3",
  }
  for (const name of distribution.packages) {
    if (name === input?.omitBinary) continue
    const windows = name.startsWith("shuvcode-windows-")
    const binary = path.join(root, name, "bin", windows ? "shuvcode.exe" : "shuvcode")
    await mkdir(path.dirname(binary), { recursive: true })
    await writeFile(binary, "binary")
    await chmod(binary, 0o644)
  }
  return distribution
}

test("restores the executable bit on non-windows platform binaries", async () => {
  const distribution = await distributionFixture()
  try {
    await restoreExecutableBinaries(distribution)
    const restored = await stat(path.join(distribution.root, "shuvcode-linux-x64", "bin", "shuvcode"))
    expect(restored.mode & 0o777).toBe(0o755)
  } finally {
    await rm(distribution.root, { recursive: true, force: true })
  }
})

test("verifies windows binaries exist without requiring an executable bit", async () => {
  const distribution = await distributionFixture()
  try {
    await restoreExecutableBinaries(distribution)
    const windows = await stat(path.join(distribution.root, "shuvcode-windows-x64", "bin", "shuvcode.exe"))
    expect(windows.mode & 0o111).toBe(0)
  } finally {
    await rm(distribution.root, { recursive: true, force: true })
  }
})

test("fails closed when a platform binary is missing", async () => {
  const distribution = await distributionFixture({ omitBinary: "shuvcode-linux-x64" })
  try {
    await expect(restoreExecutableBinaries(distribution)).rejects.toThrow(/Platform binary is missing/)
  } finally {
    await rm(distribution.root, { recursive: true, force: true })
  }
})

test("fails closed when a windows platform binary is missing", async () => {
  const distribution = await distributionFixture({ omitBinary: "shuvcode-windows-x64" })
  try {
    await expect(restoreExecutableBinaries(distribution)).rejects.toThrow(/Platform binary is missing/)
  } finally {
    await rm(distribution.root, { recursive: true, force: true })
  }
})
