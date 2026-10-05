import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { cleanProcessEnv } from "../fixture/clean-env"
import { RUN_SETUP_TIMEOUT_MS } from "../../src/run/setup"
import type { EventSubscribeOutput, SessionMessageInfo, SessionInboxUser } from "@opencode/client/promise"

const repository = path.resolve(import.meta.dir, "../../../..")
const directory = path.join(repository, ".artifacts/i412")
const sessionID = "ses_fixture"
const candidate = process.env.SHUV_RUN_TEST_CLI
  ? [process.env.SHUV_RUN_TEST_CLI]
  : [process.execPath, "run", path.join(repository, "packages/cli/src/index.ts")]

describe("isolated run setup", () => {
  const stalls = [
    { route: "GET /api/location", phase: "Looking up location", args: [] },
    { route: "POST /api/session", phase: "Creating session", args: [] },
    { route: `GET /api/session/${sessionID}`, phase: "Resolving session", args: ["--session", sessionID] },
    { route: "GET /api/session", phase: "Looking up sessions", args: ["--continue"] },
    {
      route: `POST /api/session/${sessionID}/fork`,
      phase: "Forking session",
      args: ["--session", sessionID, "--fork"],
    },
    { route: `PATCH /api/session/${sessionID}`, phase: "Updating session", args: ["--title", "fixture"] },
    { route: `POST /api/session/${sessionID}/agent`, phase: "Selecting agent", args: ["--agent", "build"] },
    { route: `POST /api/session/${sessionID}/model`, phase: "Selecting model", args: ["--model", "test/model"] },
    { route: "GET /api/event", phase: "Connecting event stream", args: [] },
    { route: `POST /api/session/${sessionID}/prompt`, phase: "Admitting prompt", args: ["--format", "json"] },
  ]
  for (const stall of stalls) {
    test(
      `${stall.phase} aborts without retrying or replacing the session`,
      async () => {
        const fixture = await start({ stall: stall.route })
        try {
          const child = fixture.cli(stall.args)
          child.stdin.end()
          const result = await capture(child)
          expect(result.code).toBe(1)
          expect(result.stderr).toContain(stall.phase)
          expect(result.stderr).toContain("timed out after 30s")
          expect(result.stderr).toContain("Reading stdin until EOF")
          expect(fixture.requests.filter((request) => request.route === stall.route)).toHaveLength(1)
          expect(
            fixture.requests.filter((request) => request.route === "POST /api/session").length,
          ).toBeLessThanOrEqual(1)
          expect(fixture.prompts).toHaveLength(stall.phase === "Admitting prompt" ? 1 : 0)
          expect(fixture.requests.some((request) => request.route.endsWith("/interrupt"))).toBe(false)
          if (stall.phase === "Admitting prompt") {
            expect(result.stderr).toContain("Delivery is unknown")
            expect(result.stderr).toContain(`session ${sessionID}`)
            expect(result.stderr).toContain(`request ${fixture.prompts[0]!.id}`)
            const output = JSON.parse(result.stdout.trim())
            expect(output.sessionID).toBe(sessionID)
            expect(output.error.message).toContain(fixture.prompts[0]!.id)
          }
        } finally {
          await fixture.close()
        }
      },
      RUN_SETUP_TIMEOUT_MS + 15_000,
    )
  }

  test(
    "the deadline covers a stalled response body",
    async () => {
      const fixture = await start({ stall: "GET /api/location", body: true })
      try {
        const child = fixture.cli([])
        child.stdin.end()
        const result = await capture(child)
        expect(result.code).toBe(1)
        expect(result.stderr).toContain("Looking up location timed out after 30s")
      } finally {
        await fixture.close()
      }
    },
    RUN_SETUP_TIMEOUT_MS + 15_000,
  )

  test("an open pipe waits for EOF and retains late input", async () => {
    const fixture = await start()
    try {
      const child = fixture.cli([])
      child.stdin.write("first")
      await Bun.sleep(1500)
      expect(child.exitCode).toBeNull()
      expect(fixture.prompts).toHaveLength(0)
      child.stdin.write(" last")
      child.stdin.end()
      const result = await capture(child)
      expect(result.code).toBe(0)
      expect(result.stderr).not.toContain("timed out")
      expect(fixture.prompts).toHaveLength(1)
      expect(fixture.prompts[0]!.text).toBe("hello\nfirst last")
      expect(result.stdout, result.stderr).toContain("fixture response")
    } finally {
      await fixture.close()
    }
  }, 15_000)

  test(
    "execution and its event stream survive beyond the setup deadline",
    async () => {
      const fixture = await start({ duration: RUN_SETUP_TIMEOUT_MS + 1000 })
      try {
        const child = fixture.cli([])
        child.stdin.end()
        const result = await capture(child)
        expect(result.code).toBe(0)
        expect(result.stderr).not.toContain("timed out")
        expect(result.stdout).toContain("fixture response")
        expect(fixture.prompts).toHaveLength(1)
        expect(fixture.streamCancelled).toBe(false)
      } finally {
        await fixture.close()
      }
    },
    RUN_SETUP_TIMEOUT_MS + 15_000,
  )

  test(
    "admission timeout stays bounded while event handling waits on an RPC",
    async () => {
      const fixture = await start({ stall: `POST /api/session/${sessionID}/prompt`, pendingPermission: true })
      try {
        const child = fixture.cli([])
        child.stdin.end()
        const result = await capture(child)
        expect(result.code).toBe(1)
        expect(result.stderr).toContain("Admitting prompt")
        expect(result.stderr).toContain("Delivery is unknown")
        expect(fixture.requests.filter((request) => request.route.endsWith("/reply"))).toHaveLength(1)
        expect(fixture.prompts).toHaveLength(1)
      } finally {
        await fixture.close()
      }
    },
    RUN_SETUP_TIMEOUT_MS + 15_000,
  )
})

