import { $ } from "bun"
import semver from "semver"
import fs from "fs/promises"
import path from "path"

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
  const candidates = (
    await (input.detachedBranches?.() ?? Promise.resolve([])).catch((cause) => {
      throw new Error(
        "Could not determine the build channel: branch or jj bookmark lookup failed. Set OPENCODE_CHANNEL.",
        {
          cause,
        },
      )
    })
  )
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

/** Local jj bookmarks and git branches on `@`, else on `@-`; plain git uses detached HEAD. */
export async function detachedBranches(cwd: string) {
  const branches = async (revision: string, gitDir?: string) =>
    (
      await $`git ${gitDir ? [`--git-dir=${gitDir}`] : []} branch --points-at ${revision} --format='%(refname:short)'`
        .cwd(cwd)
        .quiet()
        .text()
    )
      .split("\n")
      .filter((name) => name && !name.startsWith("("))
  if (!(await jjRepository(path.resolve(cwd)))) return branches("HEAD")
  const gitDir = (await $`jj git root --ignore-working-copy`.cwd(cwd).quiet().text()).trim()

  const bookmarks = async (revision: string) => {
    const jj =
      await $`jj log --no-graph --ignore-working-copy -r ${revision} -T 'commit_id ++ "\t" ++ local_bookmarks.map(|b| b.name()).join("\t") ++ "\n"'`
        .cwd(cwd)
        .quiet()
        .text()
    // --ignore-working-copy avoids snapshotting, but also skips git import. Read git refs
    // at each actual jj commit, not HEAD (which is the parent in colocated repositories).
    const names = await Promise.all(
      jj
        .split("\n")
        .filter(Boolean)
        .map(async (line) => {
          const fields = line.split("\t")
          return [...fields.slice(1).filter(Boolean), ...(await branches(fields[0], gitDir))]
        }),
    )
    return [...new Set(names.flat())]
  }
  // jj keeps git at a detached HEAD on the working-copy parent, so `@` may carry a newer bookmark.
  const current = await bookmarks("@")
  if (current.length) return current
  return bookmarks("@-")
}

async function jjRepository(dir: string): Promise<boolean> {
  const entries = await Promise.all(
    [".jj", ".git"].map((name) =>
      fs.stat(path.join(dir, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      }),
    ),
  )
  if (entries[0]) return true
  const parent = path.dirname(dir)
  if (entries[1] || parent === dir) return false
  return jjRepository(parent)
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
