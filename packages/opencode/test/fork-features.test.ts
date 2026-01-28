import { describe, expect, test } from "bun:test"
import path from "path"

type ForkDependency = {
  name: string
  version: string
}

type RequiredDependency = {
  package: string
  dependency: string
  version: string
}

type CriticalCode = {
  file: string
  markers: string[]
}

type ForkFeature = {
  title: string
  status?: string
  files?: string[]
  criticalCode?: CriticalCode[]
  requiredDependencies?: RequiredDependency[]
}

type ForkFeaturesData = {
  forkDependencies?: Record<string, ForkDependency[]>
  features: ForkFeature[]
}

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const FEATURES_PATH = path.join(REPO_ROOT, "script/sync/fork-features.json")
const FEATURES_DATA = (await Bun.file(FEATURES_PATH).json()) as ForkFeaturesData

const FORK_STATUSES = new Set(["fork-only", "reverted-upstream", "cherry-picked"])
const FORK_FEATURES = FEATURES_DATA.features.filter((feature) => FORK_STATUSES.has(feature.status ?? ""))

const MANUAL_MARKERS: Record<string, CriticalCode[]> = {
  "Optimize Ripgrep.tree() for large repositories": [
    {
      file: "packages/opencode/src/file/ripgrep.ts",
      markers: [
        "proc.stdout.getReader()",
        "const decoder = new TextDecoder()",
        "decoder.decode(value, { stream: true })",
        "buffer.split(/\\r?\\n/)",
        "reader.read()",
      ],
    },
  ],
  "Search in messages": [
    {
      file: "packages/opencode/src/cli/cmd/tui/component/prompt/search.tsx",
      markers: ["export function SearchInput", "matchInfo", ">Search</text>"],
    },
    {
      file: "packages/opencode/src/config/config.ts",
      markers: ['session_search: z.string().optional().default("ctrl+f")'],
    },
  ],
  "Double Ctrl+C to exit": [
    {
      file: "packages/opencode/src/cli/cmd/tui/component/prompt/search.tsx",
      markers: ["lastExitAttempt", "Press again to exit", "now - lastExitAttempt < 2000"],
    },
  ],
  "Live token usage during streaming": [
    {
      file: "packages/opencode/src/session/processor.ts",
      markers: ["input.assistantMessage.tokens = usage.tokens", "tokens: usage.tokens"],
    },
    {
      file: "packages/opencode/src/session/message-v2.ts",
      markers: ["tokens: z.object({", "reasoning: z.number()"],
    },
    {
      file: "packages/opencode/src/session/prompt.ts",
      markers: ["tokens: {", "cache: { read: 0, write: 0 }"],
    },
    {
      file: "packages/opencode/src/cli/cmd/tui/routes/session/header.tsx",
      markers: ["last.tokens.input + last.tokens.output"],
    },
    {
      file: "packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx",
      markers: ["last.tokens.input + last.tokens.output"],
    },
    {
      file: "packages/sdk/js/src/gen/types.gen.ts",
      markers: ["tokens: {", "cache: {", "reasoning:"],
    },
  ],
  "Cache management command": [
    {
      file: "packages/opencode/src/cli/cmd/cache.ts",
      markers: ['command: "cache"', 'command: "clean"', 'command: "info"'],
    },
    {
      file: "packages/opencode/src/index.ts",
      markers: [".command(CacheCommand)"],
    },
    {
      file: "packages/opencode/src/cli/util.ts",
      markers: ["getDirectorySize", "formatSize", "shortenPath"],
    },
    {
      file: "packages/opencode/src/cli/cmd/uninstall.ts",
      markers: ["Global.Path.cache", 'label: "Cache"'],
    },
  ],
}

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const

const fileCache = new Map<string, string>()

async function readFile(relativePath: string) {
  const absolutePath = path.join(REPO_ROOT, relativePath)
  const cached = fileCache.get(absolutePath)
  if (cached) return cached
  const content = await Bun.file(absolutePath).text()
  fileCache.set(absolutePath, content)
  return content
}

