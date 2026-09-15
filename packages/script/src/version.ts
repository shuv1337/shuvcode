import semver from "semver"

// Fork releases are always `<upstream base>-shuv.<n>`: a fork-only fix (`-shuv.2`)
// sorts above the previous fork release and below the next upstream base, and a
// bare upstream version can never be published under the fork's package name.
const suffix = "shuv"

export async function resolveChannel(input: {
  readonly channel?: string
  readonly bump?: string
  readonly version?: string
  readonly branch: () => Promise<string>
}) {
  if (input.channel?.trim()) return input.channel.trim()
  if (input.bump) return "latest"
  if (input.version && !input.version.startsWith("0.0.0-")) return "latest"
  return (await input.branch().catch(() => "")).trim() || "local"
}

/** The `<base>` and `<n>` of a `<base>-shuv.<n>` version, or undefined for anything else. */
export function parseForkVersion(version: string) {
  const parsed = semver.parse(version)
  if (!parsed) return
  if (parsed.prerelease[0] !== suffix) return
  const iteration = parsed.prerelease[1]
  if (parsed.prerelease.length !== 2 || typeof iteration !== "number") return
  return { base: `${parsed.major}.${parsed.minor}.${parsed.patch}`, iteration }
}

/** Next `<base>-shuv.<n>` after `published`; the counter restarts when the upstream base moves. */
export function nextForkVersion(input: { readonly base: string; readonly published?: string }) {
  const base = semver.parse(input.base)
  if (!base || base.prerelease.length) throw new Error(`Invalid upstream base version: ${input.base}`)
  if (input.published !== undefined && !semver.valid(input.published))
    throw new Error(`Invalid published version: ${input.published}`)
  const core = `${base.major}.${base.minor}.${base.patch}`
  const published = input.published === undefined ? undefined : parseForkVersion(input.published)
  const iteration = published?.base === core ? published.iteration : 0
  return `${core}-${suffix}.${iteration + 1}`
}
