import { $ } from "bun"
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
  // jj-colocated and other detached-HEAD checkouts have no current branch. A single branch or
  // bookmark at the working copy names the channel; several are ambiguous, so require OPENCODE_CHANNEL.
  const candidates = (await (input.detachedBranches?.() ?? Promise.resolve([])).catch(() => []))
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1)
    throw new Error(
      `Could not determine the build channel: several branches or jj bookmarks point at the working copy (${candidates.join(", ")}). Set OPENCODE_CHANNEL to one of them.`,
    )
  throw new Error(
    "Could not determine the build channel: no current git branch and no branch or jj bookmark points at the working copy. Set OPENCODE_CHANNEL (for example OPENCODE_CHANNEL=integration-v2).",
  )
}

/** Local jj bookmarks on `@`, else on `@-`, else git branches at a detached HEAD. */
export async function detachedBranches(cwd: string) {
  const bookmarks = async (revision: string) => {
    const jj =
      await $`jj log --no-graph --ignore-working-copy -r ${revision} -T 'local_bookmarks.map(|b| b.name()).join("\n")'`
        .cwd(cwd)
        .quiet()
        .nothrow()
    return jj.exitCode === 0 ? jj.text().split("\n").filter(Boolean) : []
  }
  // jj keeps git at a detached HEAD on the working-copy parent, so `@` may carry a newer bookmark.
  const current = await bookmarks("@")
  if (current.length) return current
  const parent = await bookmarks("@-")
  if (parent.length) return parent
  return (await $`git branch --points-at HEAD --format='%(refname:short)'`.cwd(cwd).quiet().nothrow().text())
    .split("\n")
    .filter((name) => name && !name.startsWith("("))
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
