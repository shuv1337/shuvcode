export const forkRepository = "Latitudes-Dev/shuvcode"

export function publishPlan(repository: string | undefined) {
  if (repository === forkRepository) {
    return {
      packages: ["cli"] as const,
    }
  }
  throw new Error(`Publishing is not configured for repository: ${repository ?? "unknown"}`)
}

export function currentRepository() {
  const repository = process.env.GITHUB_REPOSITORY ?? process.env.GH_REPO
  if (repository !== forkRepository) {
    throw new Error(`Publishing is not configured for repository: ${repository ?? "unknown"}`)
  }
  return repository
}
