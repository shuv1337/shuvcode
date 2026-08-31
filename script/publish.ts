#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"
import path from "path"
import { currentRepository, publishPlan } from "./publish-plan"
import { archiveReleaseAssets } from "../packages/cli/script/release-assets"
import { restoreExecutableBinaries } from "../packages/cli/script/binary-modes"
import { preflightForkPublish } from "../packages/cli/script/publish-ownership"
import { publishDraftRelease, replaceDraftReleaseAssets } from "./github-release"
import { isPrereleaseVersion } from "./version-plan"

console.log("=== publishing ===\n")

const dir = fileURLToPath(new URL("..", import.meta.url))
const tag = `v${Script.version}`
const repository = currentRepository()
const plan = publishPlan(repository)
const source = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()
const releaseID = releaseDatabaseID()
const prerelease = isPrereleaseVersion(Script.version)
const preflight = await preflightForkPublish(repository, Script.version)
process.chdir(dir)

function releaseDatabaseID(): number | undefined {
  const value = process.env.OPENCODE_RELEASE
  if (!value) return undefined
  const id = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid GitHub release ID: ${value}`)
  }
  return id
}

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

async function prepareReleaseFiles() {
  for (const file of pkgjsons) {
    let pkg = await Bun.file(file).text()
    pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
    console.log("updated:", file)
    await Bun.file(file).write(pkg)
  }

  await $`bun install`
}

if (Script.release && !Script.preview) {
  await $`git fetch origin --tags`
  await $`git switch --detach`
}

await prepareReleaseFiles()

const releaseAssets = await (async () => {
  if (!Script.release || !preflight) return []
  const distribution = preflight.distributions.find((item) => item.name === "shuvcode")
  if (!distribution) throw new Error("Fork publish plan is missing the standalone CLI distribution")
  await restoreExecutableBinaries(distribution)
  return archiveReleaseAssets(path.join(dir, "packages", "cli", "dist"))
})()

if (Script.release) {
  if (!releaseID) throw new Error("Fork release publication requires a GitHub release ID")
  await replaceDraftReleaseAssets({
    repository,
    databaseId: releaseID,
    tag,
    target: source,
    prerelease,
    files: releaseAssets,
  })
}

for (const name of plan.packages) {
  console.log(`\n=== ${name} ===\n`)
  await $`bun ${`./packages/${name}/script/publish.ts`}`
}

if (Script.release && !Script.preview) {
  await $`git commit -am "release: ${tag}"`
  await $`git tag -d ${tag}`.nothrow()
  await $`git tag ${tag}`
  await $`git push origin refs/tags/${tag} --force-with-lease --no-verify`
}

if (Script.release) {
  if (!releaseID) throw new Error("Fork release publication requires a GitHub release ID")
  const remoteTarget = await $`gh api ${`repos/${repository}/git/ref/tags/${tag}`} --jq .object.sha`.text()
  const localTarget = await $`git rev-parse ${`refs/tags/${tag}`}`.text()
  if (remoteTarget.trim() !== localTarget.trim()) {
    throw new Error(`Remote tag ${tag} does not match the validated local release commit`)
  }
  await publishDraftRelease({ repository, databaseId: releaseID, tag, target: source, prerelease })
}
