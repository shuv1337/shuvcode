import { expect, test } from "bun:test"
import { createServer } from "node:net"
import path from "node:path"
import { managedEval } from "./fixtures/supervisor-managed-eval"
import { isolatedEnv } from "./fixture/environment"

test.each(["identity", "capability"] as const)(
  "an incompatible Herdr %s does not block native startup",
  async (fault) => {
    await using fixture = await managedEval()
    await using peer = await herdr(fixture.root)
    peer.state.fault = fault
    try {
      await open(fixture, peer.socket)
      const status = await until(async () => {
        const current = await Bun.file(path.join(fixture.home, "herdr-status.json"))
          .json()
          .catch(() => undefined)
        return current?.error ? current : undefined
      })
      expect(status.available).toBe(false)
      expect(peer.calls.filter((call) => call.method !== "ping")).toHaveLength(0)
      const native = await fixture.cli(["status", "--home", fixture.home, "--json"])
      expect(native.code).toBe(0)
      expect(JSON.parse(native.stdout)).toMatchObject({
        health: "running",
        leadState: "idle",
        herdr: { available: false },
      })
    } finally {
      await fixture.cli(["stop", "--home", fixture.home])
    }
  },
  45_000,
)

test("an uncertain Herdr workspace creation stays recorded across supervisor restart", async () => {
  await using fixture = await managedEval()
  await using peer = await herdr(fixture.root)
  peer.state.fault = "create"
  try {
    await open(fixture, peer.socket)
    await until(async () => (await entries(fixture)).find((entry) => entry.phase === "create_pending"))
    expect(peer.calls.filter((call) => call.method === "workspace.create")).toHaveLength(1)
    expect((await fixture.cli(["stop", "--home", fixture.home])).code).toBe(0)
    expect((await fixture.cli(["start", "--home", fixture.home])).code).toBe(0)
    await until(async () => {
      const status = await Bun.file(path.join(fixture.home, "herdr-status.json")).json()
      return status.error?.includes("creation is uncertain")
    })
    expect(peer.calls.filter((call) => call.method === "workspace.create")).toHaveLength(1)
    expect((await entries(fixture))[0]?.phase).toBe("create_pending")
    expect(peer.calls.filter((call) => call.method === "pane.send_input")).toHaveLength(0)
  } finally {
    await fixture.cli(["stop", "--home", fixture.home])
  }
}, 45_000)

