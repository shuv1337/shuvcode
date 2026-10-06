import { createConnection } from "node:net"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Schema } from "effect"
import { SupervisorClient } from "./client"
import { SupervisorNative } from "./native"
import { SupervisorPresentation } from "./presentation"
import { SupervisorSettings } from "./settings"

export namespace SupervisorHerdr {
  const Peer = Schema.Struct({ socket: Schema.String, session: Schema.String })
  const Launch = Schema.Struct({ homeID: Schema.String, id: Schema.String, peer: Schema.optional(Peer) })
  const Pane = Schema.Struct({ pane_id: Schema.String, workspace_id: Schema.String, tab_id: Schema.String })
  const Binding = Schema.Struct({
    binding_id: Schema.String,
    attachment: SupervisorPresentation.Attachment,
    seq: Schema.NullOr(Schema.Number),
  })
  const Entry = Schema.Struct({
    id: Schema.String,
    attachment: SupervisorPresentation.Attachment,
    bindingID: Schema.String,
    phase: Schema.Literals(["new", "create_pending", "bind_pending", "bound", "launch_pending", "ready", "closed"]),
    pane: Schema.optional(Pane),
    seq: Schema.Number,
  })
  const Journal = Schema.Struct({
    homeID: Schema.String,
    peers: Schema.Array(
      Schema.Struct({ ...Peer.fields, launchID: Schema.optional(Schema.String), entries: Schema.Array(Entry) }),
    ),
  })
  export const Status = Schema.Struct({
    available: Schema.Boolean,
    observedAt: Schema.Number,
    error: Schema.optional(Schema.String),
  })
  type Peer = typeof Peer.Type
  type Entry = { -readonly [Key in keyof typeof Entry.Type]: (typeof Entry.Type)[Key] }
  type Target = Peer & { launchID?: string; entries: Entry[] }
  type Journal = { homeID: string; peers: Target[] }
  type Settings = SupervisorSettings.Value & { home: string }
  type Fact = SupervisorPresentation.Snapshot["entries"][number]

  // Only the bare launcher opts a home in. Existing ShuvBro adapters keep their own presentation ownership.
  export async function enable(settings: Settings) {
    if (await Bun.file(path.join(settings.home, "native-display.json")).exists()) return
    await SupervisorSettings.write(settings.home, "herdr-launch.json", {
      homeID: settings.pilotID,
      id: crypto.randomUUID(),
      peer: currentPeer(),
    })
  }

  export function watch(
    settings: Settings,
    command: readonly string[],
    native: ReturnType<typeof SupervisorNative.connect>,
  ) {
    let pending: Promise<void> | undefined
    const tick = () => {
      if (pending) return
      pending = reconcile(settings, command, native)
        .catch(async (error) => {
          await SupervisorSettings.write(settings.home, "herdr-status.json", {
            available: false,
            observedAt: Date.now(),
            error: error instanceof Error ? error.message : "Herdr views unavailable",
          })
        })
        .catch((error) => console.error("Herdr presentation:", error))
        .finally(() => {
          pending = undefined
        })
    }
    const timer = setInterval(tick, 2000)
    tick()
    return {
      async close() {
        clearInterval(timer)
        await pending
      },
    }
  }

