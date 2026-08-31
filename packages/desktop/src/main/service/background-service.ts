import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import type { ServerReadyData } from "../../shared/ipc-contract"
import { selectBackgroundStateHome } from "./background-state"
import { BackgroundServiceState } from "./background-service-state"
import { cleanStages, DesktopCli } from "./desktop-cli"

export * as BackgroundService from "./background-service"

const execFileAsync = promisify(execFile)
const desktopStateNames = ["ai.opencode.desktop.dev", "ai.opencode.desktop.beta", "ai.opencode.desktop"]

export interface Interface {
  readonly connection: Effect.Effect<ServerReadyData>
  readonly reconnect: Effect.Effect<ServerReadyData>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()
    return Service.of(
      yield* BackgroundServiceState.make({
        initial: connect("initial").pipe(Effect.provide(context)),
        reconnect: connect("reconnect").pipe(Effect.provide(context), Effect.orDie),
      }),
    )
  }),
)

// Desktop delegates discovery and startup to the bundled CLI so a configured
// systemd unit remains the sole owner; portable installs still use CLI election.
const connect = Effect.fn("BackgroundService.connect")(function* (mode: "initial" | "reconnect") {
  yield* Effect.logInfo("starting v2 background service")
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const cli = yield* desktopCli.resolve
  const shellStateHome = process.env.XDG_STATE_HOME
  const candidates = [
    ...new Set([shellStateHome, ...desktopStateNames.map((name) => path.join(app.getPath("appData"), name))]),
  ].filter((candidate) => candidate === undefined || existsSync(candidate))
  const discovered = yield* Effect.forEach(
    candidates,
    (candidate) =>
      run(cli.command, ["service", "status"], { stateHome: candidate }).pipe(
        Effect.map((status) => ({ stateHome: candidate, url: serviceUrl(status) })),
        Effect.orElseSucceed(() => ({ stateHome: candidate, url: undefined })),
      ),
    { concurrency: "unbounded" },
  )
  const selected = selectBackgroundStateHome(discovered, shellStateHome, undefined)
  yield* Effect.logInfo("v2 CLI background instance checked", {
    detected: Boolean(selected.found),
    ...endpoint(selected.found?.url),
  })
  const url = yield* run(cli.command, ["service", "start"], { stateHome: selected.stateHome })
  const password = yield* run(cli.command, ["service", "get", "password"], {
    redact: true,
    stateHome: selected.stateHome,
  })
  yield* Effect.logInfo("v2 CLI background service ready", {
    existing: Boolean(selected.found),
    username: "opencode",
    version: cli.version,
    ...endpoint(url),
  })
  if (mode === "initial" && app.isPackaged && cli.binary) yield* cleanStages(cli.binary).pipe(Effect.orDie)
  return {
    url,
    username: "opencode",
    password,
  } satisfies ServerReadyData
})

const run = Effect.fn("BackgroundService.run")(function* (
  command: readonly string[],
  args: readonly string[],
  options: { readonly redact?: boolean; readonly stateHome?: string } = {},
) {
  yield* Effect.logInfo("v2 CLI command started", { args })
  const env = { ...process.env }
  if (options.stateHome === undefined) delete env.XDG_STATE_HOME
  else env.XDG_STATE_HOME = options.stateHome
  const [binary, ...prefix] = command
  return yield* Effect.tryPromise(() => execFileAsync(binary!, [...prefix, ...args], { env, windowsHide: true })).pipe(
    Effect.tap((result) =>
      Effect.logInfo("v2 CLI command completed", {
        args,
        stdout: options.redact ? "[redacted]" : result.stdout.trim(),
        stderr: result.stderr.trim(),
      }),
    ),
    Effect.tapError((error) => Effect.logError("v2 CLI command failed", { args, error: String(error) })),
    Effect.map((result) => result.stdout.trim()),
  )
})

function serviceUrl(status: string) {
  if (URL.canParse(status)) return status
  if (!status.startsWith("running ")) return
  const url = status.slice("running ".length).trim()
  return URL.canParse(url) ? url : undefined
}

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}
