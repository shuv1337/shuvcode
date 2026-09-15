import { confirm, intro, log, outro, spinner } from "@clack/prompts"
import { Service } from "@opencode/client/effect/service"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem } from "effect"
import path from "node:path"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { Updater } from "../../services/updater"
import { handlePromptErrors, prompt, requireInteractive } from "../../ui/prompt"
import { errorMessage } from "../../util/error"

export default Runtime.handler(
  Commands.commands.uninstall,
  Effect.fn("cli.uninstall")(function* (input) {
    intro("Uninstall Shuvcode")
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const updater = yield* Updater.Service
    const method = yield* updater.method()
    const removal = method ? updater.removal(method) : undefined
    const directories = [
      { path: global.data, label: "Data", keep: input.keepData },
      { path: global.cache, label: "Cache", keep: false },
      { path: global.config, label: "Config", keep: input.keepConfig },
      { path: global.state, label: "State", keep: false },
    ]
    // All channels share these directories. Stop their owners before deleting state or data.
    // Read registrations directly: ServiceConfig.options() can migrate files even during a dry run.
    const services = (yield* fs.exists(global.state))
      ? (yield* fs.readDirectory(global.state)).filter((name) => /^service(?:-.*)?\.json$/.test(name))
      : []

    log.info(`Installation method: ${method ?? "unknown"}`)
    log.message("The following global files will be removed (shared by Shuvcode versions and channels):")
    yield* Effect.forEach(directories, (directory) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(directory.path))) return
        log.info(`  ${directory.label}: ${directory.path}${directory.keep ? " (keeping)" : ""}`)
      }),
    )
    services.forEach((name) =>
      log.info(`  Stop background service and persistent terminals: ${path.join(global.state, name)}`),
    )
    if (removal) log.info(`  Package: ${removal.command.join(" ")}`)
    if (!method) log.warn("Could not detect the installation method. Remove the installation manually after cleanup.")

    if (input.dryRun) {
      log.warn("Dry run - no changes made")
      outro("Done")
      return
    }
    if (!input.force) {
      yield* requireInteractive("Use --force to uninstall without an interactive terminal, or --dry-run to preview.")
      const accepted = yield* prompt(() =>
        confirm({ message: "Are you sure you want to uninstall?", initialValue: false }),
      )
      if (!accepted) {
        outro("Cancelled")
        return
      }
    }

    const progress = spinner()
    if (services.length) {
      progress.start("Stopping background services...")
      yield* Effect.forEach(services, (name) =>
        Effect.gen(function* () {
          const options = { file: path.join(global.state, name) }
          yield* ServerConnection.shutdownPersistentPty(options).pipe(Effect.ignore)
          yield* Service.stop(options)
        }),
      ).pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Background services stopped"))),
        Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to stop background services", 1))),
      )
    }

    const errors: string[] = []
    yield* Effect.forEach(directories, (directory) =>
      Effect.gen(function* () {
        if (directory.keep) return
        progress.start(`Removing ${directory.label}...`)
        yield* fs.remove(directory.path, { recursive: true, force: true }).pipe(
          Effect.tap(() => Effect.sync(() => progress.stop(`Removed ${directory.label}`))),
          Effect.catch((error) =>
            Effect.sync(() => {
              progress.stop(`Failed to remove ${directory.label}`, 1)
              errors.push(`${directory.label}: ${errorMessage(error)}`)
            }),
          ),
        )
      }),
    )
    if (removal) {
      progress.start(`Running ${removal.command.join(" ")}...`)
      yield* removal.run.pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Package removed"))),
        Effect.catch((error) =>
          Effect.sync(() => {
            progress.stop("Package manager uninstall failed", 1)
            errors.push(errorMessage(error))
            log.warn(`Run manually: ${removal.command.join(" ")}`)
          }),
        ),
      )
    }
    if (errors.length) yield* Effect.fail(new Error(errors.join("\n")))
    outro("Done")
  }, handlePromptErrors),
)
