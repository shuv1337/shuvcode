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
  readonly github?: { readonly headRef?: string; readonly refName?: string; readonly refType?: string }
  readonly detachedBranches?: () => Promise<readonly string[]>
}) {
  if (input.channel?.trim()) return input.channel.trim()
  if (input.bump) return "latest"
  if (input.version && !input.version.startsWith("0.0.0-")) return "latest"
  const branch = (await input.branch().catch(() => "")).trim()
  if (branch) return branch
  // GitHub Actions checks out PRs at a detached merge commit that no local branch points at.
  if (input.github?.headRef?.trim()) return input.github.headRef.trim()
  if (input.github?.refType === "branch" && input.github.refName?.trim()) return input.github.refName.trim()
  // jj-colocated and other detached-HEAD checkouts have no current branch. When several
  // branches or bookmarks point at the commit, pick the lexicographically first one so the
  // channel is deterministic; set OPENCODE_CHANNEL to choose explicitly.
  const candidates = (await (input.detachedBranches?.() ?? Promise.resolve([])).catch(() => []))
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .toSorted()
  if (candidates[0]) return candidates[0]
  throw new Error(
    "Could not determine the build channel: no current git branch and no branch or jj bookmark points at the working copy. Set OPENCODE_CHANNEL (for example OPENCODE_CHANNEL=integration-v2).",
  )
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
