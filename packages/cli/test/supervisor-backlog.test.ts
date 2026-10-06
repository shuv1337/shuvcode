import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorBacklog } from "../src/supervisor/backlog"

const directories: string[] = []
const databases: DatabaseSync[] = []
function database(file?: string) {
  const dir = file ?? mkdtempSync(join(tmpdir(), "supervisor-backlog-"))
  if (!file) directories.push(dir)
  const db = new DatabaseSync(join(dir, "workflow.sqlite"))
  databases.push(db)
  return { dir, db, backlog: SupervisorBacklog.open(db) }
}

function item(id: string, patch: Partial<SupervisorBacklog.Intake> = {}): SupervisorBacklog.Intake {
  return {
    id,
    projectID: "project",
    kind: "ship",
    brief: `Ship ${id}`,
    deliveryMode: "no-mistakes",
    mergePolicy: "manual",
    ...patch,
  }
}

afterEach(() => {
  databases.splice(0).forEach((db) => db.close())
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

test("intake policy survives project edits, duplicate admission, and reopening", () => {
  const first = database()
  const original = first.backlog.enqueue(item("ship-a", { resources: ["deploy"], priority: 2 }))
  expect(original.deliveryMode).toBe("no-mistakes")
  expect(original.mergePolicy).toBe("manual")
  first.backlog.update("ship-a", { brief: "Updated brief", priority: 3 })
  expect(first.backlog.enqueue(item("ship-a", { resources: ["deploy"], priority: 2 })).brief).toBe("Updated brief")
  expect(() =>
    first.backlog.enqueue(item("ship-a", { deliveryMode: "direct-PR", resources: ["deploy"], priority: 2 })),
  ).toThrow()
  expect(() => first.backlog.update("ship-a", { deliveryMode: "direct-PR" } as SupervisorBacklog.Patch)).toThrow()
  first.db.close()
  databases.pop()
  const reopened = database(first.dir)
  expect(reopened.backlog.get("ship-a")).toMatchObject({
    brief: "Updated brief",
    deliveryMode: "no-mistakes",
    mergePolicy: "manual",
    priority: 3,
  })
})

test("dependencies include missing work, distinguish done from landed, and reject cycles", () => {
  const { backlog } = database()
  backlog.enqueue(item("child", { dependencies: [{ id: "parent", when: "landed" }] }))
  expect(backlog.readiness("child")).toMatchObject({
    eligible: false,
    dependencies: [{ id: "parent", when: "landed", landed: false, met: false }],
  })
  expect(() => backlog.enqueue(item("parent", { dependencies: [{ id: "child", when: "done" }] }))).toThrow(/cycle/)
  backlog.enqueue(item("parent"))
  backlog.markStarted({ id: "parent", taskID: "native-parent" })
  backlog.finish("parent")
  expect(backlog.readiness("child").eligible).toBe(false)
  backlog.markLanded("parent", { mergedCommit: "abc" })
  expect(backlog.readiness("child").eligible).toBe(true)
  expect(() => backlog.markLanded("parent", { mergedCommit: "different" })).toThrow()
})

test("future holds, named resources, ordering, and terminal states control selection", () => {
  const { backlog } = database()
  backlog.enqueue(item("low", { priority: 0 }))
  backlog.enqueue(item("high", { priority: 3, resources: ["deploy"] }))
  backlog.enqueue(item("future", { priority: 9, notBefore: 200 }))
  backlog.enqueue(item("held", { priority: 8, hold: { reason: "review", until: 150 } }))
  backlog.enqueue(item("manual-hold", { priority: 7, hold: { reason: "await owner" } }))
  expect(backlog.eligible({ now: 100 }).map((entry) => entry.id)).toEqual(["high", "low"])
  expect(backlog.isHeld("held", { now: 100 })).toBe(true)
  expect(backlog.isHeld("held", { now: 150 })).toBe(false)
  expect(backlog.eligible({ now: 100, occupiedResources: ["deploy"] }).map((entry) => entry.id)).toEqual(["low"])
  expect(backlog.eligible({ now: 175 }).map((entry) => entry.id)).toEqual(["held", "high", "low"])
  expect(() => backlog.dispatch("manual-hold", () => "never-created")).toThrow(/held/)
  expect(() => backlog.markStarted({ id: "manual-hold", taskID: "never-created" })).toThrow(/held/)
  backlog.cancel("low")
  backlog.markStarted({ id: "high", taskID: "native-high" })
  backlog.finish("high")
  expect(backlog.eligible({ now: 100 }).map((entry) => entry.id)).toEqual([])
  expect(backlog.readiness("high").reasons).toContain("state:done")
  expect(backlog.readiness("low").reasons).toContain("state:cancelled")
  expect(backlog.release("manual-hold").state).toBe("queued")
})

test("dispatch rolls back native task insertion and backlog state on create failure", () => {
  const { db, backlog } = database()
  db.exec("CREATE TABLE native_task (id TEXT PRIMARY KEY)")
  backlog.enqueue(item("one"))
  expect(() =>
    backlog.dispatch("one", () => {
      db.prepare("INSERT INTO native_task (id) VALUES ('native-one')").run()
      throw new Error("create failed")
    }),
  ).toThrow("create failed")
  expect(db.prepare("SELECT id FROM native_task").all()).toEqual([])
  expect(backlog.get("one")).toMatchObject({ state: "queued", attempt: 1 })
  expect(backlog.attempts("one")).toEqual([])
  expect(
    backlog.dispatch("one", () => {
      db.prepare("INSERT INTO native_task (id) VALUES ('native-one')").run()
      return "native-one"
    }),
  ).toMatchObject({ state: "in-flight", taskID: "native-one" })
  expect(backlog.attempts("one")).toHaveLength(1)
})

test("retry retains each execution mapping and does not silently retry landed work", () => {
  const first = database()
  first.backlog.enqueue(item("one"))
  first.backlog.markStarted({ id: "one", taskID: "native-1" })
  first.backlog.finish("one")
  expect(first.backlog.retry("one")).toMatchObject({ state: "queued", attempt: 2, taskID: undefined })
  first.backlog.markStarted({ id: "one", taskID: "native-2", attempt: 2 })
  first.backlog.finish("one")
  first.db.close()
  databases.pop()
  const reopened = database(first.dir)
  expect(reopened.backlog.attempts("one").map((entry) => [entry.attempt, entry.taskID])).toEqual([
    [1, "native-1"],
    [2, "native-2"],
  ])
  reopened.backlog.markLanded("one", { pr: 123 })
  expect(() => reopened.backlog.retry("one")).toThrow(/Landed/)
})

test("in-flight holds block future admission and cancellation settles separately", () => {
  const { backlog } = database()
  backlog.enqueue(item("one"))
  backlog.markStarted({ id: "one", taskID: "native-one" })
  expect(backlog.hold("one", { reason: "await review" })).toMatchObject({
    state: "in-flight",
    hold: { reason: "await review" },
  })
  expect(() => backlog.cancel("one")).toThrow(/not queued/)
  backlog.release("one")
  expect(backlog.settleCancelled("one").state).toBe("cancelled")
  expect(backlog.attempts("one")[0]?.completedAt).toBeNumber()
  expect(backlog.retry("one")).toMatchObject({ state: "queued", attempt: 2 })
})

test("finish and landing evidence commit atomically", () => {
  const { db, backlog } = database()
  backlog.enqueue(item("one"))
  backlog.markStarted({ id: "one", taskID: "native-one" })
  db.exec(`CREATE TRIGGER prevent_landing BEFORE UPDATE OF landed ON supervisor_work_item
    WHEN NEW.landed IS NOT NULL BEGIN SELECT RAISE(ABORT, 'stop landing'); END`)
  expect(() => backlog.finishLanded("one", { commit: "abc" })).toThrow(/stop landing/)
  expect(backlog.get("one")?.state).toBe("in-flight")
  expect(backlog.attempts("one")[0]?.completedAt).toBeUndefined()
  db.exec("DROP TRIGGER prevent_landing")
  expect(backlog.finishLanded("one", { commit: "abc" })).toMatchObject({
    state: "done",
    landed: { commit: "abc" },
  })
  expect(backlog.finishLanded("one", { commit: "abc" })?.landed).toEqual({ commit: "abc" })
  expect(() => backlog.finishLanded("one", { commit: "other" })).toThrow(/Conflicting/)
})

test("delegated ownership survives a missing display hold and blocks ordinary local transitions", () => {
  const first = database()
  const provenance = { source: "captain" as const, reference: "request-7", capturedAt: "2026-10-05T10:00:00Z" }
  first.backlog.enqueue(item("one", { policyProvenance: provenance }))
  expect(first.backlog.delegate("one", "handoff-7")).toMatchObject({
    delegatedHandoffID: "handoff-7",
    policyProvenance: provenance,
  })
  first.db.prepare("UPDATE supervisor_work_item SET hold = NULL WHERE id = 'one'").run()
  expect(first.backlog.readiness("one").reasons).toContain("delegated:handoff-7")
  expect(first.backlog.eligible()).toEqual([])
  expect(() => first.backlog.hold("one", { reason: "different" })).toThrow(/delegated/)
  expect(() => first.backlog.release("one")).toThrow(/delegated/)
  expect(() => first.backlog.cancel("one")).toThrow(/delegated/)
  expect(() => first.backlog.update("one", { brief: "changed" })).toThrow(/delegated/)
  expect(() => first.backlog.dispatch("one", () => "native-one")).toThrow(/delegated/)
  expect(() => first.backlog.markStarted({ id: "one", taskID: "native-one" })).toThrow(/delegated/)
  expect(() =>
    first.backlog.update("one", {
      policyProvenance: { ...provenance, reference: "changed" },
    } as SupervisorBacklog.Patch),
  ).toThrow()
  first.db.close()
  databases.pop()
  const reopened = database(first.dir)
  expect(reopened.backlog.get("one")).toMatchObject({ delegatedHandoffID: "handoff-7", policyProvenance: provenance })
  expect(reopened.backlog.settleDelegatedCancelled({ id: "one", handoffID: "handoff-7" })).toMatchObject({
    state: "cancelled",
  })
  expect(() => reopened.backlog.retry("one")).toThrow(/delegated/)
})

test("legacy work without captured policy uses registry provenance on read", () => {
  const { backlog } = database()
  expect(backlog.enqueue(item("legacy"))?.policyProvenance).toMatchObject({
    source: "registry",
    reference: "project:project",
  })
})

test("attempt and item transitions commit or roll back together", () => {
  const { db, backlog } = database()
  backlog.enqueue(item("one"))
  db.exec(`CREATE TRIGGER prevent_start BEFORE UPDATE OF state ON supervisor_work_item
    WHEN NEW.state = 'in-flight' BEGIN SELECT RAISE(ABORT, 'stop start'); END`)
  expect(() => backlog.markStarted({ id: "one", taskID: "native-one" })).toThrow(/stop start/)
  expect(backlog.attempts("one")).toEqual([])
  db.exec("DROP TRIGGER prevent_start")
  backlog.markStarted({ id: "one", taskID: "native-one" })
  db.exec(`CREATE TRIGGER prevent_finish BEFORE UPDATE OF state ON supervisor_work_item
    WHEN NEW.state = 'done' BEGIN SELECT RAISE(ABORT, 'stop finish'); END`)
  expect(() => backlog.finish("one")).toThrow(/stop finish/)
  expect(backlog.attempts("one")[0]?.completedAt).toBeUndefined()
  expect(backlog.get("one")?.state).toBe("in-flight")
})
