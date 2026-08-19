import { $ } from "bun"
import { fileURLToPath } from "url"
import { forkRepository, publishPlan } from "../../../script/publish-plan"
import { buildTargets, targetName } from "./build-targets"

export const expectedNpmMaintainer = "kcrommett"
export const forkBunPlatformPackages = buildTargets.map(targetName)
export const forkNodePlatformPackages = [
  "shuvcode-node-linux-arm64",
  "shuvcode-node-linux-x64",
  "shuvcode-node-darwin-arm64",
  "shuvcode-node-windows-arm64",
  "shuvcode-node-windows-x64",
] as const
export const forkNpmPackages = [
  "shuvcode",
  ...forkBunPlatformPackages,
  "shuvcode-node",
  ...forkNodePlatformPackages,
] as const

export type NpmOwnershipResponse = {
  name: string
  exitCode: number
  stdout: string
}

export type ForkDistribution = {
  root: string
  name: string
  binary: string
  packagePrefix: string
  packages: readonly string[]
  binaries: Readonly<Record<string, string>>
  version: string
}

export function parseNpmMaintainers(stdout: string) {
  const value: unknown = JSON.parse(stdout)
  const entries = Array.isArray(value) ? value : [value]
  return entries.map((entry) => {
    if (typeof entry === "string") {
      const name = entry.match(/^([^\s<]+)/)?.[1]
      if (name) return name
    }
    if (entry && typeof entry === "object" && "name" in entry && typeof entry.name === "string" && entry.name) {
      return entry.name
    }
    throw new Error("npm returned an invalid maintainer entry")
  })
}

export function validateForkNpmOwnership(responses: readonly NpmOwnershipResponse[]) {
  const expected = new Set<string>(forkNpmPackages)
  const seen = new Set<string>()
  for (const response of responses) {
    if (!expected.has(response.name)) throw new Error(`Unexpected npm package in ownership preflight: ${response.name}`)
    if (seen.has(response.name)) throw new Error(`Duplicate npm ownership response: ${response.name}`)
    seen.add(response.name)
    if (response.exitCode !== 0) {
      throw new Error(`npm package is missing or unavailable: ${response.name}`)
    }
    let maintainers: string[]
    try {
      maintainers = parseNpmMaintainers(response.stdout)
    } catch (error) {
      throw new Error(`Could not parse npm maintainers for ${response.name}`, { cause: error })
    }
    if (!maintainers.includes(expectedNpmMaintainer)) {
      throw new Error(`npm package is not maintained by ${expectedNpmMaintainer}: ${response.name}`)
    }
  }
  const missing = forkNpmPackages.filter((name) => !seen.has(name))
  if (missing.length) throw new Error(`Missing npm ownership responses: ${missing.join(", ")}`)
  return forkNpmPackages
}

export function planPlatformPackages(
  expected: readonly string[],
  binaries: Readonly<Record<string, string>>,
  version: string,
) {
  const names = Object.keys(binaries)
  const unexpected = names.filter((name) => !expected.includes(name))
  if (unexpected.length) throw new Error(`Unexpected platform packages: ${unexpected.join(", ")}`)
  const missing = expected.filter((name) => !names.includes(name))
  if (missing.length) throw new Error(`Missing platform packages: ${missing.join(", ")}`)
  const mismatched = names.filter((name) => binaries[name] !== version)
  if (mismatched.length) {
    throw new Error(`Platform package versions do not match release ${version}: ${mismatched.join(", ")}`)
  }
  return { binaries, version }
}

export function planForkNpmPublish(repository: string | undefined, responses: readonly NpmOwnershipResponse[]) {
  const plan = publishPlan(repository)
  if (repository !== forkRepository)
    throw new Error(`Fork npm publishing is not configured for repository: ${repository}`)
  return { plan, packages: validateForkNpmOwnership(responses) }
}

export async function preflightForkNpmOwnership(
  repository: string | undefined,
  viewMaintainers = async (name: string) => {
    const result = await $`npm view ${name} maintainers --json`.quiet().nothrow()
    return { name, exitCode: result.exitCode, stdout: result.stdout.toString() }
  },
) {
  publishPlan(repository)
  if (repository !== forkRepository)
    throw new Error(`Fork npm publishing is not configured for repository: ${repository}`)
  const responses = await Promise.all(forkNpmPackages.map((name) => viewMaintainers(name)))
  return planForkNpmPublish(repository, responses)
}

export async function planDistribution(
  input: Omit<ForkDistribution, "binaries" | "version">,
  version: string,
): Promise<ForkDistribution> {
  const binaries: Record<string, string> = {}
  for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: input.root })) {
    const item = await Bun.file(`${input.root}/${filepath}`).json()
    if (!item.name.startsWith(input.packagePrefix)) continue
    binaries[item.name] = item.version
  }
  return { ...input, ...planPlatformPackages(input.packages, binaries, version) }
}

export async function preflightForkPublish(repository: string | undefined, version: string) {
  const ownership = await preflightForkNpmOwnership(repository)
  const cli = fileURLToPath(new URL("..", import.meta.url))
  const distributions = await Promise.all([
    planDistribution(
      {
        root: `${cli}/dist`,
        name: "shuvcode",
        binary: "shuvcode",
        packagePrefix: "shuvcode-",
        packages: forkBunPlatformPackages,
      },
      version,
    ),
    planDistribution(
      {
        root: `${cli}/dist/node`,
        name: "shuvcode-node",
        binary: "shuvcode-node",
        packagePrefix: "shuvcode-node-",
        packages: forkNodePlatformPackages,
      },
      version,
    ),
  ])
  return { ...ownership, distributions }
}
