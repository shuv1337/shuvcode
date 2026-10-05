import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"

test("serve replays durable events after a restart and removes them with the session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shuvcode-event-persist-"))
  const password = "event-persist-secret"
  const servers = [spawnServer(root, password)]
  try {
    const url = await readURL(servers[0].stdout)
    const authorization = `Basic ${btoa(`opencode:${password}`)}`
    const created = await fetch(new URL("/api/session", url), {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ title: "persist" }),
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as { data: { id: string } }
    const log = await fetch(new URL(`/api/experimental/session/${session.data.id}/log`, url), {
      headers: { authorization },
    })
    const body = await log.text()
    const events = logEvents(body)
    expect(log.status, body).toBe(200)
    expect(events.map((event) => event.type), body).toContain("session.created")
    expect(events.map((event) => event.type), body).toContain("log.synced")
    const createdEvent = events.find((event) => event.type === "session.created")!
    expect(createdEvent.durable?.seq).toBe(0)

    const renamed = await fetch(new URL(`/api/session/${session.data.id}`, url), {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ title: "persist after restart" }),
    })
    expect(renamed.status).toBe(204)
    const before = await fetch(new URL(`/api/experimental/session/${session.data.id}/log`, url), {
      headers: { authorization },
    })
    expect(before.status).toBe(200)
    const retained = logEvents(await before.text()).filter((event) => event.type !== "log.synced")
    expect(retained.map((event) => event.type)).toEqual(["session.created", "session.renamed"])
    expect(retained.map((event) => event.durable?.seq)).toEqual([0, 1])

    // An abrupt process exit exercises committed SQLite/WAL recovery, not just an in-memory log.
    servers[0].kill("SIGKILL")
    await servers[0].exited
    servers.push(spawnServer(root, password))
    const restartedURL = await readURL(servers[1].stdout)
    const replay = await fetch(new URL(`/api/experimental/session/${session.data.id}/log`, restartedURL), {
      headers: { authorization },
    })
    expect(replay.status).toBe(200)
    const replayed = logEvents(await replay.text())
    expect(replayed.filter((event) => event.type !== "log.synced")).toEqual(retained)
    expect(replayed.at(-1)?.type).toBe("log.synced")
    const resumed = await fetch(
      new URL(`/api/experimental/session/${session.data.id}/log?after=0`, restartedURL),
      { headers: { authorization } },
    )
    expect(resumed.status).toBe(200)
    expect(logEvents(await resumed.text()).filter((event) => event.type !== "log.synced")).toEqual(retained.slice(1))

    const restored = await fetch(new URL(`/api/session/${session.data.id}`, restartedURL), {
      headers: { authorization },
    })
    expect(restored.status).toBe(200)
    expect((await restored.json()).data.title).toBe("persist after restart")
    const db = new Database(path.join(root, "opencode.db"), { readonly: true })
    try {
      expect(db.query("SELECT id FROM event WHERE aggregate_id = ? ORDER BY seq").all(session.data.id)).toEqual(
        retained.map((event) => ({ id: event.id })),
      )
      const deleted = await fetch(new URL(`/api/session/${session.data.id}`, restartedURL), {
        method: "DELETE",
        headers: { authorization },
      })
      expect(deleted.status).toBe(204)
      expect(db.query("SELECT id FROM event WHERE aggregate_id = ?").all(session.data.id)).toEqual([])
      expect(db.query("SELECT seq FROM event_sequence WHERE aggregate_id = ?").all(session.data.id)).toEqual([])
    } finally {
      db.close()
    }
  } finally {
    servers.forEach((server) => server.kill())
    await Promise.all(servers.map((server) => server.exited))
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

function spawnServer(root: string, password: string) {
  // The same behavioral check can run against a locally built executable without changing installed binaries.
  const command = process.env.SHUVCODE_EVENT_TEST_BINARY
    ? [process.env.SHUVCODE_EVENT_TEST_BINARY]
    : [process.execPath, path.join(import.meta.dir, "../src/index.ts")]
  return Bun.spawn([...command, "serve", "--stdio", "--port", "0"], {
    env: isolatedEnv(root, { OPENCODE_SERVER_PASSWORD: password, USERPROFILE: root }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
}

function logEvents(body: string) {
  return body.split("\n").flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) return []
    const payload = trimmed.slice("data:".length).trim()
    if (!payload) return []
    return [JSON.parse(payload) as { id?: string; type: string; durable?: { seq: number } }]
  })
}

async function readURL(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const result = await reader.read()
    if (result.done) break
    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("{")) continue
      const parsed = JSON.parse(trimmed) as { url?: string }
      if (parsed.url) {
        reader.releaseLock()
        return parsed.url
      }
    }
  }
  reader.releaseLock()
  throw new Error(`server did not report a url: ${buffer}`)
}
