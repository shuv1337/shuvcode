import { expect, setSystemTime, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type PermissionRequest, type SessionInfo } from "../src/promise"

const request: PermissionRequest = { id: "per_pending", sessionID: "ses_child", action: "bash", resources: ["pwd"] }

test("cancellation removes an interrupted permission from every client", () => {
  const clients = [fixture(), fixture()]
  try {
    clients.forEach((client) => {
      client.emit({ id: "evt_asked", type: "permission.asked", data: request })
      expect(client.data.session.permission.list(request.sessionID)).toEqual([request])
      client.emit({
        id: "evt_cancelled",
        created: 2,
        type: "permission.cancelled",
        data: { sessionID: request.sessionID, requestID: request.id },
      })
      expect(client.data.session.permission.list(request.sessionID)).toEqual([])
    })
  } finally {
    clients.forEach((client) => client.dispose())
  }
})

test("a permission read cannot resurrect an ask cancelled while it was in flight", async () => {
  const release = Promise.withResolvers<void>()
  const client = fixture(async () => {
    await release.promise
    return Response.json({ data: [request] })
  })
  try {
    const initial = client.data.session.permission.sync(request.sessionID)
    client.emit({ id: "evt_asked", type: "permission.asked", data: request })
    client.emit({
      id: "evt_cancelled",
      created: 2,
      type: "permission.cancelled",
      data: { sessionID: request.sessionID, requestID: request.id },
    })
    release.resolve()
    await initial
    expect(client.data.session.permission.list(request.sessionID)).toEqual([])
  } finally {
    release.resolve()
    client.dispose()
  }
})

test("a permission read retains asks arriving after its snapshot", async () => {
  const release = Promise.withResolvers<void>()
  const client = fixture(async () => {
    await release.promise
    return Response.json({ data: [] })
  })
  try {
    const initial = client.data.session.permission.sync(request.sessionID)
    client.emit({ id: "evt_asked", type: "permission.asked", data: request })
    release.resolve()
    await initial
    expect(client.data.session.permission.list(request.sessionID)).toEqual([request])
  } finally {
    release.resolve()
    client.dispose()
  }
})

test.each(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"] as const)(
  "%s revalidates cached permissions",
  async (type) => {
    let pending = true
    let reads = 0
    const client = fixture(async () => {
      reads++
      return Response.json({ data: pending ? [request] : [] })
    })
    try {
      await client.data.session.permission.sync(request.sessionID)
      expect(client.data.session.permission.list(request.sessionID)).toEqual([request])
      pending = false
      client.emit({
        id: "evt_terminal",
        created: 2,
        type,
        durable: { aggregateID: request.sessionID, seq: 1, version: 1 },
        data: { sessionID: request.sessionID, reason: "user", error: { type: "test", message: "test failure" } },
      })
      await client.data.session.permission.sync(request.sessionID)
      expect(reads).toBe(2)
      expect(client.data.session.permission.list(request.sessionID)).toEqual([])
    } finally {
      client.dispose()
    }
  },
)

test("root loads missing ancestors and merges the orphan family", async () => {
  const reads: string[] = []
  const client = fixture(async (url) => {
    reads.push(url.pathname)
    const id = url.pathname.split("/")[3]
    return Response.json({ data: info(id, id === "ses_parent" ? "ses_root" : undefined) })
  })
  try {
    client.data.session.remember(info("ses_child", "ses_parent"))
    expect(client.data.session.root("ses_child")).toBe("ses_parent")
    await wait(() => client.data.session.get("ses_root") !== undefined)
    expect(client.data.session.root("ses_child")).toBe("ses_root")
    expect(client.data.session.family("ses_child")).toEqual(["ses_child", "ses_parent", "ses_root"])
    expect(reads).toEqual(["/api/session/ses_parent", "/api/session/ses_root"])
  } finally {
    client.dispose()
  }
})

test("root backs off failed ancestor loads and reports one error for concurrent callers", async () => {
  const release = Promise.withResolvers<void>()
  const errors: unknown[] = []
  const reads: string[] = []
  const client = fixture(
    async (url) => {
      reads.push(url.pathname)
      await release.promise
      return Response.json({ error: "ancestor unavailable" }, { status: 500 })
    },
    (error) => errors.push(error),
  )
  setSystemTime(new Date("2026-10-04T20:00:00Z"))
  try {
    client.data.session.remember(info("ses_child", "ses_parent"))
    for (let index = 0; index < 5; index++) expect(client.data.session.root("ses_child")).toBe("ses_parent")
    release.resolve()
    await wait(() => errors.length > 0)
    expect(errors).toHaveLength(1)
    for (let index = 0; index < 5; index++) {
      client.data.session.remember({ ...info("ses_child", "ses_parent"), cost: index })
      client.data.session.list().forEach((session) => client.data.session.root(session.id))
    }
    expect(reads).toEqual(["/api/session/ses_parent"])
    setSystemTime(new Date("2026-10-04T20:01:00Z"))
    client.data.session.root("ses_child")
    await wait(() => errors.length === 2)
    expect(reads).toEqual(["/api/session/ses_parent", "/api/session/ses_parent"])
    client.data.session.remember(info("ses_parent", "ses_root"))
    expect(client.data.session.root("ses_child")).toBe("ses_root")
    await wait(() => errors.length === 3)
    expect(reads.at(-1)).toBe("/api/session/ses_root")
  } finally {
    setSystemTime()
    release.resolve()
    client.dispose()
  }
})

test("root does not load an unknown session", async () => {
  const reads: string[] = []
  const client = fixture(async (url) => {
    reads.push(url.pathname)
    return Response.json({ data: [] })
  })
  try {
    expect(client.data.session.root("ses_missing")).toBe("ses_missing")
    await Bun.sleep(10)
    expect(reads).toEqual([])
  } finally {
    client.dispose()
  }
})

function info(id: string, parentID?: string): SessionInfo {
  return {
    id,
    parentID,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/project" },
  }
}

function fixture(
  read: (url: URL) => Promise<Response> = async () => Response.json({ data: [] }),
  onError?: CreateDataInput["onError"],
) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => read(new URL((input instanceof Request ? input : new Request(input, init)).url)),
  })
  return createRoot((dispose) => ({
    dispose,
    data: createData({
      api: () => api,
      directory: "/project",
      onError,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    emit: (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
  }))
}

async function wait(check: () => boolean) {
  const deadline = Date.now() + 1000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for ancestor sync")
    await Bun.sleep(5)
  }
}
