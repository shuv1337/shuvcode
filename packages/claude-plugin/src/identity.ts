import { execFile } from "node:child_process"
import { promisify } from "node:util"

// Fable 5.2 requires >= 2.1.290. Keep the no-install floor at a verified CLI release.
export const fallbackVersion = "2.1.319"
const execute = promisify(execFile)

async function installedVersion() {
  const result = await execute("claude", ["--version"], {
    timeout: 1500,
    killSignal: "SIGKILL",
    maxBuffer: 1024,
    windowsHide: true,
  })
  return result.stdout
}

/** Inject only the subprocess boundary; cache successes and failures, including concurrent callers. */
export function createUserAgent(readVersion: () => Promise<string> = installedVersion) {
  let cached: Promise<string> | undefined
  return () =>
    (cached ??= Promise.resolve()
      .then(readVersion)
      .then((output) => {
        const version = /^(\d+\.\d+\.\d+) \(Claude Code\)$/.exec(output.trim())?.[1]
        if (!version) return fallbackVersion
        const floor = fallbackVersion.split(".").map(Number)
        const difference = version
          .split(".")
          .map((part, index) => Number(part) - floor[index])
          .find((part) => part !== 0)
        return difference !== undefined && difference < 0 ? fallbackVersion : version
      })
      .catch(() => fallbackVersion)
      .then((version) => `claude-cli/${version} (external, cli)`))
}

// No spawn during module loading or for ordinary API-key requests. Node and Bun both support execFile.
export const userAgent = createUserAgent()
