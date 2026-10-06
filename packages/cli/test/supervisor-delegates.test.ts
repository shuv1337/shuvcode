import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorDelegates } from "../src/supervisor/delegates"

const directories: string[] = []
const databases: DatabaseSync[] = []
function database(directory?: string) {
  const root = directory ?? mkdtempSync(join(tmpdir(), "supervisor-delegates-"))
  if (!directory) directories.push(root)
  const db = new DatabaseSync(join(root, "workflow.sqlite"))
  databases.push(db)
  return { root, db, delegates: SupervisorDelegates.open(db) }
}

afterEach(() => {
  databases.splice(0).forEach((db) => db.close())
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

test("delegate route identity is stable while scope and enabled state are editable", () => {
  const first = database()
  const input = {
    id: "scout-east",
    home: "/srv/shuv/supervisor",
    host: "shuv@east.example",
    scope: "docs",
    sourceProjectID: "source",
  }
  expect(first.delegates.add(input)).toMatchObject({ ...input, enabled: true })
  expect(first.delegates.add(input).id).toBe(input.id)
  expect(() => first.delegates.add({ ...input, host: "elsewhere" })).toThrow(/Conflicting/)
  expect(() => first.delegates.update(input.id, { home: "/tmp/other" } as SupervisorDelegates.Patch)).toThrow(
    /immutable/,
  )
  expect(() => first.delegates.update(input.id, { sourceProjectID: "other" } as SupervisorDelegates.Patch)).toThrow(
    /immutable/,
  )
  expect(first.delegates.update(input.id, { scope: "docs and tests", projectID: "target" })).toMatchObject({
    home: input.home,
    host: input.host,
    sourceProjectID: "source",
    scope: "docs and tests",
    projectID: "target",
  })
  expect(first.delegates.archive(input.id).enabled).toBe(false)
  expect(first.delegates.list()).toEqual([])
  first.db.close()
  databases.pop()
  expect(database(first.root).delegates.list({ includeArchived: true })[0]).toMatchObject({
    id: input.id,
    home: input.home,
    host: input.host,
    enabled: false,
  })
  expect(() => database(first.root).delegates.add({ ...input, host: "-oProxyCommand=bad" })).toThrow()
})

test("source handoff replays first payload and preserves unknown route for explicit retry", () => {
  const first = database()
  first.delegates.add({ id: "remote", home: "/srv/remote", host: "user@remote", scope: "research" })
  const input = { id: "handoff-1", delegateID: "remote", sourceWorkIDs: ["work-a"], payload: { brief: "inspect" } }
  expect(first.delegates.enqueue(input)).toMatchObject({ state: "pending", ...input })
  first.delegates.archive("remote")
  expect(first.delegates.enqueue(input).state).toBe("pending")
  expect(() => first.delegates.enqueue({ ...input, payload: { brief: "changed" } })).toThrow(/Conflicting/)
  expect(first.delegates.markUnknown(input.id, "SSH timed out")).toMatchObject({
    state: "unknown",
    error: "SSH timed out",
    delegateID: "remote",
  })
  expect(first.delegates.pending()).toEqual([])
  first.db.close()
  databases.pop()
  const reopened = database(first.root)
  expect(reopened.delegates.handoff(input.id)?.state).toBe("unknown")
  expect(reopened.delegates.retry(input.id).state).toBe("pending")
  expect(reopened.delegates.ackReceived(input.id, { receiver: "ready" }).state).toBe("received")
  expect(reopened.delegates.complete(input.id, { report: "done" }).state).toBe("completed")
  expect(reopened.delegates.handoff(input.id)).toMatchObject({
    receipt: { receiver: "ready" },
    result: { report: "done" },
    sourceWorkIDs: ["work-a"],
  })
})

test("receiver applies once and rolls back callback writes even inside an outer transaction", () => {
  const { db, delegates } = database()
  db.exec("CREATE TABLE admitted (id TEXT PRIMARY KEY)")
  const input = { id: "handoff-1", sourceHome: "/srv/source", payload: { work: ["a"] } }
  db.exec("BEGIN IMMEDIATE")
  expect(() =>
    delegates.receive(input, () => {
      db.prepare("INSERT INTO admitted (id) VALUES ('a')").run()
      throw new Error("failed after insert")
    }),
  ).toThrow("failed after insert")
  db.exec("COMMIT")
  expect(db.prepare("SELECT id FROM admitted").all()).toEqual([])
  expect(delegates.received(input.id)).toBeUndefined()
  const received = delegates.receive(input, () => {
    db.prepare("INSERT INTO admitted (id) VALUES ('a')").run()
    return { accepted: ["a"] }
  })
  expect(received.receipt).toEqual({ accepted: ["a"] })
  expect(
    delegates.receive(input, () => {
      throw new Error("duplicate applied")
    }),
  ).toEqual(received)
  expect(db.prepare("SELECT id FROM admitted").all()).toEqual([{ id: "a" }])
  expect(() => delegates.receive({ ...input, sourceHome: "/srv/other" }, () => null)).toThrow(/Conflicting/)
  expect(() => delegates.receive({ ...input, payload: { work: ["b"] } }, () => null)).toThrow(/Conflicting/)
})

test("closure includes queued ancestors and rejects missing, active, or unmet dependencies", () => {
  const ancestor: SupervisorDelegates.Work = { id: "ancestor", state: "queued", dependencies: [] }
  const child: SupervisorDelegates.Work = {
    id: "child",
    state: "queued",
    dependencies: [{ id: "ancestor", when: "done" }],
  }
  expect(SupervisorDelegates.closure([ancestor, child], ["child"])).toEqual(["ancestor", "child"])
  expect(() => SupervisorDelegates.closure([child], ["child"])).toThrow(/Missing/)
  expect(() => SupervisorDelegates.closure([{ ...ancestor, state: "in-flight" }, child], ["child"])).toThrow(/Unmet/)
  const landed = { id: "landed", state: "done" as const, landed: { commit: "abc" }, dependencies: [] }
  expect(
    SupervisorDelegates.closure([landed, { ...child, dependencies: [{ id: "landed", when: "landed" }] }], ["child"]),
  ).toEqual(["child"])
  expect(() =>
    SupervisorDelegates.closure(
      [
        { ...landed, landed: undefined },
        { ...child, dependencies: [{ id: "landed", when: "landed" }] },
      ],
      ["child"],
    ),
  ).toThrow(/Unmet/)
})

test("remote requests use fixed SSH argv and quoted home with JSON stdin; no local fallback", async () => {
  const { delegates } = database()
  const delegate = delegates.add({
    id: "remote",
    home: "/srv/owner's supervisor",
    host: "user@remote",
    scope: "research",
  })
  const calls: { argv: string[]; stdin: string; timeoutMs: number }[] = []
  const runner: SupervisorDelegates.Runner = async (argv, stdin, timeoutMs) => {
    calls.push({ argv, stdin, timeoutMs })
    return { exitCode: 0, stdout: JSON.stringify({ result: { ok: true } }), stderr: "" }
  }
  expect(await SupervisorDelegates.request(delegate, { type: "status" }, runner)).toEqual({
    state: "ok",
    result: { ok: true },
  })
  expect(calls).toHaveLength(1)
  expect(calls[0]?.argv.slice(0, 8)).toEqual([
    "ssh",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "--",
    "user@remote",
  ])
  expect(calls[0]?.argv[8]).toBe("'shuvcode' 'supervisor' 'bridge' '--home' '/srv/owner'\\''s supervisor'")
  expect(JSON.parse(calls[0]!.stdin)).toEqual({ operation: { type: "status" } })
  const failed: SupervisorDelegates.Runner = async () => ({ exitCode: 255, stdout: "", stderr: "route unavailable" })
  expect(await SupervisorDelegates.request(delegate, { type: "status" }, failed)).toEqual({
    state: "unknown",
    error: "route unavailable",
  })
  expect(
    await SupervisorDelegates.request(delegate, { type: "status" }, async () => {
      throw new Error("timeout")
    }),
  ).toEqual({ state: "unknown", error: "timeout" })
})

test("explicit provisioning quotes remote arguments and never runs during registration", async () => {
  const { delegates } = database()
  const delegate = delegates.add({ id: "remote", home: "/srv/supervisor", host: "user@remote", scope: "research" })
  const calls: string[][] = []
  const runner: SupervisorDelegates.Runner = async (argv) => {
    calls.push(argv)
    return { exitCode: 0, stdout: "Supervisor running", stderr: "" }
  }
  expect(calls).toEqual([])
  expect(
    await SupervisorDelegates.provision(delegate, { project: "/srv/a project", model: "openai/gpt-6-sol" }, runner),
  ).toEqual({ state: "ok", result: "Supervisor running" })
  expect(calls[0]?.[8]).toBe(
    "'shuvcode' 'supervisor' 'up' '--home' '/srv/supervisor' '--project' '/srv/a project' '--model' 'openai/gpt-6-sol'",
  )
  expect(() => delegates.add({ id: "unsafe", home: "relative", host: "-bad", scope: "a" })).toThrow()
})
