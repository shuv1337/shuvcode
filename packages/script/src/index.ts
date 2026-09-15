import { $ } from "bun"
import semver from "semver"
import path from "path"
import { nextForkVersion, parseForkVersion, resolveChannel } from "./version.js"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await resolveChannel({
  channel: env.OPENCODE_CHANNEL,
  bump: env.OPENCODE_BUMP,
  version: env.OPENCODE_VERSION,
  branch: () => $`git branch --show-current`.quiet().nothrow().text(),
})
const IS_PREVIEW = CHANNEL !== "latest"

// The CLI manifest records the upstream base this tree was cut from as `<base>-shuv.<n>`.
const cliPkg = await Bun.file(path.resolve(import.meta.dir, "../../cli/package.json")).json()
const forkPackage = "shuvcode"

const VERSION = await (async () => {
  if (env.OPENCODE_VERSION) {
    if (!IS_PREVIEW && !parseForkVersion(env.OPENCODE_VERSION))
      throw new Error(`Release versions must be <upstream>-shuv.<n>, got ${env.OPENCODE_VERSION}`)
    return env.OPENCODE_VERSION
  }
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${previewBuildNumber()}`
  const base = parseForkVersion(cliPkg.version)?.base
  if (!base) throw new Error(`packages/cli/package.json version must be <upstream>-shuv.<n>, got ${cliPkg.version}`)
  const published = await fetch(`https://registry.npmjs.org/${forkPackage}/latest`).then(async (res) => {
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error(res.statusText)
    const data: unknown = await res.json()
    if (typeof data !== "object" || data === null || !("version" in data) || typeof data.version !== "string")
      throw new Error(`Unexpected npm registry response for ${forkPackage}`)
    return data.version
  })
  return nextForkVersion({ base, published })
})()

function previewBuildNumber() {
  const runNumber = process.env["GITHUB_RUN_NUMBER"]
  if (!runNumber) return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  const runAttempt = process.env["GITHUB_RUN_ATTEMPT"]
  if (runAttempt && runAttempt !== "1") return `${runNumber}.${runAttempt}`
  return runNumber
}

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OPENCODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`shuvcode script`, JSON.stringify(Script, null, 2))
