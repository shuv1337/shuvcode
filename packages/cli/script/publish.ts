#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import { currentRepository, publishPlan } from "../../../script/publish-plan"
import { preflightForkPublish, type ForkDistribution } from "./publish-ownership"
import { publishDistributions } from "./publish-order"
import { restoreExecutableBinaries } from "./binary-modes"
import { smokeDistribution } from "./package-smoke"

const repository = currentRepository()
publishPlan(repository)
const preflight = await preflightForkPublish(repository, Script.version)

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  if (await published(name, version)) return console.log(`already published ${name}@${version}`)
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  await $`bun pm pack`.cwd(dir)
  await $`npm publish *.tgz --access public --tag ${Script.channel} --provenance=false`.cwd(dir)
}

async function prepareDistribution(input: ForkDistribution) {
  console.log(input.name, "binaries", input.binaries)
  await restoreExecutableBinaries(input)
  await $`rm -rf ${input.root}/${input.name}`
  await $`mkdir -p ${input.root}/${input.name}/bin`
  await $`cp ./script/launcher.mjs ${input.root}/${input.name}/bin/launcher.mjs`
  const client = input.name === "shuvcode"
  if (client) {
    await $`bun run --cwd ../client build:promise`
    await $`cp -R ../client/dist-promise/promise ${input.root}/${input.name}/client`
    const result = await Bun.build({
      entrypoints: ["../client/src/promise/index.ts"],
      outdir: `${input.root}/${input.name}/client`,
      target: "node",
      format: "esm",
      minify: true,
    })
    if (!result.success) throw new AggregateError(result.logs, "Failed to bundle Promise client")
  }
  await Bun.file(`${input.root}/${input.name}/package.json`).write(
    JSON.stringify(
      {
        name: input.name,
        type: "module",
        bin: { [input.binary]: "./bin/launcher.mjs" },
        files: client ? ["bin", "client"] : ["bin"],
        exports: client ? { "./client": { types: "./client/index.d.ts", import: "./client/index.js" } } : undefined,
        version: input.version,
        license: pkg.license,
        repository: { type: "git", url: "git+https://github.com/Latitudes-Dev/shuvcode.git" },
        os: ["darwin", "linux", "win32"],
        cpu: ["arm64", "x64"],
        optionalDependencies: input.binaries,
      },
      null,
      2,
    ),
  )
}

await publishDistributions(preflight.distributions, {
  prepare: prepareDistribution,
  verify: async (distribution) => {
    await restoreExecutableBinaries(distribution)
    await smokeDistribution(distribution)
  },
  publish,
})