async function start(options: { stall?: string; body?: boolean; duration?: number; pendingPermission?: boolean } = {}) {
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(path.join(directory, "fixture-"))
  const requests: { route: string }[] = []
  const prompts: { id: string; text: string }[] = []
  const children: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>[] = []
  const session = {
    id: sessionID,
    projectID: "project",
    title: "fixture",
    location: { directory: root },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  let streamCancelled = false
  let finished = false
  let completion: ReturnType<typeof setTimeout> | undefined
  let resolveWait: (() => void) | undefined
  const wait = new Promise<void>((resolve) => {
    resolveWait = resolve
  })
  const event = (value: EventSubscribeOutput) =>
    stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
  const delivered = () =>
    event({
      id: "evt_delivered",
      created: Date.now(),
      type: "session.inbox.delivered",
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID, inboxID: prompts[0]!.id },
    })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const route = `${request.method} ${url.pathname}`
      requests.push({ route })
      if (route.endsWith("/prompt")) prompts.push(await request.json())
      if (route === options.stall) {
        if (options.pendingPermission) {
          delivered()
          event({
            id: "evt_permission",
            created: Date.now(),
            type: "permission.asked",
            data: { sessionID, id: "per_fixture", action: "shell", resources: [] },
          })
        }
        if (options.body)
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("{"))
              },
            }),
            { headers: { "content-type": "application/json" } },
          )
        return new Promise<Response>(() => {})
      }
      if (options.pendingPermission && url.pathname.endsWith("/reply")) return new Promise<Response>(() => {})
      if (url.pathname === "/api/info") return Response.json({ version: "local" })
      if (url.pathname === "/api/location")
        return Response.json({ directory: root, project: { id: "project", directory: root, canonical: root } })
      if (route === "GET /api/session") return Response.json({ data: [session], cursor: {} })
      if (route === "POST /api/session" || route === `GET /api/session/${sessionID}` || url.pathname.endsWith("/fork"))
        return Response.json({ data: session })
      if (url.pathname === "/api/event")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller
              event({ id: "evt_connected", type: "server.connected", data: {} })
            },
            cancel() {
              if (!finished) streamCancelled = true
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      if (url.pathname.endsWith("/prompt")) {
        delivered()
        completion = setTimeout(() => {
          event({
            id: "evt_text_started",
            created: Date.now(),
            type: "session.text.started",
            durable: { aggregateID: sessionID, seq: 2, version: 1 },
            data: { sessionID, assistantMessageID: "msg_assistant", ordinal: 0 },
          })
          event({
            id: "evt_text_ended",
            created: Date.now(),
            type: "session.text.ended",
            durable: { aggregateID: sessionID, seq: 3, version: 1 },
            data: { sessionID, assistantMessageID: "msg_assistant", ordinal: 0, text: "fixture response" },
          })
          event({
            id: "evt_succeeded",
            created: Date.now(),
            type: "session.execution.succeeded",
            durable: { aggregateID: sessionID, seq: 4, version: 1 },
            data: { sessionID },
          })
          finished = true
          resolveWait?.()
        }, options.duration ?? 10)
        const admitted: SessionInboxUser = {
          id: prompts[0]!.id,
          sessionID,
          type: "user",
          time: { created: 1 },
          payload: { text: prompts[0]!.text },
          delivery: "steer",
        }
        return Response.json({ data: admitted })
      }
      if (url.pathname.endsWith("/wait")) {
        await wait
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith("/message")) {
        // session.messages defaults to descending history, newest assistant first.
        const messages: SessionMessageInfo[] = [
          {
            id: "msg_assistant",
            type: "assistant",
            agent: "build",
            model: { providerID: "test", id: "model" },
            finish: "stop",
            time: { created: 2, completed: 3 },
            content: [{ type: "text", text: "fixture response" }],
          },
          { id: prompts[0]!.id, type: "user", time: { created: 1 }, text: prompts[0]!.text },
        ]
        return Response.json({
          data: messages,
          cursor: {},
        })
      }
      if (url.pathname.endsWith("/form") || url.pathname.endsWith("/permission")) return Response.json({ data: [] })
      if (request.method === "POST" || request.method === "PATCH") return new Response(null, { status: 204 })
      return new Response("unexpected fixture request", { status: 500 })
    },
  })
  return {
    requests,
    prompts,
    get streamCancelled() {
      return streamCancelled
    },
    cli(args: string[]) {
      const child = Bun.spawn([...candidate, "run", "hello", "--server", server.url.href, ...args], {
        cwd: root,
        env: {
          ...cleanProcessEnv(),
          HOME: root,
          PWD: root,
          OPENCODE_TEST_HOME: root,
          OPENCODE_CONFIG_DIR: path.join(root, "config"),
          OPENCODE_CONFIG_CONTENT: "{}",
          OPENCODE_DISABLE_PROJECT_CONFIG: "true",
          XDG_CONFIG_HOME: path.join(root, "config"),
          XDG_DATA_HOME: path.join(root, "data"),
          XDG_STATE_HOME: path.join(root, "state"),
          XDG_CACHE_HOME: path.join(root, "cache"),
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      children.push(child)
      return child
    },
    async close() {
      clearTimeout(completion)
      children.forEach((child) => {
        if (child.exitCode === null) child.kill("SIGKILL")
      })
      await Promise.all(children.map((child) => child.exited))
      await server.stop(true)
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function capture(child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>) {
  const timeout = setTimeout(() => child.kill("SIGKILL"), RUN_SETUP_TIMEOUT_MS + 10_000)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, code }
  } finally {
    clearTimeout(timeout)
  }
}
