import { $ } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

if (process.versions.bun !== expectedBunVersion) {
  throw new Error(`This script requires bun@${expectedBunVersion}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
}
const CHANNEL = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// Base version is the upstream version without any build suffix (e.g., "1.0.164" from "1.0.164-2")
// This is needed for installing @opencode-ai/plugin which doesn't get republished by the fork
let BASE_VERSION: string | undefined

const VERSION = await (async () => {
  if (env.OPENCODE_VERSION) {
    // Strip any -N suffix to get base version
    BASE_VERSION = env.OPENCODE_VERSION.replace(/-\d+$/, "")
    return env.OPENCODE_VERSION
  }
  // For integration channel, use upstream version + build number for republishes
  if (CHANNEL === "integration") {
    const tagFile = path.resolve(import.meta.dir, "../../../.github/last-synced-tag")
    const baseVersion = await Bun.file(tagFile)
      .text()
      .then((x) => x.trim().replace(/^v/, ""))

    // Store the base version for later use
    BASE_VERSION = baseVersion

    // Check what versions are already published on npm
    const published = await fetch("https://registry.npmjs.org/shuvcode")
      .then((res) => (res.ok ? res.json() : { versions: {} }))
      .then((data: any) => Object.keys(data.versions ?? {}))
      .catch(() => [])

    // Find highest build number for this base version
    let buildNum = 0
    for (const v of published) {
      if (v === baseVersion) buildNum = Math.max(buildNum, 1)
      const match = v.match(new RegExp(`^${baseVersion.replace(/\./g, "\\.")}-(\\d+)$`))
      if (match) buildNum = Math.max(buildNum, parseInt(match[1]) + 1)
    }

    return buildNum > 0 ? `${baseVersion}-${buildNum}` : baseVersion
  }
  if (IS_PREVIEW) {
    const version = `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
    BASE_VERSION = version // Preview versions don't have a separate base
    return version
  }
  const version = await fetch("https://registry.npmjs.org/opencode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.OPENCODE_BUMP?.toLowerCase()
  if (t === "major") {
    BASE_VERSION = `${major + 1}.0.0`
    return BASE_VERSION
  }
  if (t === "minor") {
    BASE_VERSION = `${major}.${minor + 1}.0`
    return BASE_VERSION
  }
  BASE_VERSION = `${major}.${minor}.${patch + 1}`
  return BASE_VERSION
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get baseVersion() {
    return BASE_VERSION ?? VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))
