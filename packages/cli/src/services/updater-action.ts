export type Policy = "disable" | "notify" | "auto"
export type Action = "none" | "notify" | "auto"

const maximumComponent = "9007199254740991"
const versionPattern =
  /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function action(current: string, latest: string, policy: Policy): Action {
  if (policy === "disable") return "none"
  const currentVersion = parseReleaseVersion(current)
  const latestVersion = parseReleaseVersion(latest)
  if (!currentVersion || !latestVersion || sameRelease(currentVersion, latestVersion)) return "none"
  const currentFork = forkVersion(currentVersion)
  if (currentFork) {
    // Fork builds carry a bare numeric prerelease. They must never cross back to an
    // upstream release, and only ever move forward along the fork line.
    const latestFork = forkVersion(latestVersion)
    if (!latestFork) return "none"
    const available =
      currentVersion.core === latestVersion.core
        ? latestFork > currentFork
        : compareCore(latestVersion.core, currentVersion.core) > 0
    if (!available) return "none"
  }
  return policy
}

export function parseReleaseVersion(input: string) {
  if (input.length > 256) return
  const match = input.trim().match(versionPattern)
  if (!match) return
  if ([match[1], match[2], match[3]].some(invalidComponent)) return
  if (
    match[4]
      ?.split(".")
      .some((identifier) => identifier.length > 1 && identifier.startsWith("0") && /^[0-9]+$/.test(identifier))
  )
    return
  return {
    major: match[1],
    core: `${match[1]}.${match[2]}.${match[3]}`,
    prerelease: match[4]?.split(".") ?? [],
  }
}

function sameRelease(current: NonNullable<ReturnType<typeof parseReleaseVersion>>, latest: typeof current) {
  if (current.core !== latest.core || current.prerelease.length !== latest.prerelease.length) return false
  return current.prerelease.every((identifier, index) => {
    const other = latest.prerelease[index]
    if (identifier === other) return true
    // semver compares oversized numeric prerelease identifiers after numeric coercion.
    return /^[0-9]+$/.test(identifier) && /^[0-9]+$/.test(other) && Number(identifier) === Number(other)
  })
}

function invalidComponent(value: string) {
  if (value.length > 1 && value.startsWith("0")) return true
  if (value.length !== maximumComponent.length) return value.length > maximumComponent.length
  return value > maximumComponent
}

function forkVersion(version: NonNullable<ReturnType<typeof parseReleaseVersion>>) {
  if (version.prerelease.length !== 1 || !/^[0-9]+$/.test(version.prerelease[0])) return
  return BigInt(version.prerelease[0])
}

function compareCore(left: string, right: string) {
  const leftComponents = left.split(".").map(BigInt)
  const rightComponents = right.split(".").map(BigInt)
  const index = leftComponents.findIndex((value, index) => value !== rightComponents[index])
  if (index === -1) return 0
  return leftComponents[index] > rightComponents[index] ? 1 : -1
}
