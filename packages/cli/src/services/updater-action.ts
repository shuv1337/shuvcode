export type Policy = boolean | "notify"
export type Action = "none" | "upgrade"

const maximumComponent = "9007199254740991"
const versionPattern =
  /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function action(current: string, latest: string, policy: Policy): Action {
  if (policy === false) return "none"
  const currentVersion = parseReleaseVersion(current)
  const latestVersion = parseReleaseVersion(latest)
  if (!currentVersion || !latestVersion || sameRelease(currentVersion, latestVersion)) return "none"
  // Major upgrades are never installed automatically.
  if (currentVersion.major !== latestVersion.major) return "none"
  const currentFork = forkVersion(currentVersion)
  if (currentFork) {
    const latestFork = forkVersion(latestVersion)
    if (!latestFork) return "none"
    if (currentVersion.core === latestVersion.core) return latestFork > currentFork ? "upgrade" : "none"
    return compareCore(latestVersion.core, currentVersion.core) > 0 ? "upgrade" : "none"
  }
  return "upgrade"
}

function parseReleaseVersion(input: string) {
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
