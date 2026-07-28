import type { ForkDistribution } from "./publish-ownership"

export async function publishDistributions(
  distributions: readonly ForkDistribution[],
  operation: {
    prepare(distribution: ForkDistribution): Promise<void>
    publish(root: string, name: string, version: string): Promise<void>
  },
) {
  for (const distribution of distributions) await operation.prepare(distribution)
  for (const distribution of distributions) {
    for (const name of distribution.packages) {
      await operation.publish(`${distribution.root}/${name}`, name, distribution.binaries[name])
    }
  }
  for (const distribution of distributions) {
    await operation.publish(`${distribution.root}/${distribution.name}`, distribution.name, distribution.version)
  }
}
