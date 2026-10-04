import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([
  { kind: "auto", owner: "ses_parent", width: 100 },
  { kind: "auto", owner: "ses_child", width: 100 },
  { kind: "auto", owner: "ses_sibling", width: 100 },
  { kind: "permission", owner: "ses_parent", width: 100 },
  { kind: "permission", owner: "ses_parent", width: 50 },
  { kind: "form", owner: "ses_parent", width: 100 },
  { kind: "form", owner: "ses_parent", width: 50 },
])("family blockers while viewing a child: %j", async (input) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: input.width, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const parent = {
    id: "ses_parent",
    title: "Parent session",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const child = { ...parent, id: "ses_child", title: "Child session", parentID: parent.id }
  const sibling = { ...child, id: "ses_sibling", title: "Sibling session" }
  const replies: { sessionID: string; body: unknown }[] = []
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/session")
      return json({ data: url.searchParams.get("parentID") === parent.id ? [child, sibling] : [], cursor: {} })
    const info = [parent, child, sibling].find((info) => url.pathname === `/api/session/${info.id}`)
    if (info) return json({ data: info })
    if (/\/permission\/per_family\/reply$/.test(url.pathname)) {
      replies.push({ sessionID: url.pathname.split("/")[3], body: await request.json() })
      return new Response(null, { status: 204 })
    }
    if (/\/permission$/.test(url.pathname) || /\/inbox$/.test(url.pathname)) return json({ data: [] })
    if (/\/message$/.test(url.pathname))
      return json({
        data: [
          {
            id: "msg_child",
            type: "user",
            text: url.pathname.includes(parent.id) ? "Parent transcript" : "Child transcript",
            time: { created: 0 },
          },
        ],
        cursor: {},
      })
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false, tabs: { mode: "off" } }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID: child.id, auto: input.kind !== "permission" },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("Child transcript"))
    const ask = () => {
      if (input.kind === "form") {
        events.emit({
          id: "evt_form",
          created: 1,
          type: "form.created",
          location: { directory },
          data: {
            form: {
              id: "form_parent",
              sessionID: parent.id,
              title: "Parent question",
              fields: [{ type: "string", key: "answer", title: "Answer", required: true }],
            },
          },
        })
        return
      }
      events.emit({
        id: "evt_permission",
        created: 1,
        type: "permission.asked",
        data: { id: "per_family", sessionID: input.owner, action: "bash", resources: ["bun test"] },
      })
    }
    ask()
    if (input.kind === "auto") {
      await setup.waitFor(() => replies.length === 1)
      expect(replies).toEqual([{ sessionID: input.owner, body: { decision: "once" } }])
      expect(setup.captureCharFrame()).toContain("Child transcript")
      return
    }
    await setup.waitForFrame((frame) => frame.includes("Parent is waiting for you") && frame.includes("Open parent"))
    expect(replies).toEqual([])
    events.emit(
      input.kind === "form"
        ? { id: "evt_cancelled", created: 2, type: "form.cancelled", data: { sessionID: parent.id, id: "form_parent" } }
        : {
            id: "evt_cancelled",
            created: 2,
            type: "permission.cancelled",
            data: { sessionID: parent.id, requestID: "per_family" },
          },
    )
    await setup.waitForFrame((frame) => !frame.includes("Parent is waiting for you"))
    ask()
    await setup.waitForFrame((frame) => frame.includes("Open parent"))
    const rows = setup.captureCharFrame().split("\n")
    const row = rows.findIndex((line) => line.includes("Open parent"))
    await setup.mockMouse.click(rows[row].indexOf("Open parent") + 1, row)
    await setup.waitForFrame((frame) => frame.includes("Parent transcript"))
    await setup.waitForFrame((frame) =>
      frame.includes(input.kind === "form" ? "Parent question" : "Permission required"),
    )
    expect(setup.captureCharFrame()).not.toContain("Parent is waiting for you")
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
