import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { Global } from "../../global"
import { getDirectorySize, formatSize, shortenPath } from "../util"
import fs from "fs/promises"
import path from "path"

const CacheCleanCommand = cmd({
  command: "clean",
  describe: "remove cached plugins and packages",
  builder: (yargs: Argv) =>
    yargs
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "skip confirmation prompt",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show what would be removed without removing",
        default: false,
      }),
  async handler(args) {
    const exists = await fs
      .access(Global.Path.cache)
      .then(() => true)
      .catch(() => false)

    if (!exists) {
      prompts.log.info("Cache directory does not exist")
      return
    }

    const size = await getDirectorySize(Global.Path.cache)

    prompts.log.info(`Cache: ${shortenPath(Global.Path.cache)} (${formatSize(size)})`)

    if (args.dryRun) {
      prompts.log.warn("Dry run - no changes made")
      return
    }

    if (!args.force) {
      const confirm = await prompts.confirm({
        message: "Remove cache directory?",
        initialValue: true,
      })
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.log.warn("Cancelled")
        return
      }
    }

    const spinner = prompts.spinner()
    spinner.start("Removing cache...")

    const err = await fs.rm(Global.Path.cache, { recursive: true, force: true }).catch((e) => e)
    if (err) {
      spinner.stop("Failed to remove cache", 1)
      prompts.log.error(err.message)
      return
    }

    spinner.stop("Cache removed")
  },
})

const CacheInfoCommand = cmd({
  command: "info",
  describe: "show cache directory information",
  async handler() {
    const exists = await fs
      .access(Global.Path.cache)
      .then(() => true)
      .catch(() => false)

    prompts.log.info(`Path: ${shortenPath(Global.Path.cache)}`)

    if (!exists) {
      prompts.log.info("Status: not created")
      return
    }

    const size = await getDirectorySize(Global.Path.cache)
    prompts.log.info(`Size: ${formatSize(size)}`)

    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(() => null)

    if (parsed?.dependencies) {
      const deps = Object.entries(parsed.dependencies)
      if (deps.length > 0) {
        prompts.log.info(`Packages:`)
        for (const [pkg, version] of deps) {
          prompts.log.info(`  ${pkg}@${version}`)
        }
      }
    }

    const versionFile = Bun.file(path.join(Global.Path.cache, "version"))
    const version = await versionFile.text().catch(() => null)
    if (version) {
      prompts.log.info(`Cache version: ${version.trim()}`)
    }
  },
})

export const CacheCommand = cmd({
  command: "cache",
  describe: "manage plugin and package cache",
  builder: (yargs) =>
    yargs
      .command(CacheCleanCommand)
      .command(CacheInfoCommand)
      .demandCommand(1, "Please specify a subcommand: clean or info"),
  async handler() {},
})
