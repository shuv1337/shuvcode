#!/usr/bin/env bun
/**
 * Conflict detection helper for upstream sync workflow
 *
 * This script:
 * - Attempts a merge dry-run
 * - Parses conflict output
 * - Categorizes conflicts by file type
 * - Returns resolution recommendations
 */

import { $ } from "bun"

interface ConflictInfo {
  file: string
  category: "lockfile" | "docs" | "config" | "custom" | "shared"
  resolution: "auto-upstream" | "auto-regenerate" | "manual"
  recommendation: string
}

interface DetectionResult {
  hasConflicts: boolean
  conflicts: ConflictInfo[]
  canAutoResolve: boolean
  manualReviewRequired: string[]
}

function categorizeFile(file: string): ConflictInfo["category"] {
  if (file === "bun.lock" || file.endsWith(".lock")) return "lockfile"
  if (file.endsWith(".md")) return "docs"
  if (file === "package.json" || file.endsWith(".json")) return "config"
  if (file.startsWith(".github/") || file.startsWith("script/sync/")) return "custom"
  return "shared"
}

function getResolution(category: ConflictInfo["category"]): Pick<ConflictInfo, "resolution" | "recommendation"> {
  switch (category) {
    case "lockfile":
      return {
        resolution: "auto-regenerate",
        recommendation: "Regenerate by running `bun install` after resolving package.json",
      }
    case "docs":
      return {
        resolution: "auto-upstream",
        recommendation: "Accept upstream version",
      }
    case "config":
      return {
        resolution: "manual",
        recommendation: "Review changes carefully - may contain breaking dependency updates",
      }
    case "custom":
      return {
        resolution: "manual",
        recommendation: "Keep local version - these are fork-specific customizations",
      }
    case "shared":
      return {
        resolution: "manual",
        recommendation: "Review changes - may require merging upstream improvements with local modifications",
      }
  }
}

async function detectConflicts(targetBranch = "dev"): Promise<DetectionResult> {
  const result: DetectionResult = {
    hasConflicts: false,
    conflicts: [],
    canAutoResolve: true,
    manualReviewRequired: [],
  }

  // Attempt merge with no-commit
  const merge = await $`git merge ${targetBranch} --no-commit --no-ff`.nothrow().quiet()

  if (merge.exitCode === 0) {
    // No conflicts, abort the merge to leave repo clean
    await $`git merge --abort`.nothrow().quiet()
    return result
  }

  result.hasConflicts = true

  // Get list of conflicting files
  const conflicts = await $`git diff --name-only --diff-filter=U`.text()
  const files = conflicts.trim().split("\n").filter(Boolean)

  for (const file of files) {
    const category = categorizeFile(file)
    const { resolution, recommendation } = getResolution(category)

    const info: ConflictInfo = {
      file,
      category,
      resolution,
      recommendation,
    }

    result.conflicts.push(info)

    if (resolution === "manual") {
      result.canAutoResolve = false
      result.manualReviewRequired.push(file)
    }
  }

  // Abort the merge to leave repo clean
  await $`git merge --abort`.nothrow().quiet()

  return result
}

async function main() {
  const targetBranch = process.argv[2] || "dev"

  console.log(`Detecting conflicts when merging ${targetBranch}...\n`)

  const result = await detectConflicts(targetBranch)

  if (!result.hasConflicts) {
    console.log("No conflicts detected. Merge can proceed cleanly.")
    process.exit(0)
  }

  console.log(`Found ${result.conflicts.length} conflicting file(s):\n`)

  for (const conflict of result.conflicts) {
    console.log(`  ${conflict.file}`)
    console.log(`    Category: ${conflict.category}`)
    console.log(`    Resolution: ${conflict.resolution}`)
    console.log(`    Recommendation: ${conflict.recommendation}`)
    console.log()
  }

  if (result.canAutoResolve) {
    console.log("All conflicts can be auto-resolved.")
    process.exit(0)
  }

  console.log("Manual review required for:")
  for (const file of result.manualReviewRequired) {
    console.log(`  - ${file}`)
  }
  process.exit(1)
}

main().catch((err) => {
  console.error("Error detecting conflicts:", err)
  process.exit(1)
})