test("lost launch acknowledgement is never resent and reopening restores only the closed view", async () => {
  await using fixture = await managedEval()
  await using peer = await herdr(fixture.root)
  peer.state.fault = "launch"
  try {
    await open(fixture, peer.socket)
    const pending = await until(async () => (await entries(fixture)).find((entry) => entry.phase === "launch_pending"))
    const checks = peer.calls.filter((call) => call.method === "pane.process_info").length
    await until(async () => peer.calls.filter((call) => call.method === "pane.process_info").length >= checks + 2)
    expect(peer.calls.filter((call) => call.method === "pane.send_input")).toHaveLength(1)
    expect(peer.calls.filter((call) => call.method === "pane.report_runtime")).toHaveLength(0)
    peer.state.launched = true
    const ready = await until(async () =>
      (await entries(fixture)).find((entry) => entry.phase === "ready" && entry.seq > 0),
    )
    expect(ready.attachment).toEqual(pending.attachment)
    await open(fixture, peer.socket)
    await until(async () => (await entries(fixture)).some((entry) => entry.seq > ready.seq))
    expect(peer.calls.filter((call) => call.method === "workspace.create")).toHaveLength(1)
    expect(peer.calls.filter((call) => call.method === "pane.send_input")).toHaveLength(1)

    peer.state.closed.add(ready.pane!.pane_id)
    await until(async () => (await entries(fixture)).find((entry) => entry.phase === "closed"))
    peer.state.fault = undefined
    await open(fixture, peer.socket)
    const reopened = await until(async () =>
      (await entries(fixture)).find((entry) => entry.phase === "ready" && entry.bindingID !== ready.bindingID),
    )
    expect(reopened.attachment).toEqual(ready.attachment)
    expect(reopened.pane!.pane_id).not.toBe(ready.pane!.pane_id)
    expect(await entries(fixture)).toHaveLength(2)
    expect(peer.calls.filter((call) => call.method === "workspace.create")).toHaveLength(2)
    const native = await fixture.cli(["status", "--home", fixture.home, "--json"])
    expect(JSON.parse(native.stdout).lead.sessionID).toBe(ready.attachment.session_id)
    expect(fixture.requests).toHaveLength(0)

    expect((await fixture.cli(["lead", "--new", "--no-open", "--home", fixture.home])).code).toBe(0)
    const replacement = JSON.parse((await fixture.cli(["status", "--home", fixture.home, "--json"])).stdout).lead
      .sessionID
    const focus = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import { SupervisorHerdr } from ${JSON.stringify(path.join(import.meta.dir, "../src/supervisor/herdr.ts"))}
      import { SupervisorSettings } from ${JSON.stringify(path.join(import.meta.dir, "../src/supervisor/settings.ts"))}
      console.log(await SupervisorHerdr.focus(await SupervisorSettings.read(process.env.FLEET_TEST_HOME), process.env.FLEET_TEST_SESSION))
    `,
      ],
      {
        env: isolatedEnv(fixture.root, {
          HERDR_SOCKET_PATH: peer.socket,
          HERDR_SESSION: "native-fixture",
          HERDR_PANE_ID: "launcher-pane",
          FLEET_TEST_HOME: fixture.home,
          FLEET_TEST_SESSION: replacement,
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    expect(await focus.exited).toBe(0)
    expect((await new Response(focus.stdout).text()).trim()).toBe("false")
    expect(peer.calls.filter((call) => call.method === "pane.focus")).toHaveLength(0)
  } finally {
    await fixture.cli(["stop", "--home", fixture.home])
  }
}, 60_000)

async function open(fixture: Awaited<ReturnType<typeof managedEval>>, socket: string) {
  const result = await fixture.rootCli(["supervisor", "--no-open", "--home", fixture.home], {
    HERDR_SOCKET_PATH: socket,
    HERDR_SESSION: "native-fixture",
  })
  if (result.code !== 0) throw new Error(result.stderr)
}

type Entry = {
  phase: string
  bindingID: string
  seq: number
  pane?: { pane_id: string }
  attachment: { session_id: string }
}

async function entries(fixture: Awaited<ReturnType<typeof managedEval>>): Promise<Entry[]> {
  const journal = await Bun.file(path.join(fixture.home, "herdr-views.json"))
    .json()
    .catch(() => undefined)
  return journal?.peers[0]?.entries ?? []
}

async function until<T>(probe: () => Promise<T | undefined | false>) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await Bun.sleep(50)
  }
  throw new Error("Herdr presentation did not reach the expected state")
}

async function herdr(root: string) {
  const socket = path.join(root, "peer.sock")
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const state: { fault?: "identity" | "capability" | "create" | "launch"; launched: boolean; closed: Set<string> } = {
    launched: false,
    closed: new Set(),
  }
  const panes = new Map<
    string,
    {
      pane: { pane_id: string; workspace_id: string; tab_id: string }
      binding?: { binding_id: unknown; attachment: { attach_argv: string[] }; seq: number | null }
    }
  >()
  const server = createServer((connection) => {
    let received = ""
    connection.on("data", (data) => {
      received += data.toString()
      if (!received.includes("\n")) return
      const request = JSON.parse(received.split("\n")[0]!)
      calls.push(request)
      if (request.method === "ping")
        return reply({
          session_name: state.fault === "identity" ? "another-peer" : "native-fixture",
          capabilities: {
            runtime_attachment_methods:
              state.fault === "capability"
                ? []
                : ["pane.bind_runtime", "pane.get_runtime", "pane.report_runtime", "pane.unbind_runtime"],
          },
        })
      if (request.method === "workspace.create") {
        const id = `w${panes.size + 1}`
        const pane = { pane_id: `${id}:p1`, workspace_id: id, tab_id: `${id}:t1` }
        panes.set(pane.pane_id, { pane })
        if (state.fault === "create") {
          connection.destroy()
          return
        }
        return reply({ workspace: { workspace_id: id }, tab: { tab_id: pane.tab_id }, root_pane: pane })
      }
      const record = panes.get(request.params.pane_id)
      if (!record || state.closed.has(request.params.pane_id)) {
        connection.end(
          JSON.stringify({ id: request.id, error: { code: "pane_not_found", message: "Pane closed" } }) + "\n",
        )
        return
      }
      if (request.method === "pane.get") return reply({ pane: record.pane })
      if (request.method === "pane.focus") return reply({ focused: true })
      if (request.method === "pane.get_runtime") return reply({ binding: record.binding ?? null })
      if (request.method === "pane.bind_runtime") {
        record.binding = { binding_id: request.params.binding_id, attachment: request.params.attachment, seq: null }
        return reply({ applied: true })
      }
      if (request.method === "pane.process_info")
        return reply({
          process_info: {
            shell_pid: 100,
            foreground_process_group_id: state.launched ? 101 : 100,
            foreground_processes: state.launched
              ? [{ pid: 101, argv: record.binding!.attachment.attach_argv }]
              : [{ pid: 100, argv: ["/bin/sh"] }],
          },
        })
      if (request.method === "pane.send_input") {
        if (state.fault === "launch") {
          connection.destroy()
          return
        }
        state.launched = true
        return reply({ sent: true })
      }
      if (request.method === "pane.report_runtime") {
        record.binding!.seq = request.params.seq
        return reply({ applied: true, binding: record.binding })
      }
      throw new Error(`Unexpected Herdr method: ${request.method}`)

      function reply(result: unknown) {
        connection.end(JSON.stringify({ id: request.id, result }) + "\n")
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(socket, resolve))
  return {
    socket,
    calls,
    state,
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
