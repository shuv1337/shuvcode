import { afterEach, expect, test } from "bun:test"
import { SupervisorBoard } from "../src/supervisor/board"
import type { SupervisorProtocol } from "../src/supervisor/protocol"

const boards: { close: () => void }[] = []
const status = () => ({
  lead: { generation: 7, active: true },
  projects: [{ id: "app", path: "/work/app", archived: false }],
  defaultProject: "app",
  backlog: [
    {
      id: "work-1",
      projectID: "app",
      brief: "Ship app",
      state: "in-flight",
      taskID: "task-1",
      readiness: { eligible: false, reasons: ["state:in-flight"] },
      updatedAt: 1,
    },
    {
      id: "work-2",
      projectID: "app",
      brief: "Ship docs",
      state: "queued",
      readiness: { eligible: false, reasons: ["dependency:work-1"] },
      updatedAt: 2,
    },
  ],
  tasks: [
    {
      id: "task-1",
      project: "/work/app",
      brief: "Ship app",
      status: "active",
      native: { state: "working" },
      decisions: [
        { id: "decision-1", payload: { question: "Which release?", requiredAuthority: "user", category: "scope" } },
      ],
    },
  ],
  deliveries: [{ taskID: "task-0", status: "blocked", mode: "manual", blocker: "CI red" }],
})

function board(request: SupervisorBoard.Request) {
  const running = SupervisorBoard.serve({ home: "/tmp/supervisor-board-test", request })
  boards.push(running)
  const url = new URL(running.url)
  const token = new URLSearchParams(url.hash.slice(1)).get("token")
  if (!token) throw new Error("Board did not return a token")
  url.hash = ""
  const headers = { authorization: `Bearer ${token}`, "x-board-origin": url.origin }
  return { url, headers }
}

function click(
  input: ReturnType<typeof board>,
  patch: Record<string, unknown> = {},
  headers: HeadersInit = input.headers,
) {
  return fetch(new URL("/api/decision", input.url), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      action: "answer",
      taskID: "task-1",
      decisionID: "decision-1",
      expectedQuestion: "Which release?",
      answer: "Stable",
      requestID: "request-123",
      ...patch,
    }),
  })
}

afterEach(() => boards.splice(0).forEach((item) => item.close()))

test("board is loopback-only and exposes a token outside HTTP requests", async () => {
  expect(() => SupervisorBoard.serve({ home: "/tmp/board", hostname: "0.0.0.0" })).toThrow(/127\.0\.0\.1/)
  const input = board(async () => status())
  expect(input.url.hostname).toBe("127.0.0.1")
  const page = await fetch(input.url)
  expect(page.status).toBe(200)
  expect(page.headers.get("content-security-policy")).toContain("script-src 'nonce-")
  expect(page.headers.get("cache-control")).toBe("no-store")
  expect(await page.text()).not.toContain(input.headers.authorization.slice(7))
})

test("snapshot projects waiting decisions, active work, queue gates, and recent delivery", async () => {
  const input = board(async () => status())
  const response = await fetch(new URL("/api/snapshot", input.url), { headers: input.headers })
  expect(response.status).toBe(200)
  const snapshot = await response.json()
  expect(snapshot).toMatchObject({
    leadActive: true,
    defaultProject: "app",
    waiting: [{ taskID: "task-1", project: "app", decisionID: "decision-1", question: "Which release?" }],
    underway: [{ taskID: "task-1", project: "app", state: "working" }],
    queued: [{ id: "work-2", gates: ["dependency:work-1"] }],
    recent: [{ taskID: "task-0", status: "blocked", blocker: "CI red" }],
  })
})

test("API requires the bearer token and matching same-origin headers", async () => {
  const input = board(async () => status())
  const url = new URL("/api/snapshot", input.url)
  expect((await fetch(url)).status).toBe(401)
  expect(
    (await fetch(url, { headers: { ...input.headers, "x-board-origin": "https://elsewhere.example" } })).status,
  ).toBe(403)
  expect((await fetch(url, { headers: { ...input.headers, origin: "https://elsewhere.example" } })).status).toBe(403)
  expect((await fetch(url, { headers: { ...input.headers, "sec-fetch-site": "cross-site" } })).status).toBe(403)
})

test("answer passes the question and request ID through and replays one click", async () => {
  const operations: SupervisorProtocol.Operation[] = []
  const input = board(async (operation) => {
    operations.push(operation)
    return operation.type === "status" ? status() : { ok: true }
  })
  const first = await click(input)
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ recorded: true, action: "answer" })
  const second = await click(input)
  expect(second.status).toBe(200)
  expect(operations.filter((item) => item.type === "decision.resolve")).toEqual([
    {
      type: "decision.resolve",
      generation: 7,
      taskID: "task-1",
      id: "decision-1",
      answer: "Stable",
      expectedQuestion: "Which release?",
      requestID: "request-123",
    },
  ])
  expect((await click(input, { answer: "Beta" })).status).toBe(409)
})

test("stale questions and answered decisions do not emit mutations", async () => {
  const operations: SupervisorProtocol.Operation[] = []
  const current = status()
  const input = board(async (operation) => {
    operations.push(operation)
    return current
  })
  expect((await click(input, { expectedQuestion: "Old question" })).status).toBe(409)
  current.tasks[0]!.decisions[0]!.payload.question = "New question"
  expect((await click(input)).status).toBe(409)
  expect(operations.every((item) => item.type === "status")).toBe(true)
})

test("Later holds work without resolving the question", async () => {
  const operations: SupervisorProtocol.Operation[] = []
  const input = board(async (operation) => {
    operations.push(operation)
    return operation.type === "status" ? status() : { ok: true }
  })
  const response = await click(input, { action: "later", answer: undefined, requestID: "request-456" })
  expect(response.status).toBe(200)
  expect(operations.filter((item) => item.type !== "status")).toEqual([
    { type: "work.hold", generation: 7, id: "work-1", reason: "Decision task-1/decision-1" },
  ])
  expect((await click(input, { action: "later", answer: "No", requestID: "request-789" })).status).toBe(400)
})

test("unavailable status returns an explicit gateway error", async () => {
  const input = board(async () => {
    throw new Error("offline")
  })
  expect((await fetch(new URL("/api/snapshot", input.url), { headers: input.headers })).status).toBe(502)
})
