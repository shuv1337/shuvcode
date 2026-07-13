import semver from "semver"

export function bumpVersion(version: string, bump?: string) {
  const parsed = semver.parse(version)
  if (!parsed) throw new Error(`Invalid release version: ${version}`)
  const type = bump?.toLowerCase()
  if (type === "major") return `${parsed.major + 1}.0.0`
  if (type === "minor") return `${parsed.major}.${parsed.minor + 1}.0`
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}