async function fileExists(relativePath: string) {
  return Bun.file(path.join(REPO_ROOT, relativePath)).exists()
}

async function readPackageJson(relativePath: string) {
  return Bun.file(path.join(REPO_ROOT, relativePath)).json() as Promise<Record<string, any>>
}

function matchesMarker(content: string, marker: string) {
  if (marker.includes("\\")) {
    try {
      return new RegExp(marker).test(content)
    } catch {
      return content.includes(marker)
    }
  }
  return content.includes(marker)
}

function findDependencyVersion(pkg: Record<string, any>, name: string) {
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section]
    if (deps && typeof deps === "object" && deps[name]) return deps[name] as string
  }
  return undefined
}

describe("fork features", () => {
  test("all fork features have marker coverage", () => {
    const missingCoverage = FORK_FEATURES.filter(
      (feature) => !feature.criticalCode?.length && !MANUAL_MARKERS[feature.title],
    ).map((feature) => ({ title: feature.title, status: feature.status }))

    expect(missingCoverage).toEqual([])
  })

  test("fork feature files exist", async () => {
    const missing: Array<{ feature: string; file: string }> = []

    for (const feature of FORK_FEATURES) {
      const files = new Set<string>()
      for (const file of feature.files ?? []) files.add(file)
      for (const entry of feature.criticalCode ?? []) files.add(entry.file)
      for (const entry of MANUAL_MARKERS[feature.title] ?? []) files.add(entry.file)

      for (const file of files) {
        if (!(await fileExists(file))) {
          missing.push({ feature: feature.title, file })
        }
      }
    }

    expect(missing).toEqual([])
  })

  test("fork feature markers are present", async () => {
    const missing: Array<{ feature: string; file: string; marker: string }> = []

    for (const feature of FORK_FEATURES) {
      const entries = feature.criticalCode?.length ? feature.criticalCode : (MANUAL_MARKERS[feature.title] ?? [])

      for (const entry of entries) {
        if (!entry.file) {
          missing.push({ feature: feature.title, file: "<missing file>", marker: "<missing file>" })
          continue
        }
        if (!(await fileExists(entry.file))) {
          missing.push({ feature: feature.title, file: entry.file, marker: "<missing file>" })
          continue
        }
        const content = await readFile(entry.file)
        const matched = entry.markers.some((marker) => matchesMarker(content, marker))
        if (!matched) {
          missing.push({ feature: feature.title, file: entry.file, marker: entry.markers.join(" | ") })
        }
      }
    }

    expect(missing).toEqual([])
  })

  test("fork dependencies are pinned", async () => {
    const missing: Array<{
      package: string
      dependency: string
      expected: string
      actual?: string
    }> = []

    for (const [pkgPath, deps] of Object.entries(FEATURES_DATA.forkDependencies ?? {})) {
      if (!Array.isArray(deps)) continue
      const pkg = await readPackageJson(pkgPath)
      for (const dep of deps) {
        const actual = findDependencyVersion(pkg, dep.name)
        if (actual !== dep.version) {
          missing.push({
            package: pkgPath,
            dependency: dep.name,
            expected: dep.version,
            actual,
          })
        }
      }
    }

    expect(missing).toEqual([])
  })

  test("required feature dependencies are pinned", async () => {
    const missing: Array<{
      feature: string
      package: string
      dependency: string
      expected: string
      actual?: string
    }> = []

    for (const feature of FORK_FEATURES) {
      for (const dep of feature.requiredDependencies ?? []) {
        const pkg = await readPackageJson(dep.package)
        const actual = findDependencyVersion(pkg, dep.dependency)
        if (actual !== dep.version) {
          missing.push({
            feature: feature.title,
            package: dep.package,
            dependency: dep.dependency,
            expected: dep.version,
            actual,
          })
        }
      }
    }

    expect(missing).toEqual([])
  })
})
