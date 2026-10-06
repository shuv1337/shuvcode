import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SupervisorNative } from "../src/supervisor/native"
import { isolatedEnv } from "./fixture/environment"

test("native transport adopts a root, replays finite events, and reconciles stable inbox IDs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shuvcode-supervisor-native-"))
  const directory = path.join(root, "project")
  await fs.mkdir(directory)
  const password = "native-fixture-secret"
  const server = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--stdio", "--port", "0"],
    {
      env: isolatedEnv(root, { OPENCODE_SERVER_PASSWORD: password, USERPROFILE: root }),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const url = await readURL(server.stdout)
    const api = SupervisorNative.connect({ url, password })
    const sessionID = "ses_supervisor_native_root"
    const model = { providerID: "anthropic", id: "test-model" }
    const permissions: SupervisorNative.Permissions = [{ action: "read", resource: "*", effect: "allow" }]
    const input = { sessionID, directory, agent: "build", model, permissions }

    expect((await api.info()).version).toBeTruthy()
    expect(await api.create(input)).toMatchObject({ id: sessionID, location: { directory }, model, agent: "build" })
    expect((await api.create(input)).parentID).toBeUndefined()
    expect(api.create({ ...input, directory: root })).rejects.toThrow("unexpected identity or placement")
    expect((await api.get(sessionID)).permissions).toEqual(permissions)
    expect(await api.permissions(directory, sessionID)).toEqual([])
    expect((await api.messages(sessionID)).data).toEqual([])

    const firstID = "msg_supervisor_native_first"
    const prompt = { sessionID, id: firstID, text: "first", delivery: "queue" as const, resume: false }
    expect(await api.prompt(prompt)).toMatchObject({ id: firstID, sessionID, delivery: "queue" })
    expect(await api.prompt({ ...prompt, text: "ignored retry", delivery: "steer" })).toMatchObject({
      id: firstID,
      payload: { text: "first" },
      delivery: "queue",
    })
    expect(await api.inbox(sessionID)).toEqual([{ id: firstID, type: "user", delivery: "queue", text: "first" }])
    expect(await api.active()).toEqual([])

    const initial = await api.log({ sessionID })
    expect(initial.events[0]).toMatchObject({ seq: 0, name: "session.created" })
    expect(initial.events).toContainEqual(
      expect.objectContaining({ name: "session.inbox.enqueued", data: expect.objectContaining({ inboxID: firstID }) }),
    )
    expect(initial.events.every((event) => event.name !== "log.synced")).toBe(true)
    expect(await api.log({ sessionID, after: initial.cursor })).toEqual({ events: [], cursor: initial.cursor })

    await api.cancel({ sessionID, inboxID: firstID })
    expect(await api.inbox(sessionID)).toEqual([])
    expect((await api.log({ sessionID, after: initial.cursor })).events).toContainEqual(
      expect.objectContaining({ name: "session.inbox.cancelled", data: expect.objectContaining({ inboxID: firstID }) }),
    )

    const lostReply = SupervisorNative.connect({
      url,
      password,
      fetch: Object.assign(
        async (request: URL | RequestInfo, init?: RequestInit) => {
          const response = await fetch(request, init)
          const url = request instanceof Request ? request.url : request.toString()
          if (new URL(url).pathname.endsWith("/prompt") && init?.method === "POST") throw new Error("response lost")
          return response
        },
        { preconnect: fetch.preconnect },
      ),
    })
    const uncertainID = "msg_supervisor_native_uncertain"
    await expect(
      lostReply.prompt({ sessionID, id: uncertainID, text: "uncertain", delivery: "queue", resume: false }),
    ).rejects.toBeInstanceOf(SupervisorNative.AdmissionOutcomeUnknownError)
    expect(await api.inbox(sessionID)).toContainEqual({
      id: uncertainID,
      type: "user",
      delivery: "queue",
      text: "uncertain",
    })
    expect(
      await api.prompt({ sessionID, id: uncertainID, text: "changed", delivery: "queue", resume: false }),
    ).toMatchObject({
      id: uncertainID,
      payload: { text: "uncertain" },
    })
  } finally {
    server.kill()
    await server.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

async function readURL(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("{")) continue
        const parsed = JSON.parse(trimmed) as { url?: string }
        if (parsed.url) return parsed.url
      }
    }
  } finally {
    reader.releaseLock()
  }
  throw new Error("fixture server did not report its URL")
}
