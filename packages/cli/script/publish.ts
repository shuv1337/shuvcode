#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import { UpdateArtifact } from "../../../script/update-artifact"
import { currentRepository, publishPlan } from "../../../script/publish-plan"
import { preflightForkPublish, type ForkDistribution } from "./publish-ownership"
import { publishDistributions } from "./publish-order"

const repository = currentRepository()
const plan = publishPlan(repository)
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
  await $`mkdir -p ${input.root}/${input.name}/bin`
  await $`cp ./script/postinstall.mjs ${input.root}/${input.name}/postinstall.mjs`
  await Bun.file(`${input.root}/${input.name}/bin/${input.binary}.exe`).write(
    [
      `echo "Error: ${input.name}'s postinstall script was not run." >&2`,
      'echo "" >&2',
      'echo "This occurs when installation scripts are disabled." >&2',
      'echo "Run the package postinstall script or reinstall with scripts enabled." >&2',
      "exit 1",
      "",
    ].join("\n"),
  )
  await Bun.file(`${input.root}/${input.name}/package.json`).write(
    JSON.stringify(
      {
        name: input.name,
        bin: { [input.binary]: `./bin/${input.binary}.exe` },
        scripts: { postinstall: "node ./postinstall.mjs" },
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

await publishDistributions(preflight.distributions, { prepare: prepareDistribution, publish })
if (plan.updateArtifacts) {
  await UpdateArtifact.publish({
    channel: Script.channel,
    name: "cli",
    distribution: "npm",
    version: Script.version,
    metadata: {},
  })
}
