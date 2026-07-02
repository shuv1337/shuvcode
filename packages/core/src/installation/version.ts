import semver from "semver"

declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"

export type ForkVersion = { base: string; iteration: number }

/** Parse `1.2.3-4` fork builds; optional leading `v` is stripped. */
export function parseForkVersion(version: string): ForkVersion | undefined {
  const match = version.replace(/^v/, "").match(/^(\d+\.\d+\.\d+)-(\d+)$/)
  if (!match) return
  return { base: match[1], iteration: Number(match[2]) }
}

const fork = parseForkVersion

/** True when `left` is strictly newer than `right`, with fork iteration awareness. */
export function isVersionGreater(left: string, right: string) {
  const l = left.replace(/^v/, "")
  const r = right.replace(/^v/, "")
  if (l === r) return false

  const leftFork = fork(l)
  const rightFork = fork(r)
  if (leftFork && !rightFork) {
    if (leftFork.base === r) return false
    return semver.gt(leftFork.base, r)
  }
  if (!leftFork && rightFork) {
    if (l === rightFork.base) return false
    return semver.gt(l, rightFork.base)
  }
  if (leftFork && rightFork) {
    if (leftFork.base !== rightFork.base) return semver.gt(leftFork.base, rightFork.base)
    return leftFork.iteration > rightFork.iteration
  }

  if (!semver.valid(l) || !semver.valid(r)) {
    const parse = (value: string) => {
      const [core, prerelease] = value.split("-", 2)
      return { core: core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease }
    }
    const a = parse(l)
    const b = parse(r)
    for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
      const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
      if (difference) return difference > 0
    }
    if (a.prerelease === b.prerelease) return false
    if (!a.prerelease) return true
    if (!b.prerelease) return false
    return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0
  }

  return semver.gt(l, r)
}
