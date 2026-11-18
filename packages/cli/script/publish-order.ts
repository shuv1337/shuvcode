import type { ForkDistribution } from "./publish-ownership"

export type PublishPhase = "all" | "platforms" | "wrappers"

/**
 * Wrappers name every platform package as an exact optional dependency, so a wrapper is
 * published only after npm serves all of them. The `platforms` phase stops before the
 * wrappers so they can be smoke-installed against the registry first; the `wrappers`
 * phase publishes those already-built wrappers and expects the caller to have prepared them.
 */
export async function publishDistributions(
  distributions: readonly ForkDistribution[],
  operation: {
    prepare(distribution: ForkDistribution): Promise<void>
    verify?(distribution: ForkDistribution): Promise<void>
    packWrappers?(distributions: readonly ForkDistribution[]): Promise<void>
    publish(root: string, name: string, version: string): Promise<void>
    waitForPlatforms?(names: readonly string[], version: string): Promise<void>
    waitForWrappers?(names: readonly string[], version: string): Promise<void>
  },
  phase: PublishPhase = "all",
) {
  const versions = [...new Set(distributions.map((distribution) => distribution.version))]
  if (versions.length > 1) throw new Error(`Distributions disagree on the release version: ${versions.join(", ")}`)
  const version = versions[0] ?? ""
  const platformNames = distributions.flatMap((distribution) => distribution.packages)
  const wrapperNames = distributions.map((distribution) => distribution.name)

  if (phase !== "wrappers") {
    for (const distribution of distributions) await operation.prepare(distribution)
    for (const distribution of distributions) await operation.verify?.(distribution)
    await operation.packWrappers?.(distributions)
    for (const distribution of distributions) {
      for (const name of distribution.packages) {
        await operation.publish(`${distribution.root}/${name}`, name, distribution.binaries[name])
      }
    }
    await operation.waitForPlatforms?.(platformNames, version)
    if (phase === "platforms") return
  }
  if (phase === "wrappers") await operation.waitForPlatforms?.(platformNames, version)
  for (const distribution of distributions) {
    await operation.publish(`${distribution.root}/${distribution.name}`, distribution.name, distribution.version)
  }
  await operation.waitForWrappers?.(wrapperNames, version)
}
