import { spawn } from "node:child_process"
import { closeSync, existsSync, openSync, readSync } from "node:fs"
import { chmod, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Schema } from "effect"
import { selfCommand } from "../util/process"
import { SupervisorAPI } from "./api"
import { SupervisorClient } from "./client"
import { SupervisorNative } from "./native"
import { SupervisorSettings } from "./settings"
import { SupervisorHerdr } from "./herdr"

export namespace SupervisorManaged {
  const Identity = Schema.Struct({ pid: Schema.Int, start: Schema.String, boot: Schema.String })
  const Owner = Schema.Struct({
    pilotID: Schema.String,
    epoch: Schema.Int,
    endpoint: Schema.String,
    database: Schema.String,
    owner: Identity,
    native: Schema.optional(Identity),
    pendingFrom: Schema.optional(Schema.Int),
  })
  export type Identity = typeof Identity.Type
  export type Owner = typeof Owner.Type

  export function command() {
    const command = selfCommand()
    if (path.basename(command[0]!) !== "bun" || !command[1]?.endsWith(".ts")) return command
    return [command[0]!, "--no-env-file", "--preload", require.resolve("@opentui/solid/preload"), ...command.slice(1)]
  }

  export async function identity(pid: number): Promise<Identity | undefined> {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ESRCH") return undefined
      throw error
    })
    if (!stat) return undefined
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    if (fields[0] === "Z" || fields[0] === "X") return undefined
    return { pid, start: fields[19]!, boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() }
  }

  export async function owner(root: string) {
    if (!(await Bun.file(path.join(root, "owner.json")).exists())) return undefined
    return Schema.decodeUnknownSync(Owner)(await Bun.file(path.join(root, "owner.json")).json())
  }

  export async function running(expected: Identity) {
    const actual = await identity(expected.pid)
    if (!actual) return false
    // A reused PID means the recorded process has exited. Its new occupant is never ours to signal.
    if (actual.boot !== expected.boot || actual.start !== expected.start) return false
    return true
  }

  export async function terminate(expected: Identity) {
    if (!(await running(expected))) return
    process.kill(expected.pid, "SIGTERM")
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && (await running(expected))) await Bun.sleep(50)
    if (!(await running(expected))) return
    process.kill(expected.pid, "SIGKILL")
    const forced = Date.now() + 5_000
    while (Date.now() < forced && (await running(expected))) await Bun.sleep(50)
    if (await running(expected)) throw new Error("Pilot process did not exit; recovery remains blocked")
  }

  export function awaitLaunch() {
    const gate = Buffer.alloc(1)
    if (readSync(0, gate, 0, 1, null) !== 1 || gate[0] !== 1)
      throw new Error("Native pilot server must be launched by its supervisor")
  }

  export async function start(root: string) {
    const settings = await SupervisorSettings.read(root)
    const current = await owner(root)
    if (current) validateOwner(settings, current)
    if (current && (await running(current.owner))) return waitReady(root, current.owner)
    await rm(path.join(root, "startup-error.json"), { force: true })
    const logfile = openSync(path.join(root, "supervisor.log"), "a", 0o600)
    const executable = command()
    const child = spawn(executable[0]!, [...executable.slice(1), "supervisor", "daemon", "--home", root], {
      detached: true,
      stdio: ["ignore", logfile, logfile],
      env: process.env,
    })
    closeSync(logfile)
    child.unref()
    if (!child.pid) throw new Error("Could not start supervisor")
    const expected = await identity(child.pid)
    if (!expected) throw new Error(`Supervisor exited during startup. Inspect ${path.join(root, "supervisor.log")}`)
    return waitReady(root, expected)
  }

  export async function stop(root: string) {
    const settings = await SupervisorSettings.read(root)
    const current = await owner(root)
    if (!current) return
    validateOwner(settings, current)
    for (const expected of [current.owner, ...(current.native ? [current.native] : [])]) {
      const actual = await identity(expected.pid)
      if (actual && (actual.boot !== expected.boot || actual.start !== expected.start))
        throw new Error("Pilot process identity changed; stop was refused without signaling any process")
    }
    await terminate(current.owner)
    if (current.native) await terminate(current.native)
    await rm(path.join(root, "supervisor.json"), { force: true })
  }

  export async function run(root: string) {
    const settings = await SupervisorSettings.read(root)
    const lock = new DatabaseSync(path.join(root, "lifecycle.lock.sqlite"), { timeout: 0 })
    await chmod(path.join(root, "lifecycle.lock.sqlite"), 0o600)
    try {
      lock.exec("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE")
    } catch {
      lock.close()
      throw new Error("This pilot already has a running supervisor")
    }
    const lease: {
      native?: ReturnType<typeof Bun.spawn>
      identity?: Identity
      api?: Awaited<ReturnType<typeof SupervisorAPI.serve>>
      logfile?: number
      herdr?: ReturnType<typeof SupervisorHerdr.watch>
    } = {}
    const stopped = Promise.withResolvers<void>()
    const lifecycle = { requested: false }
    const finish = () => {
      lifecycle.requested = true
      stopped.resolve()
    }
    process.once("SIGTERM", finish)
    process.once("SIGINT", finish)
    try {
      const previous = await owner(root)
      if (previous) {
        validateOwner(settings, previous)
        if (previous.native) await terminate(previous.native)
      }
      const history = epoch(root)
      const next = Math.max(previous?.epoch ?? 0, history?.epoch ?? 0) + 1
      const record: { -readonly [Key in keyof Owner]: Owner[Key] } = {
        pilotID: settings.pilotID,
        epoch: next,
        endpoint: settings.endpoint,
        database: SupervisorSettings.database(root),
        owner: (await identity(process.pid))!,
        pendingFrom: history?.recovery_from_epoch ?? history?.epoch,
      }
      const secret = await SupervisorSettings.password(settings)
      if (settings.mode === "managed") {
        await SupervisorSettings.configure(settings)
        lease.logfile = openSync(path.join(root, "native.log"), "a", 0o600)
        lease.native = Bun.spawn([...command(), "supervisor", "native", "--port", String(settings.port)], {
          cwd: settings.project,
          env: SupervisorSettings.environment(settings, secret),
          stdin: "pipe",
          stdout: lease.logfile,
          stderr: lease.logfile,
        })
        record.native = await identity(lease.native.pid)
        if (!record.native) throw new Error("Native pilot server exited before launch")
        lease.identity = record.native
        // Record the exact process before it can open the database or accept a prompt.
        await SupervisorSettings.write(root, "owner.json", record)
        if (typeof lease.native.stdin === "number" || !lease.native.stdin) throw new Error("Native lease unavailable")
        lease.native.stdin.write(new Uint8Array([1]))
        lease.native.stdin.flush()
      }
      if (settings.mode === "external") await SupervisorSettings.write(root, "owner.json", record)
      const native = SupervisorNative.connect({ url: settings.endpoint, password: secret, timeoutMs: 2_000 })
      await waitNative(native, record.native)
      if (settings.mode === "managed") {
        const sentinel = `ses_supervisor_${settings.pilotID.replaceAll("-", "")}`
        const initialized = path.join(root, "native-initialized.json")
        if (await Bun.file(initialized).exists()) {
          const session = await native.get(sentinel).catch(() => {
            throw new Error("Pilot database identity is missing. Restore its original database; recovery was refused.")
          })
          if (session.location.directory !== settings.project)
            throw new Error("Pilot database identity has unexpected placement")
        } else {
          await native.create({
            sessionID: sentinel,
            directory: settings.project,
            agent: "supervisor-lead",
            model: { providerID: settings.model.providerID, id: settings.model.modelID },
            permissions: SupervisorSettings.permissions(settings),
            title: "Supervisor identity",
          })
          await SupervisorSettings.write(root, "native-initialized.json", {
            pilotID: settings.pilotID,
            database: record.database,
          })
        }
      }
      lease.api = await SupervisorAPI.serve({
        home: root,
        endpoint: settings.endpoint,
        password: secret,
        managed:
          settings.mode === "managed"
            ? { epoch: next, pilotID: settings.pilotID, fencedEpoch: record.pendingFrom }
            : undefined,
      })
      // A cancelled worker must not resume between process recovery and the first cancellation reconciliation.
      if (lease.native && lease.native.stdin && typeof lease.native.stdin !== "number") {
        lease.native.stdin.write(`${JSON.stringify(lease.api.interruptedSessionIDs)}\n`)
        lease.native.stdin.flush()
      }
      await rm(path.join(root, "startup-error.json"), { force: true })
      lease.herdr = SupervisorHerdr.watch(settings, command(), native)
      if (lease.native)
        void lease.native.exited
          .then(async (code) => {
            if (!lifecycle.requested)
              await SupervisorSettings.write(root, "startup-error.json", {
                error: `Native pilot server exited unexpectedly (status ${code}). Run supervisor start to recover.`,
              })
            stopped.resolve()
          })
          .catch(stopped.reject)
      await stopped.promise
    } catch (error) {
      await SupervisorSettings.write(root, "startup-error.json", {
        error: error instanceof Error ? error.message : "Supervisor startup failed",
      })
      throw error
    } finally {
      process.removeListener("SIGTERM", finish)
      process.removeListener("SIGINT", finish)
      await lease.herdr?.close()
      await lease.api?.close()
      if (lease.native) {
        if (lease.native.stdin && typeof lease.native.stdin !== "number") lease.native.stdin.end()
        if (lease.identity) await terminate(lease.identity)
        await lease.native.exited
      }
      if (lease.logfile !== undefined) closeSync(lease.logfile)
      lock.close()
    }
  }

  function validateOwner(settings: SupervisorSettings.Value & { home: string }, current: Owner) {
    if (
      current.pilotID !== settings.pilotID ||
      current.endpoint !== settings.endpoint ||
      current.database !== SupervisorSettings.database(settings.home)
    )
      throw new Error("Pilot ownership record does not match this home; recovery was refused")
  }

  function epoch(root: string) {
    const file = path.join(root, "supervisor.sqlite")
    if (!existsSync(file)) return undefined
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supervisor_epoch'").get())
        return undefined
      return db.prepare("SELECT epoch, recovery_from_epoch FROM supervisor_epoch WHERE id = 1").get() as
        | { epoch: number; recovery_from_epoch: number | null }
        | undefined
    } finally {
      db.close()
    }
  }

  async function waitReady(root: string, expected: Identity) {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      if (!(await running(expected))) break
      const ready = await SupervisorClient.health(root)
        .then((health) => health.pid === expected.pid)
        .catch(() => false)
      if (ready) return { pid: expected.pid }
      await Bun.sleep(100)
    }
    const failure = await Bun.file(path.join(root, "startup-error.json"))
      .json()
      .then(Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String })))
      .catch(() => undefined)
    throw new Error(failure?.error ?? `Supervisor did not become ready. Inspect ${path.join(root, "supervisor.log")}`)
  }

  async function waitNative(native: ReturnType<typeof SupervisorNative.connect>, expected?: Identity) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (expected && !(await running(expected)))
        throw new Error("Native pilot server exited. Inspect native.log in the supervisor home.")
      if (
        await native
          .info()
          .then(() => true)
          .catch(() => false)
      )
        return
      await Bun.sleep(100)
    }
    throw new Error("Native pilot server did not become ready. Inspect native.log in the supervisor home.")
  }
}
