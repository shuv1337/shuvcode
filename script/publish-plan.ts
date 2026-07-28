export const forkRepository = "Latitudes-Dev/shuvcode"
export const upstreamRepository = "anomalyco/opencode"

const upstreamPackages = ["schema", "ai", "util", "protocol", "client", "cli", "plugin", "ui"] as const

export function publishPlan(repository: string | undefined) {
  if (repository === forkRepository) {
    return {
      packages: ["cli"] as const,
      desktop: false,
      updateArtifacts: false,
    }
  }
  if (repository === upstreamRepository) {
    return {
      packages: upstreamPackages,
      desktop: true,
      updateArtifacts: true,
    }
  }
  throw new Error(`Publishing is not configured for repository: ${repository ?? "unknown"}`)
}

export function currentRepository() {
  return process.env.GITHUB_REPOSITORY ?? process.env.GH_REPO
}
