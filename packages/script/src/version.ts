import semver from "semver"

const base = "2.0.0"

export function nextForkVersion(version: string) {
  const parsed = semver.parse(version)
  if (!parsed) throw new Error(`Invalid release version: ${version}`)
  if (`${parsed.major}.${parsed.minor}.${parsed.patch}` !== base) return `${base}-1`
  const iteration =
    parsed.prerelease.length === 1 && typeof parsed.prerelease[0] === "number" ? parsed.prerelease[0] : 0
  return `${base}-${iteration + 1}`
}
