import { chmod, stat } from "node:fs/promises"
import path from "node:path"
import type { ForkDistribution } from "./publish-ownership"

/**
 * Restores the executable bit on every platform package binary before the
 * distributions are verified or published. Release builds produce executable
 * binaries, but the GitHub Actions artifact round-trip between the build and
 * publish jobs does not preserve file modes, and platform packages declare no
 * `bin` entry, so the mode recorded in the packed tarball is the only thing
 * that makes an installed binary executable.
 */
export async function restoreExecutableBinaries(distribution: ForkDistribution) {
  for (const name of distribution.packages) {
    const windows = name.startsWith(`${distribution.packagePrefix}windows-`)
    const binary = path.join(
      distribution.root,
      name,
      "bin",
      windows ? `${distribution.binary}.exe` : distribution.binary,
    )
    const info = await stat(binary).catch((cause: unknown) => {
      throw new Error(`Platform binary is missing: ${binary}`, { cause })
    })
    if (!info.isFile()) throw new Error(`Platform binary is not a file: ${binary}`)
    if (!windows) await chmod(binary, 0o755)
  }
}
