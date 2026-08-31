#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { currentRepository, publishPlan } from "./publish-plan"
import {
  decodeReleaseCommit,
  decodeReleaseSummary,
  isPrereleaseVersion,
  latestPublishedTag,
  normalizeReleaseTagTarget,
  planDraftRelease,
  releaseForTag,
  type ReleaseCommit,
  type ReleaseSummary,
} from "./version-plan"

const repository = currentRepository()
publishPlan(repository)
const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()
const tag = `v${Script.version}`

async function prepareForkDraft() {
  const releases = await forkReleases()
  const release = releaseForTag(tag, releases)
  const tagResult = await $`gh api ${`repos/${repository}/git/ref/tags/${tag}`} --jq .object.sha`.quiet().nothrow()
  if (tagResult.exitCode !== 0 && !tagResult.stderr.toString().includes("HTTP 404")) {
    throw new Error(`Could not inspect tag ${tag}: ${tagResult.stderr.toString().trim()}`)
  }
  const tagTarget = tagResult.exitCode === 0 ? tagResult.stdout.toString().trim() : undefined
  const releaseCommit = tagTarget && tagTarget !== sha ? await inspectReleaseCommit(tagTarget) : undefined
  const decision = planDraftRelease(tag, sha, release, normalizeReleaseTagTarget(tag, sha, tagTarget, releaseCommit))
  if (decision === "reuse") {
    if (!release) throw new Error(`Draft release planning lost ${tag}`)
    return release
  }

  const previous = latestPublishedTag(releases)
  const notesStart = previous ? ["--notes-start-tag", previous] : []
  const prerelease = isPrereleaseVersion(Script.version) ? ["--prerelease"] : []
  await $`gh release create ${tag} -d --repo ${repository} --target ${sha} --title ${tag} --generate-notes ${notesStart} ${prerelease}`
  let created = releaseForTag(tag, await forkReleases())
  for (let attempt = 0; !created && attempt < 5; attempt++) {
    await Bun.sleep(1000)
    created = releaseForTag(tag, await forkReleases())
  }
  if (!created) throw new Error(`GitHub did not return the draft release ${tag} after creating it`)
  return created
}

async function inspectReleaseCommit(target: string): Promise<ReleaseCommit | undefined> {
  const fields = "{message:.commit.message,parents:[.parents[].sha]}"
  const result = await $`gh api ${`repos/${repository}/commits/${target}`} --jq ${fields}`.quiet().nothrow()
  if (result.exitCode !== 0) return undefined
  return decodeReleaseCommit(JSON.parse(result.stdout.toString()))
}

async function forkReleases() {
  const fields =
    ".[] | {databaseId:.id,tagName:.tag_name,name:.name,targetCommitish:.target_commitish,isDraft:.draft,publishedAt:.published_at,isPrerelease:.prerelease}"
  const text = await $`gh api --paginate ${`repos/${repository}/releases?per_page=100`} --jq ${fields}`.text()
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => decodeReleaseSummary(JSON.parse(line))) satisfies ReleaseSummary[]
}

if (!Script.preview) {
  const release = await prepareForkDraft()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  await $`gh release create ${tag} -d --prerelease --title ${tag} --repo ${repository}`
  const release = await $`gh release view ${tag} --json tagName,databaseId --repo ${repository}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${repository}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
