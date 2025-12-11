#!/usr/bin/env bun
/**
 * Conflict detection helper for upstream sync workflow
 *
 * This script:
 * - Attempts a merge dry-run
 * - Parses conflict output
 * - Categorizes conflicts by file type
 * - Identifies fork-specific feature files that must be preserved
 * - Returns resolution recommendations
 */

import { $ } from "bun"
import forkFeaturesData from "./fork-features.json"

interface ForkFeature {
  pr: number
  title: string
  author: string
  status: string
  description: string
  files: string[]
}

interface ForkFeaturesJson {
  features: ForkFeature[]
}

const forkFeatures = forkFeaturesData as ForkFeaturesJson

// Build a map of file -> PR info for quick lookup
const forkFeatureFiles = new Map<string, ForkFeature>()
for (const feature of forkFeatures.features) {
  for (const file of feature.files) {
    forkFeatureFiles.set(file, feature)
  }
}

interface ConflictInfo {
  file: string
  category: "lockfile" | "docs" | "config" | "custom" | "shared" | "fork-feature"
  resolution: "auto-upstream" | "auto-regenerate" | "manual" | "preserve-fork"
  recommendation: string
  forkFeature?: ForkFeature
}

interface DetectionResult {
  hasConflicts: boolean
  conflicts: ConflictInfo[]
  canAutoResolve: boolean
  manualReviewRequired: string[]
}

function categorizeFile(file: string): { category: ConflictInfo["category"]; forkFeature?: ForkFeature } {
  // Check if this file is part of a fork feature PR first
  const forkFeature = forkFeatureFiles.get(file)
  if (forkFeature) {
    return { category: "fork-feature", forkFeature }
  }

  if (file === "bun.lock" || file.endsWith(".lock")) return { category: "lockfile" }
  if (file.endsWith(".md")) return { category: "docs" }
  if (file === "package.json" || file.endsWith(".json")) return { category: "config" }
  if (file.startsWith(".github/") || file.startsWith("script/sync/")) return { category: "custom" }
  return { category: "shared" }
}

function getResolution(
  category: ConflictInfo["category"],
  forkFeature?: ForkFeature,
): Pick<ConflictInfo, "resolution" | "recommendation"> {
  switch (category) {
    case "fork-feature":
      return {
        resolution: "preserve-fork",
        recommendation: forkFeature
          ? `PRESERVE FORK FEATURE: PR #${forkFeature.pr} "${forkFeature.title}" - Merge carefully to keep our changes while integrating upstream improvements`
          : "PRESERVE FORK FEATURE: Keep our fork-specific changes",
      }
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
    const { category, forkFeature } = categorizeFile(file)
    const { resolution, recommendation } = getResolution(category, forkFeature)

    const info: ConflictInfo = {
      file,
      category,
      resolution,
      recommendation,
      forkFeature,
    }

    result.conflicts.push(info)

    if (resolution === "manual" || resolution === "preserve-fork") {
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

  // Separate fork feature conflicts from others
  const forkFeatureConflicts = result.conflicts.filter((c) => c.category === "fork-feature")
  const otherConflicts = result.conflicts.filter((c) => c.category !== "fork-feature")

  console.log(`Found ${result.conflicts.length} conflicting file(s):\n`)

  if (forkFeatureConflicts.length > 0) {
    console.log("=== FORK FEATURE FILES (MUST PRESERVE) ===\n")
    console.log("These files contain features from upstream PRs merged into this fork.")
    console.log("They MUST be carefully merged to preserve our fork-specific changes.\n")

    // Group by PR
    const byPr = new Map<number, ConflictInfo[]>()
    for (const conflict of forkFeatureConflicts) {
      if (conflict.forkFeature) {
        const existing = byPr.get(conflict.forkFeature.pr) || []
        existing.push(conflict)
        byPr.set(conflict.forkFeature.pr, existing)
      }
    }

    for (const [pr, conflicts] of byPr) {
      const feature = conflicts[0]?.forkFeature
      if (!feature) continue
      console.log(`  PR #${pr}: ${feature.title}`)
      console.log(`    Author: @${feature.author}`)
      console.log(`    Description: ${feature.description}`)
      console.log(`    Files:`)
      for (const conflict of conflicts) {
        console.log(`      - ${conflict.file}`)
      }
      console.log()
    }
  }

  if (otherConflicts.length > 0) {
    console.log("=== OTHER CONFLICTS ===\n")
    for (const conflict of otherConflicts) {
      console.log(`  ${conflict.file}`)
      console.log(`    Category: ${conflict.category}`)
      console.log(`    Resolution: ${conflict.resolution}`)
      console.log(`    Recommendation: ${conflict.recommendation}`)
      console.log()
    }
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
