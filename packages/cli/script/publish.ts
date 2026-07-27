#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import { UpdateArtifact } from "../../../script/update-artifact"
import { currentRepository, publishPlan } from "../../../script/publish-plan"
import {
  forkBunPlatformPackages,
  forkNodePlatformPackages,
  planPlatformPackages,
  preflightForkNpmOwnership,
} from "./publish-ownership"

const repository = currentRepository()
const plan = publishPlan(repository)
await preflightForkNpmOwnership(repository)

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  if (await published(name, version)) return console.log(`already published ${name}@${version}`)
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  await $`bun pm pack`.cwd(dir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(dir)
}

async function planDistribution(input: {
  root: string
  name: string
  binary: string
  packagePrefix: string
  packages: readonly string[]
}) {
  const binaries: Record<string, string> = {}
  for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: input.root })) {
    const item = await Bun.file(`${input.root}/${filepath}`).json()
    if (!item.name.startsWith(input.packagePrefix)) continue
    binaries[item.name] = item.version
  }
  console.log(input.name, "binaries", binaries)
  return { ...input, ...planPlatformPackages(input.packages, binaries) }
}

async function publishDistribution(input: Awaited<ReturnType<typeof planDistribution>>) {
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

  await Promise.all(
    Object.entries(input.binaries).map(([name, version]) => publish(`${input.root}/${name}`, name, version)),
  )
  await publish(`${input.root}/${input.name}`, input.name, input.version)
}

const distributions = await Promise.all([
  planDistribution({
    root: "./dist",
    name: pkg.name,
    binary: "shuvcode",
    packagePrefix: "shuvcode-",
    packages: forkBunPlatformPackages,
  }),
  planDistribution({
    root: "./dist/node",
    name: "shuvcode-node",
    binary: "shuvcode-node",
    packagePrefix: "shuvcode-node-",
    packages: forkNodePlatformPackages,
  }),
])
for (const distribution of distributions) await publishDistribution(distribution)
if (plan.updateArtifacts) {
  await UpdateArtifact.publish({
    channel: Script.channel,
    name: "cli",
    distribution: "npm",
    version: Script.version,
    metadata: {},
  })
}
