import { OpenCode, type OpenCodeClient } from "@opencode-ai/client"
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"

test("CLI opt-in retains the session log and exclusive cursor across process death", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shuvcode-event-persistence-"))
  const children: Bun.Subprocess[] = []
  try {
    const first = await start(root, { OPENCODE_PERSIST_EVENTS: "true" })
    children.push(first.child)
    const session = await first.client.session.create({ location: { directory: root } })
    await first.client.session.prompt({
      sessionID: session.id,
      id: "msg_persist_before_crash",
      text: "Synthetic admission before crash",
      delivery: "queue",
      resume: false,
    })
    const before = await log(first.client, session.id)
    expect(before.some((item) => item.type === "session.inbox.enqueued")).toBe(true)
    const marker = before.at(-1)
    if (marker?.type !== "log.synced" || marker.seq === undefined) throw new Error("Missing log watermark")
    const cursor = marker.seq

    first.child.kill("SIGKILL")
    await first.child.exited
    const second = await start(root, { OPENCODE_PERSIST_EVENTS: "true" })
    children.push(second.child)
    expect(await log(second.client, session.id)).toEqual(before)
    expect(await log(second.client, session.id, cursor)).toEqual([marker])

    await second.client.session.prompt({
      sessionID: session.id,
      id: "msg_persist_after_crash",
      text: "Synthetic admission after crash",
      delivery: "queue",
      resume: false,
    })
    const after = await log(second.client, session.id, cursor)
    expect(after.filter((item) => item.type === "session.inbox.enqueued")).toHaveLength(1)
    expect(after.slice(0, -1).every((item) => "durable" in item && item.durable.seq > cursor)).toBe(true)
    expect((await second.client.session.inbox.list({ sessionID: session.id })).map((item) => item.id)).toEqual([
      "msg_persist_before_crash",
      "msg_persist_after_crash",
    ])
  } finally {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode === null) child.kill("SIGKILL")
        await child.exited
      }),
    )
    await fs.rm(root, { recursive: true, force: true })
  }
}, 60_000)

test.each([
  { name: "stdio defaults off", mode: "stdio", value: undefined, configured: undefined, expected: false },
  {
    name: "foreground environment enables persistence",
    mode: "default",
    value: "true",
    configured: undefined,
    expected: true,
  },
  { name: "managed service defaults off", mode: "service", value: undefined, configured: undefined, expected: false },
  {
    name: "managed service reads configured environment",
    mode: "service",
    value: undefined,
    configured: "true",
    expected: true,
  },
  {
    name: "explicit false overrides managed configuration",
    mode: "service",
    value: "false",
    configured: "true",
    expected: false,
  },
] as const)(
  "CLI event persistence: $name",
  async ({ mode, value, configured, expected }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "shuvcode-event-options-"))
    await fs.mkdir(path.join(root, "config"), { recursive: true })
    await Bun.write(
      path.join(root, "config", ServiceConfig.filename(process.env.SHUV_EVENT_CHANNEL)),
      JSON.stringify({
        password: "synthetic-event-persistence-password",
        env: configured === undefined ? {} : { OPENCODE_PERSIST_EVENTS: configured },
      }),
    )
    const server = await start(root, { OPENCODE_PERSIST_EVENTS: value }, mode)
    try {
      const session = await server.client.session.create({ location: { directory: root } })
      const events = await log(server.client, session.id)
      expect(events.some((item) => item.type === "session.created")).toBe(expected)
      expect(events.at(-1)).toMatchObject({ type: "log.synced", aggregateID: session.id })
    } finally {
      server.child.kill("SIGKILL")
      await server.child.exited
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)

async function log(client: OpenCodeClient, sessionID: string, after?: number) {
  return Array.fromAsync(
    client.session.log({ sessionID, after, follow: false }, { signal: AbortSignal.timeout(10_000) }),
  )
}

async function start(
  root: string,
  overrides: Record<string, string | undefined>,
  mode: "default" | "service" | "stdio" = "stdio",
) {
  const child = Bun.spawn(
    [
      ...(process.env.SHUV_EVENT_BINARY
        ? [process.env.SHUV_EVENT_BINARY]
        : [process.execPath, path.join(import.meta.dir, "../src/index.ts")]),
      "serve",
      ...(mode === "default" ? [] : [`--${mode}`]),
      "--port",
      "0",
    ],
    {
      cwd: path.join(import.meta.dir, ".."),
      env: isolatedEnv(root, {
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_CONFIG_PROJECT_DISABLE: "true",
        OPENCODE_DISABLE_FFF: "true",
        OPENCODE_PASSWORD: "synthetic-event-persistence-password",
        ...overrides,
      }),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const diagnostics = new Response(child.stderr).text()
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  const output = { text: "" }
  const ready = (async () => {
    while (!output.text.includes("\n")) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error("CLI exited before listening")
      output.text += decoder.decode(chunk.value, { stream: true })
    }
    const line = output.text.slice(0, output.text.indexOf("\n"))
    const address: unknown =
      mode === "stdio" ? JSON.parse(line) : { url: line.match(/^server listening on (.+)$/)?.[1] }
    if (typeof address !== "object" || address === null || !("url" in address) || typeof address.url !== "string") {
      throw new Error("CLI did not report a server URL")
    }
    return OpenCode.make({
      baseUrl: address.url,
      headers: { authorization: "Basic " + btoa("opencode:synthetic-event-persistence-password") },
    })
  })()
  try {
    const client = await Promise.race([
      ready,
      Bun.sleep(20_000).then(() => {
        throw new Error("CLI start timed out")
      }),
    ])
    await client.health.get()
    return { child, client }
  } catch (error) {
    child.kill("SIGKILL")
    await child.exited
    throw new Error(await diagnostics, { cause: error })
  } finally {
    reader.releaseLock()
  }
}