  export async function focus(settings: Settings, sessionID: string) {
    const peer = currentPeer()
    if (!peer || !process.env.HERDR_PANE_ID) return false
    if (!(await Bun.file(path.join(settings.home, "herdr-launch.json")).exists())) return false
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const journal = await read(settings)
      const entry = journal.peers
        .find((item) => isDeepStrictEqual(peer, { socket: item.socket, session: item.session }))
        ?.entries.find((item) => item.id === "lead" && (item.phase === "ready" || item.phase === "launch_pending"))
      if (entry) {
        if (entry.attachment.session_id !== sessionID) return false
        await negotiate(peer)
        await owned(peer, entry)
        await request(peer, "pane.focus", { pane_id: entry.pane!.pane_id })
        return true
      }
      await Bun.sleep(100)
    }
    return false
  }

  async function reconcile(
    settings: Settings,
    command: readonly string[],
    native: ReturnType<typeof SupervisorNative.connect>,
  ) {
    const file = Bun.file(path.join(settings.home, "herdr-launch.json"))
    if (!(await file.exists()) || (await Bun.file(path.join(settings.home, "native-display.json")).exists())) return
    const launch = Schema.decodeUnknownSync(Launch)(await file.json())
    if (launch.homeID !== settings.pilotID) throw new Error("Herdr launch belongs to another fleet home")
    const journal = await read(settings)
    const discovered = launch.peer ?? (journal.peers.length ? undefined : await discover())
    if (
      discovered &&
      !journal.peers.some((peer) => peer.socket === discovered.socket && peer.session === discovered.session)
    ) {
      await negotiate(discovered)
      journal.peers.push({ ...discovered, entries: [] })
      await save(settings, journal)
    }
    if (!journal.peers.length) {
      await SupervisorSettings.write(settings.home, "herdr-status.json", { available: false, observedAt: Date.now() })
      return
    }
    const snapshot = await SupervisorPresentation.read({
      settings,
      command,
      native,
      facts: Schema.decodeUnknownSync(SupervisorPresentation.Facts)(
        await SupervisorClient.request(settings.home, { type: "presentation" }),
      ),
    })
    const failures: string[] = []
    for (const peer of journal.peers) {
      try {
        await negotiate(peer)
        for (const fact of snapshot.entries) {
          try {
            const previous = peer.entries.findLast((entry) => entry.id === fact.id)
            // A new explicit launch restores closed views, retaining old IDs to reject topology reuse.
            const known = previous?.phase === "closed" && peer.launchID !== launch.id ? undefined : previous
            if (!known && (!fact.available || fact.retired)) continue
            const entry = known ?? {
              id: fact.id,
              attachment: fact.attachment,
              bindingID: `shuvcode:${settings.pilotID}:${crypto.randomUUID()}`,
              phase: "new" as const,
              seq: 0,
            }
            if (!known) {
              peer.entries.push(entry)
              await save(settings, journal)
            }
            await sync(settings, journal, peer, entry, fact)
          } catch (error) {
            failures.push(`${fact.id}: ${error instanceof Error ? error.message : "Herdr view unavailable"}`)
          }
        }
        peer.launchID = launch.id
        await save(settings, journal)
      } catch (error) {
        failures.push(`${peer.session}: ${error instanceof Error ? error.message : "Herdr unavailable"}`)
      }
    }
    await SupervisorSettings.write(settings.home, "herdr-status.json", {
      available: failures.length === 0,
      observedAt: Date.now(),
      error: failures.length ? failures.join("; ") : undefined,
    })
  }

  async function sync(settings: Settings, journal: Journal, peer: Target, entry: Entry, fact: Fact) {
    if (!isDeepStrictEqual(entry.attachment, fact.attachment)) throw new Error("Native attachment identity changed")
    if (entry.phase === "closed") return
    if (entry.phase === "create_pending")
      throw new Error("Herdr workspace creation is uncertain; retain the journal before creating another view")
    if (entry.phase === "new") {
      if (!fact.available || fact.retired) return
      entry.phase = "create_pending"
      await save(settings, journal)
      const created = Schema.decodeUnknownSync(
        Schema.Struct({
          workspace: Schema.Struct({ workspace_id: Schema.String }),
          tab: Schema.Struct({ tab_id: Schema.String }),
          root_pane: Pane,
        }),
      )(
        await request(peer, "workspace.create", {
          cwd: fact.location,
          focus: false,
          label: fact.role === "lead" ? "firstmate" : fact.title.slice(0, 100),
        }),
      )
      if (
        created.root_pane.workspace_id !== created.workspace.workspace_id ||
        created.root_pane.tab_id !== created.tab.tab_id ||
        peer.entries.some(
          (other) =>
            other.pane &&
            (other.pane.pane_id === created.root_pane.pane_id ||
              other.pane.workspace_id === created.root_pane.workspace_id ||
              other.pane.tab_id === created.root_pane.tab_id),
        )
      )
        throw new Error("Herdr returned conflicting workspace identities; retain pending creation")
      entry.pane = created.root_pane
      entry.phase = "bind_pending"
      await save(settings, journal)
    }
    try {
      if (entry.phase === "bind_pending") {
        await placement(peer, entry)
        const current = await binding(peer, entry)
        if (!current) {
          const result = Schema.decodeUnknownSync(Schema.Struct({ applied: Schema.Boolean }))(
            await request(peer, "pane.bind_runtime", {
              pane_id: entry.pane!.pane_id,
              binding_id: entry.bindingID,
              attachment: entry.attachment,
            }),
          )
          if (!result.applied) throw new Error("Herdr runtime binding was rejected")
        }
        await owned(peer, entry)
        entry.phase = "bound"
        await save(settings, journal)
      }
      if (entry.phase === "bound" || entry.phase === "launch_pending") {
        await owned(peer, entry)
        const info = Schema.decodeUnknownSync(
          Schema.Struct({
            process_info: Schema.Struct({
              shell_pid: Schema.optional(Schema.Number),
              foreground_process_group_id: Schema.optional(Schema.Number),
              foreground_processes: Schema.optional(
                Schema.Array(Schema.Struct({ pid: Schema.Number, argv: Schema.optional(Schema.Array(Schema.String)) })),
              ),
            }),
          }),
        )(await request(peer, "pane.process_info", { pane_id: entry.pane!.pane_id })).process_info
        if (info.foreground_processes?.some((item) => isDeepStrictEqual(item.argv, entry.attachment.attach_argv))) {
          entry.phase = "ready"
          await save(settings, journal)
        } else {
          if (entry.phase === "launch_pending")
            throw new Error("Herdr attach launch is pending; it will not be submitted twice")
          if (
            !info.shell_pid ||
            info.foreground_process_group_id !== info.shell_pid ||
            !info.foreground_processes ||
            info.foreground_processes.some((item) => item.pid !== info.shell_pid)
          )
            throw new Error("Herdr presentation shell is busy")
          entry.phase = "launch_pending"
          await save(settings, journal)
          await request(peer, "pane.send_input", {
            pane_id: entry.pane!.pane_id,
            text: entry.attachment.attach_argv.map((value) => `'${value.replaceAll("'", "'\\''")}'`).join(" "),
            keys: ["Enter"],
          })
          // A PTY write acknowledgment precedes shell execution. Confirm exact argv on the next observation.
          return
        }
      }
      if (entry.phase !== "ready") return
      const current = await owned(peer, entry)
      entry.seq = Math.max(entry.seq, current.seq ?? 0) + 1
      await save(settings, journal)
      const reported = Schema.decodeUnknownSync(Schema.Struct({ applied: Schema.Boolean, binding: Binding }))(
        await request(peer, "pane.report_runtime", {
          pane_id: entry.pane!.pane_id,
          binding_id: entry.bindingID,
          seq: entry.seq,
          state: fact.state,
          label: fact.label,
          ttl_ms: 5000,
        }),
      )
      if (!reported.applied || reported.binding.binding_id !== entry.bindingID || reported.binding.seq !== entry.seq)
        throw new Error("Herdr status report was stale or rejected")
    } catch (error) {
      if (!(error instanceof PeerError) || !["not_found", "pane_not_found"].includes(error.code)) throw error
      entry.phase = "closed"
      await save(settings, journal)
    }
  }

  function currentPeer(): Peer | undefined {
    return process.env.HERDR_SOCKET_PATH && path.isAbsolute(process.env.HERDR_SOCKET_PATH)
      ? { socket: process.env.HERDR_SOCKET_PATH, session: process.env.HERDR_SESSION ?? "default" }
      : undefined
  }

  async function discover(): Promise<Peer | undefined> {
    const executable = Bun.which("herdr")
    if (!executable) return
    const child = Bun.spawn([executable, "session", "list", "--json"], { stdout: "pipe", stderr: "ignore" })
    const timer = setTimeout(() => child.kill(), 2000)
    try {
      const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
      if (code !== 0) return
      const peers = Schema.decodeUnknownSync(
        Schema.Struct({
          sessions: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              default: Schema.Boolean,
              running: Schema.Boolean,
              socket_path: Schema.String,
            }),
          ),
        }),
      )(JSON.parse(output)).sessions.filter((peer) => peer.running)
      const peer = peers.find((item) => item.default) ?? (peers.length === 1 ? peers[0] : undefined)
      if (!peer && peers.length)
        throw new Error("Multiple Herdr sessions are running; launch shuvcode supervisor inside the intended session")
      return peer ? { socket: peer.socket_path, session: peer.name } : undefined
    } finally {
      clearTimeout(timer)
    }
  }

  async function read(settings: Settings): Promise<Journal> {
    const file = Bun.file(path.join(settings.home, "herdr-views.json"))
    if (!(await file.exists())) return { homeID: settings.pilotID, peers: [] }
    const journal = Schema.decodeUnknownSync(Journal)(await file.json())
    if (journal.homeID !== settings.pilotID) throw new Error("Herdr views belong to another fleet home")
    return {
      ...journal,
      peers: journal.peers.map((peer) => ({ ...peer, entries: peer.entries.map((entry) => ({ ...entry })) })),
    }
  }

  function save(settings: Settings, journal: Journal) {
    return SupervisorSettings.write(settings.home, "herdr-views.json", journal)
  }

  async function negotiate(peer: Peer) {
    const ping = Schema.decodeUnknownSync(
      Schema.Struct({
        session_name: Schema.String,
        capabilities: Schema.Struct({ runtime_attachment_methods: Schema.Array(Schema.String) }),
      }),
    )(await request(peer, "ping", {}))
    if (ping.session_name !== peer.session) throw new Error("Herdr peer session identity changed")
    if (
      !["pane.bind_runtime", "pane.get_runtime", "pane.report_runtime", "pane.unbind_runtime"].every((method) =>
        ping.capabilities.runtime_attachment_methods.includes(method),
      )
    )
      throw new Error("Herdr does not support native runtime attachments")
  }

  async function placement(peer: Peer, entry: Entry) {
    if (!entry.pane) throw new Error("Herdr pane identity is missing")
    const pane = Schema.decodeUnknownSync(Schema.Struct({ pane: Pane }))(
      await request(peer, "pane.get", { pane_id: entry.pane.pane_id }),
    ).pane
    if (!isDeepStrictEqual(pane, entry.pane)) throw new Error("Herdr pane moved or changed placement")
  }

  async function binding(peer: Peer, entry: Entry) {
    return Schema.decodeUnknownSync(Schema.Struct({ binding: Schema.NullOr(Binding) }))(
      await request(peer, "pane.get_runtime", { pane_id: entry.pane!.pane_id }),
    ).binding
  }

  async function owned(peer: Peer, entry: Entry) {
    await placement(peer, entry)
    const current = await binding(peer, entry)
    if (current?.binding_id !== entry.bindingID || !isDeepStrictEqual(current.attachment, entry.attachment))
      throw new Error("Herdr runtime binding changed")
    return current
  }

  class PeerError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
    }
  }

  function request(peer: Peer, method: string, params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const socket = createConnection(peer.socket)
      let received = ""
      const finish = (error?: Error, result?: unknown) => {
        clearTimeout(timer)
        socket.destroy()
        if (error) reject(error)
        else resolve(result)
      }
      const timer = setTimeout(() => finish(new Error(`Herdr ${method} timed out; retain pending outcome`)), 2000)
      socket.on("error", finish)
      socket.on("connect", () => socket.write(JSON.stringify({ id, method, params }) + "\n"))
      socket.on("data", (data) => {
        received += data.toString()
        if (received.length > 4 * 1024 * 1024) {
          finish(new Error("Herdr response exceeds size limit"))
          return
        }
        const end = received.indexOf("\n")
        if (end === -1) return
        try {
          const response = Schema.decodeUnknownSync(
            Schema.Struct({
              id: Schema.String,
              result: Schema.optional(Schema.Unknown),
              error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })),
            }),
          )(JSON.parse(received.slice(0, end)))
          if (response.id !== id) throw new Error("Herdr response identity changed")
          if (response.error) {
            finish(new PeerError(response.error.code, `Herdr ${method}: ${response.error.message}`))
            return
          }
          finish(undefined, response.result)
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Invalid Herdr response"))
        }
      })
      socket.on("end", () => finish(new Error(`Herdr ${method} disconnected; retain pending outcome`)))
    })
  }
}
