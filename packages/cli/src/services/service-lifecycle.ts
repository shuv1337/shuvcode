import { Service, type EnsureOptions } from "@opencode-ai/client/effect/service"
import { Effect, FileSystem, Option, Schema } from "effect"
import { ServiceConfig } from "./service-config"

const unit = "shuvcode.service"
const decodeRegistration = Schema.decodeUnknownOption(Schema.fromJsonString(Service.Info))
type EnsureInput = Pick<EnsureOptions, "onStart"> & { readonly version?: string }
type SystemdAction = "start" | "stop" | "restart"

export const ensure = Effect.fn("cli.service-lifecycle.ensure")(function* (input: EnsureInput = {}) {
  const config = yield* ServiceConfig.read()
  const options = withVersion(yield* ServiceConfig.options({ config }), input)
  if (config.manager !== "systemd") return yield* Service.ensure(options)

  if (!(yield* systemdActive())) {
    // A healthy registered daemon may predate supervisor configuration. Stop it
    // before starting the unit so the configured supervisor becomes the owner.
    yield* Service.stop(options)
    yield* systemd("start")
  }

  const endpoint = yield* Service.ensure(options)
  if (yield* systemdOwns(options.file)) return endpoint

  // A unit contender can briefly become active, observe an older portable
  // incumbent, and exit cleanly. Replace that incumbent and verify the
  // registered process belongs to the unit's MainPID tree before succeeding.
  yield* Effect.logWarning("registered service is not owned by configured manager", {
    manager: "systemd",
    unit,
  })
  yield* Service.stop(options)
  yield* systemd("restart")
  const supervised = yield* Service.ensure(options)
  yield* requireSystemdOwner(options.file)
  return supervised
})

export const stop = Effect.fn("cli.service-lifecycle.stop")(function* () {
  const config = yield* ServiceConfig.read()
  const options = yield* ServiceConfig.options({ config })
  if (config.manager === "systemd") yield* systemd("stop")
  yield* Service.stop(options)
})

export const restart = Effect.fn("cli.service-lifecycle.restart")(function* (input: EnsureInput = {}) {
  const config = yield* ServiceConfig.read()
  const options = withVersion(yield* ServiceConfig.options({ config }), input)
  yield* Service.stop(options)
  if (config.manager === "systemd") yield* systemd("restart")
  const endpoint = yield* Service.ensure(options)
  if (config.manager === "systemd") yield* requireSystemdOwner(options.file)
  return endpoint
})

export const status = Effect.fn("cli.service-lifecycle.status")(function* () {
  const config = yield* ServiceConfig.read()
  const options = yield* ServiceConfig.options({ config })
  if (config.manager === "systemd" && !(yield* systemdActive())) return undefined
  const endpoint = yield* Service.discover({ ...options, version: undefined })
  if (config.manager === "systemd" && endpoint !== undefined && !(yield* systemdOwns(options.file))) return undefined
  return endpoint
})

function withVersion(options: EnsureOptions, input: EnsureInput) {
  return {
    ...options,
    ...(Object.hasOwn(input, "version") ? { version: input.version } : {}),
    ...(input.onStart === undefined ? {} : { onStart: input.onStart }),
  }
}

const systemd = Effect.fn("cli.service-lifecycle.systemd")(function* (action: SystemdAction) {
  const startedAt = performance.now()
  const result = yield* runSystemctl(["--user", action, unit]).pipe(
    Effect.tapError((error) =>
      Effect.logError("service manager operation failed", {
        manager: "systemd",
        action,
        unit,
        durationMs: Math.round(performance.now() - startedAt),
        error,
      }),
    ),
  )
  if (result.exit !== 0) {
    const error = new Error(
      `systemctl --user ${action} ${unit} failed with exit code ${result.exit}${result.stderr ? `: ${result.stderr}` : ""}`,
    )
    yield* Effect.logError("service manager operation failed", {
      manager: "systemd",
      action,
      unit,
      durationMs: Math.round(performance.now() - startedAt),
      exit: result.exit,
      error,
    })
    yield* Effect.fail(error)
  }
  yield* Effect.logInfo("service manager operation completed", {
    manager: "systemd",
    action,
    unit,
    durationMs: Math.round(performance.now() - startedAt),
  })
})

const systemdActive = Effect.fn("cli.service-lifecycle.systemdActive")(function* () {
  const result = yield* runSystemctl(["--user", "is-active", "--quiet", unit])
  if (result.exit === 0) return true
  if (result.exit === 3) return false
  const error = new Error(
    `systemctl --user is-active ${unit} failed with exit code ${result.exit}${result.stderr ? `: ${result.stderr}` : ""}`,
  )
  yield* Effect.logError("service manager status failed", {
    manager: "systemd",
    unit,
    exit: result.exit,
    error,
  })
  return yield* Effect.fail(error)
})

const systemdOwns = Effect.fn("cli.service-lifecycle.systemdOwns")(function* (file?: string) {
  const mainPID = yield* systemdPID()
  if (mainPID === undefined || file === undefined) return false
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file).pipe(Effect.option)
  if (Option.isNone(text)) return false
  const pid = Option.getOrUndefined(decodeRegistration(text.value))?.pid
  if (pid === undefined) return false
  return yield* descendsFrom(fs, pid, mainPID)
})

function descendsFrom(fs: FileSystem.FileSystem, pid: number, ancestor: number): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    if (pid === ancestor) return true
    if (pid <= 1) return false
    const status = yield* fs.readFileString(`/proc/${pid}/status`).pipe(Effect.option)
    if (Option.isNone(status)) return false
    const parent = Number(status.value.match(/^PPid:\s+(\d+)$/m)?.[1])
    if (!Number.isSafeInteger(parent) || parent <= 0 || parent === pid) return false
    return yield* descendsFrom(fs, parent, ancestor)
  })
}

const requireSystemdOwner = Effect.fn("cli.service-lifecycle.requireSystemdOwner")(function* (file?: string) {
  if (yield* systemdOwns(file)) return
  const error = new Error(`${unit} did not become the registered service owner`)
  yield* Effect.logError("configured service manager does not own registered service", {
    manager: "systemd",
    unit,
    error,
  })
  yield* Effect.fail(error)
})

const systemdPID = Effect.fn("cli.service-lifecycle.systemdPID")(function* () {
  const result = yield* runSystemctl(["--user", "show", "--property=MainPID", "--value", unit])
  if (result.exit !== 0) {
    const error = new Error(
      `systemctl --user show ${unit} failed with exit code ${result.exit}${result.stderr ? `: ${result.stderr}` : ""}`,
    )
    yield* Effect.logError("service manager owner lookup failed", {
      manager: "systemd",
      unit,
      exit: result.exit,
      error,
    })
    return yield* Effect.fail(error)
  }
  const pid = Number(result.stdout)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
})

function runSystemctl(args: string[]) {
  return Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn([process.env.OPENCODE_SYSTEMCTL ?? "systemctl", ...args], {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      return { exit, stdout: stdout.trim(), stderr: stderr.trim() }
    },
    catch: (cause) => new Error("Failed to execute systemctl", { cause }),
  })
}

export * as ServiceLifecycle from "./service-lifecycle"
