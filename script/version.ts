#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { currentRepository, forkRepository, publishPlan } from "./publish-plan"
import { planDraftRelease, type DraftRelease } from "./version-plan"

const repository = currentRepository()
publishPlan(repository)
const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()
const tag = `v${Script.version}`

async function prepareForkDraft() {
  const releaseFilter = "{tagName:.tag_name,name:.name,targetCommitish:.target_commitish,isDraft:.draft}"
  const releaseResult = await $`gh api ${`repos/${repository}/releases/tags/${tag}`} --jq ${releaseFilter}`
    .quiet()
    .nothrow()
  if (releaseResult.exitCode !== 0 && !releaseResult.stderr.toString().includes("HTTP 404")) {
    throw new Error(`Could not inspect release ${tag}: ${releaseResult.stderr.toString().trim()}`)
  }
  const release =
    releaseResult.exitCode === 0 ? (JSON.parse(releaseResult.stdout.toString()) as DraftRelease) : undefined
  const tagResult = await $`gh api ${`repos/${repository}/git/ref/tags/${tag}`} --jq .object.sha`.quiet().nothrow()
  if (tagResult.exitCode !== 0 && !tagResult.stderr.toString().includes("HTTP 404")) {
    throw new Error(`Could not inspect tag ${tag}: ${tagResult.stderr.toString().trim()}`)
  }
  const tagTarget = tagResult.exitCode === 0 ? tagResult.stdout.toString().trim() : undefined
  const decision = planDraftRelease(tag, sha, release, tagTarget)
  if (decision === "create") {
    await $`gh release create ${tag} -d --repo ${repository} --target ${sha} --title ${tag} --generate-notes`
  }
  return await $`gh release view ${tag} --repo ${repository} --json tagName,databaseId`.json()
}

if (!Script.preview) {
  const fork = repository === forkRepository
  if (fork) {
    const release = await prepareForkDraft()
    output.push(`release=${release.databaseId}`)
    output.push(`tag=${release.tagName}`)
  }
  if (!fork) {
    await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd())
    const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
    const body = await Bun.file(file)
      .text()
      .catch(() => "No notable changes")
    const dir = process.env.RUNNER_TEMP ?? "/tmp"
    const notesFile = `${dir}/opencode-release-notes.txt`
    await Bun.write(notesFile, body)
    await $`gh release create ${tag} -d --repo ${repository} --target ${sha} --title ${tag} --notes-file ${notesFile}`
    const release = await $`gh release view ${tag} --repo ${repository} --json tagName,databaseId`.json()
    output.push(`release=${release.databaseId}`)
    output.push(`tag=${release.tagName}`)
  }
} else if (Script.channel === "beta") {
  await $`gh release create ${tag} -d --title ${tag} --repo ${repository}`
  const release = await $`gh release view ${tag} --json tagName,databaseId --repo ${repository}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${repository}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
