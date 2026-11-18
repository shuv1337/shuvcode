#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode/script"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "url"
import { parseArgs } from "node:util"
import { preflightForkPublish, requireForkRepository, type ForkDistribution } from "./publish-ownership"
import { publishDistributions, type PublishPhase } from "./publish-order"
import { restoreExecutableBinaries } from "./binary-modes"
import { smokeDistribution } from "./package-smoke"
import { isNpmVersionUploaded, waitForNpmPackages } from "./npm-availability"

const flags = parseArgs({
  options: {
    phase: { type: "string", default: "all" },
    "pack-wrappers": { type: "string" },
    "wrappers-dir": { type: "string" },
  },
}).values
const phase = requirePhase(flags.phase)
// Resolve before chdir so relative paths name the caller's directory.
const packWrappersDir = flags["pack-wrappers"] === undefined ? undefined : path.resolve(flags["pack-wrappers"])
const wrappersDir = flags["wrappers-dir"] === undefined ? undefined : path.resolve(flags["wrappers-dir"])
if (wrappersDir && phase !== "wrappers") throw new Error("--wrappers-dir is only valid with --phase=wrappers")
if (packWrappersDir && phase === "wrappers") throw new Error("--pack-wrappers is not valid with --phase=wrappers")

const repository = requireForkRepository(process.env.GITHUB_REPOSITORY ?? process.env.GH_REPO)
if (Script.version.startsWith("v")) throw new Error(`OPENCODE_VERSION must not start with 'v': ${Script.version}`)
const preflight = await preflightForkPublish(repository, Script.version)
const wrapperNames = preflight.distributions.map((distribution) => distribution.name)

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function pack(directory: string, destination: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(directory)
  await $`bun pm pack --destination ${destination}`.cwd(directory)
  const tarball = path.join(destination, `${name}-${version}.tgz`)
  if (!(await Bun.file(tarball).exists())) throw new Error(`bun pm pack did not write ${tarball}`)
  return tarball
}

async function publishTarball(tarball: string, cwd: string, name: string, version: string) {
  const result = await $`npm publish ${tarball} --access public --tag ${Script.channel} --provenance=false`
    .cwd(cwd)
    .nothrow()
  if (result.exitCode === 0) return
  const stderr = result.stderr.toString()
  if (stderr.includes("cannot publish over") || stderr.includes("previously published")) {
    console.log(`already published ${name}@${version}`)
    return
  }
  throw new Error(`npm publish failed for ${name}@${version} with exit code ${result.exitCode}: ${stderr.trim()}`)
}

async function publish(directory: string, name: string, version: string) {
  if (await isNpmVersionUploaded(name, version)) return console.log(`already published ${name}@${version}`)
  if (wrappersDir && wrapperNames.includes(name)) {
    const tarball = path.join(wrappersDir, `${name}-${version}.tgz`)
    if (!(await Bun.file(tarball).exists())) throw new Error(`Missing staged wrapper tarball: ${tarball}`)
    await publishTarball(tarball, wrappersDir, name, version)
    return
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `${name}-publish-`))
  try {
    const tarball = await pack(directory, tempDir, name, version)
    await publishTarball(tarball, directory, name, version)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
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
        repository: { type: "git", url: "git+https://github.com/shuv1337/shuvcode.git" },
        os: ["darwin", "linux", "win32"],
        cpu: ["arm64", "x64"],
        optionalDependencies: input.binaries,
      },
      null,
      2,
    ),
  )
}

async function verifyDistribution(distribution: ForkDistribution) {
  await restoreExecutableBinaries(distribution)
  await smokeDistribution(distribution)
}

if (phase === "wrappers" && !wrappersDir) {
  for (const distribution of preflight.distributions) await prepareDistribution(distribution)
  for (const distribution of preflight.distributions) await verifyDistribution(distribution)
}

await publishDistributions(
  preflight.distributions,
  {
    prepare: prepareDistribution,
    verify: verifyDistribution,
    packWrappers: async (distributions) => {
      if (!packWrappersDir) return
      await $`mkdir -p ${packWrappersDir}`
      for (const distribution of distributions) {
        const tarball = await pack(
          `${distribution.root}/${distribution.name}`,
          packWrappersDir,
          distribution.name,
          distribution.version,
        )
        console.log(`packed ${tarball}`)
      }
    },
    publish,
    waitForPlatforms: (names, version) => waitForNpmPackages(names, version),
    // Installs resolve `shuvcode@<channel>`, so the channel tag must serve this release too.
    waitForWrappers: (names, version) => waitForNpmPackages(names, version, { expectedTag: Script.channel }),
  },
  phase,
)

function requirePhase(value: string | undefined): PublishPhase {
  if (value === "all" || value === "platforms" || value === "wrappers") return value
  throw new Error(`Invalid --phase: ${value}. Expected all, platforms, or wrappers.`)
}
