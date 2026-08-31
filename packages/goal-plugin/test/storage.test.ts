import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULT_LIMITS, createGoal } from "../src/state"
import {
  acquireOwner,
  appendLedger,
  loadRecord,
  persistRecord,
  releaseOwner,
  removeState,
  shardFor,
  takeoverOwner,
} from "../src/storage"

const NOW = 1_000_000

async function freshShard() {
  const root = await mkdtemp(path.join(tmpdir(), "goal-storage-"))
  const shard = shardFor(root, "ses_test")
  await mkdir(shard.directory, { recursive: true, mode: 0o700 })
  return shard
}

function record() {
  return createGoal({
    sessionID: "ses_test",
    location: "/tmp/project",
    definition: { objective: "fix tests", successCriteria: ["tests pass"], constraints: [], references: [] },
    limits: DEFAULT_LIMITS,
    now: NOW,
  })
}

const owner = (instance: string, pid = process.pid) => ({ pid, instance, created: NOW })

describe("state persistence", () => {
  test("shard paths derive from the hashed session ID", () => {
    const shard = shardFor("/tmp/root", "ses_test")
    expect(shard.directory).not.toContain("ses_test")
    expect(shard.state.endsWith("state.json")).toBe(true)
  })

  test("round-trips a record atomically without leftover temp files", async () => {
    const shard = await freshShard()
    const value = record()
    await persistRecord(shard, value)
    const loaded = await loadRecord(shard)
    expect(loaded.status).toBe("ok")
    expect(loaded.status === "ok" && loaded.record.goalID).toBe(value.goalID)
    const files = await readdir(shard.directory)
    expect(files.filter((file) => file.endsWith(".tmp"))).toEqual([])
  })

  test("missing state loads as missing", async () => {
    const shard = await freshShard()
    expect((await loadRecord(shard)).status).toBe("missing")
  })

  test("corrupt state fails closed and leaves the file untouched", async () => {
    const shard = await freshShard()
    await persistRecord(shard, record())
    await writeFile(shard.state, "{ not json")
    expect((await loadRecord(shard)).status).toBe("corrupt")
    expect(await readFile(shard.state, "utf8")).toBe("{ not json")
  })

  test("unknown versions fail closed and leave the file untouched", async () => {
    const shard = await freshShard()
    const future = { ...record(), version: 2 }
    await persistRecord(shard, future as never)
    expect((await loadRecord(shard)).status).toBe("version")
    expect(JSON.parse(await readFile(shard.state, "utf8")).version).toBe(2)
  })

  test("refuses a symlinked state file", async () => {
    const shard = await freshShard()
    await persistRecord(shard, record())
    const target = path.join(shard.directory, "elsewhere.json")
    await writeFile(target, "{}")
    await removeState(shard)
    await symlink(target, shard.state)
    await expect(persistRecord(shard, record())).rejects.toThrow("symlink")
  })

  test("terminal transitions append their ledger intent", async () => {
    const shard = await freshShard()
    const value = record()
    await persistRecord(shard, value, {
      at: NOW,
      goalID: value.goalID,
      from: "active",
      to: "completed",
      code: "completed",
    })
    const lines = (await readFile(shard.ledger, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).to).toBe("completed")
  })

  test("ledger appends accumulate", async () => {
    const shard = await freshShard()
    const value = record()
    const entry = { at: NOW, goalID: value.goalID, from: "none", to: "active", code: "created" }
    await appendLedger(shard, entry)
    await appendLedger(shard, { ...entry, code: "again" })
    const lines = (await readFile(shard.ledger, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(2)
  })

  test("removeState keeps the ledger", async () => {
    const shard = await freshShard()
    const value = record()
    await persistRecord(shard, value, { at: NOW, goalID: value.goalID, from: "none", to: "active", code: "created" })
    await removeState(shard)
    expect((await loadRecord(shard)).status).toBe("missing")
    expect((await readFile(shard.ledger, "utf8")).length).toBeGreaterThan(0)
  })
})

describe("ownership", () => {
  test("first acquisition owns the shard and is idempotent per instance", async () => {
    const shard = await freshShard()
    expect(await acquireOwner(shard, owner("a"))).toBe("owned")
    expect(await acquireOwner(shard, owner("a"))).toBe("owned")
  })

  test("a live foreign owner contends", async () => {
    const shard = await freshShard()
    // pid 1 exists on any Linux host and is not ours: EPERM means alive.
    await writeFile(shard.owner, JSON.stringify(owner("other", 1)))
    expect(await acquireOwner(shard, owner("mine"))).toBe("contended")
  })

  test("a dead owner is adopted on liveness evidence", async () => {
    const shard = await freshShard()
    await writeFile(shard.owner, JSON.stringify(owner("dead", 999_999_999)))
    expect(await acquireOwner(shard, owner("mine"))).toBe("owned")
  })

  test("a same-pid previous generation is adopted", async () => {
    const shard = await freshShard()
    await acquireOwner(shard, owner("generation-1"))
    expect(await acquireOwner(shard, owner("generation-2"))).toBe("owned")
  })

  test("a corrupt owner file contends", async () => {
    const shard = await freshShard()
    await writeFile(shard.owner, "not json")
    expect(await acquireOwner(shard, owner("mine"))).toBe("contended")
  })

  test("takeover force-replaces a live owner", async () => {
    const shard = await freshShard()
    await writeFile(shard.owner, JSON.stringify(owner("other", 1)))
    await takeoverOwner(shard, owner("mine"))
    expect(await acquireOwner(shard, owner("mine"))).toBe("owned")
  })

  test("release removes only our own registration", async () => {
    const shard = await freshShard()
    await writeFile(shard.owner, JSON.stringify(owner("other", 1)))
    await releaseOwner(shard, owner("mine"))
    expect(await acquireOwner(shard, owner("mine"))).toBe("contended")
    await releaseOwner(shard, owner("other", 1))
    expect(await acquireOwner(shard, owner("mine"))).toBe("owned")
  })
})
