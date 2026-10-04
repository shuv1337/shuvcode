import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"

test("serve retains durable session events beyond the synced marker", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shuvcode-event-persist-"))
  const password = "event-persist-secret"
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
    const types = eventTypes(body)
    expect(log.status, body).toBe(200)
    expect(types, body).toContain("session.created")
    expect(types, body).toContain("log.synced")
  } finally {
    server.kill()
    await server.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

function eventTypes(body: string) {
  return body.split("\n").flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) return []
    const payload = trimmed.slice("data:".length).trim()
    if (!payload) return []
    const decoded = JSON.parse(payload) as { type?: string }
    return decoded.type ? [decoded.type] : []
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
