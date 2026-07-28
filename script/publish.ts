#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"
import { UpdateArtifact } from "./update-artifact"
import { currentRepository, forkRepository, publishPlan } from "./publish-plan"
import { preflightForkPublish } from "../packages/cli/script/publish-ownership"

console.log("=== publishing ===\n")

const dir = fileURLToPath(new URL("..", import.meta.url))
const tag = `v${Script.version}`
const repository = currentRepository()
const plan = publishPlan(repository)
if (repository === forkRepository) await preflightForkPublish(repository, Script.version)
process.chdir(dir)

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

for (const name of plan.packages) {
  console.log(`\n=== ${name} ===\n`)
  await $`bun ${`./packages/${name}/script/publish.ts`}`
}

if (Script.release && plan.desktop) {
  await $`bun ./packages/desktop/scripts/finalize-latest-json.ts`
  await $`bun ./packages/desktop/scripts/finalize-latest-yml.ts`
}

if (Script.release && !Script.preview) {
  await $`git commit -am "release: ${tag}"`
  await $`git tag -d ${tag}`.nothrow()
  await $`git tag ${tag}`
  await $`git push origin refs/tags/${tag} --force-with-lease --no-verify`
}

if (Script.release && !Script.preview && repository !== forkRepository) {
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`git fetch origin`
  await $`git checkout -B dev origin/dev`
  await prepareReleaseFiles()
  await $`git commit -am "sync release versions for ${tag}"`
  await $`git push origin HEAD:dev --no-verify`
}

if (Script.release) {
  const repo = repository === forkRepository ? repository : (process.env.GH_REPO ?? repository)
  if (!repo) throw new Error("Release repository is required")
  await $`gh release edit ${tag} --draft=false --repo ${repo}`
  if (plan.updateArtifacts) {
    await UpdateArtifact.publish({
      channel: Script.channel,
      name: "desktop",
      distribution: "github",
      version: Script.version,
      metadata: await UpdateArtifact.desktopMetadata(Script.version, repo),
    })
  }
}
