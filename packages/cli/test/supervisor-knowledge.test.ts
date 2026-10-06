import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorChannels } from "../src/supervisor/channels"
import { SupervisorKnowledge } from "../src/supervisor/knowledge"
import { SupervisorStore } from "../src/supervisor/store"

const homes: string[] = []
const stores: ReturnType<typeof SupervisorStore.open>[] = []

function home() {
  const root = mkdtempSync(join(tmpdir(), "supervisor-knowledge-"))
  homes.push(root)
  const store = SupervisorStore.open(root)
  stores.push(store)
  store.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  return { root, store, knowledge: SupervisorKnowledge.open({ store, home: root }) }
}

afterEach(() => {
  stores.splice(0).forEach((store) => store.close())
  homes.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

test("startup distinguishes absent and empty scopes, excludes JIT notes, and blocks overbudget context", async () => {
  const first = home()
  const absent = first.knowledge.startup()
  expect(absent.scopes.map((item) => item.state)).toEqual(["absent", "absent", "absent"])
  expect(absent.text).toContain("PRIVATE HOME PREFERENCES: ABSENT")
  first.store.channels.knowledge.put({
    id: "captain",
    scope: "preferences",
    title: "Style",
    content: "Use concise replies",
  })
  first.store.channels.knowledge.put({
    id: "task-note",
    scope: "task",
    scopeID: "task-1",
    title: "Secret",
    content: "Task-only detail",
  })
  expect(first.knowledge.startup().text).toContain("Use concise replies")
  expect(first.knowledge.startup().text).not.toContain("Task-only detail")
  expect(await first.knowledge.request({ type: "knowledge.startup" }, { sessionID: "worker" })).toMatchObject({
    text: "",
  })
  first.store.channels.knowledge.archive("captain", "Preference superseded")
  expect(first.knowledge.startup().scopes[0]).toMatchObject({ state: "empty", count: 0 })
  first.store.channels.knowledge.put({
    id: "large",
    scope: "preferences",
    title: "Long",
    content: "x".repeat(31_000),
  })
  expect(first.knowledge.startup().state).toBe("blocked")
  expect(() => first.knowledge.guard()).toThrow(/operator-set/)
  const stow = await first.knowledge.request({ type: "knowledge.stow", changes: [] }, { operator: true })
  expect(stow).toMatchObject({ after: { state: "blocked" } })
  await expect(
    first.knowledge.request({ type: "knowledge.budget.set", budgetTokens: 10_000 }, { sessionID: "lead" }),
  ).rejects.toThrow(/operator/)
  expect(
    await first.knowledge.request({ type: "knowledge.budget.set", budgetTokens: 10_000 }, { operator: true }),
  ).toMatchObject({ state: "ready", budgetTokens: 10_000 })
  expect(first.knowledge.guard().state).toBe("ready")
  expect(SupervisorKnowledge.open({ store: first.store, home: first.root }).startup().budgetTokens).toBe(10_000)
})

test("stow reads owned scopes, enforces tier clocks, and archives unique facts with provenance", async () => {
  const first = home()
  const now = Date.now()
  first.store.channels.knowledge.put({
    id: "pinned",
    scope: "preferences",
    title: "Pin",
    content: "Keep",
    now: now - 400 * 86_400_000,
  })
  first.store.channels.knowledge.put({
    id: "aging",
    scope: "fleet",
    title: "Old",
    content: "Legacy",
    now: now - 31 * 86_400_000,
  })
  first.store.channels.knowledge.put({
    id: "perishable",
    scope: "fleet",
    title: "Ticket",
    content: "Check issue 42",
    tier: "perishable",
    expiryCondition: "Issue 42 closes",
    now: now - 8 * 86_400_000,
  })
  expect(() =>
    first.store.channels.knowledge.put({
      id: "invalid",
      scope: "fleet",
      title: "No check",
      content: "Soon",
      tier: "perishable",
    }),
  ).toThrow(/checkable/)
  const stow = first.store.channels.knowledge.stow([], { now })
  expect(stow.inspected).toBe(3)
  expect(stow.archived.map((item) => item.id)).toEqual(["aging", "perishable"])
  expect(first.store.channels.knowledge.get("pinned")?.tier).toBe("pinned")
  expect(first.store.channels.knowledge.archived({ id: "aging" })[0]).toMatchObject({
    source: first.root,
    tier: "aging",
    reason: "aging retention elapsed",
    content: "Legacy",
    reinforcedAt: now - 31 * 86_400_000,
    archivedAt: now,
  })
  expect(first.store.channels.knowledge.archived({ id: "perishable" })[0]?.content).toBe("Check issue 42")
})

test("unchanged evidence does not renew retention, and substantive edits preserve the prior value", () => {
  const first = home()
  const now = Date.now()
  const original = first.store.channels.knowledge.put({
    id: "policy",
    scope: "fleet",
    title: "Policy",
    content: "Old rule",
    evidence: "Issue 1",
    now: now - 20 * 86_400_000,
  })
  const revised = first.store.channels.knowledge.put({
    id: "policy",
    scope: "fleet",
    title: "Policy",
    content: "New rule",
    evidence: "Issue 1",
    now,
  })
  expect(revised.reinforcedAt).toBe(original.reinforcedAt)
  expect(first.store.channels.knowledge.archived({ id: "policy" })).toMatchObject([
    { content: "Old rule", reinforcedAt: original.reinforcedAt, reason: "superseded by knowledge.put" },
  ])
  expect(
    first.store.channels.knowledge.put({
      id: "policy",
      scope: "fleet",
      title: "Policy",
      content: "New rule",
      evidence: "Issue 1",
      now: now + 1,
    }).reinforcedAt,
  ).toBe(original.reinforcedAt)
  expect(first.store.channels.knowledge.archived({ id: "policy" })).toHaveLength(1)
  expect(() =>
    first.store.channels.knowledge.put({
      id: "policy",
      scope: "fleet",
      title: "Policy",
      content: "New rule",
      tier: "pinned",
      evidence: "Issue 1",
      now,
    }),
  ).toThrow(/new evidence/)
})

test("two homes keep private preferences local and delegate shared cache bound to one primary", async () => {
  const primary = home()
  const delegate = home()
  primary.store.channels.knowledge.put({
    id: "private",
    scope: "preferences",
    title: "Private",
    content: "Do not copy",
  })
  primary.store.channels.knowledge.put({ id: "shared", scope: "shared", title: "Public style", content: "Use bullets" })
  const snapshot = primary.knowledge.snapshot()
  expect(snapshot.records.map((item) => item.id)).toEqual(["shared"])
  expect(
    await delegate.knowledge.request({ type: "knowledge.shared.sync", ...snapshot }, { operator: true }),
  ).toMatchObject({
    cache: { sourceHome: primary.root, sourceID: snapshot.sourceID, version: snapshot.version },
  })
  expect(delegate.knowledge.startup().text).toContain("Use bullets")
  expect(delegate.knowledge.startup().text).not.toContain("Do not copy")
  expect(delegate.store.channels.knowledge.get("shared")).toMatchObject({
    sourceHome: primary.root,
    sourceVersion: snapshot.version,
  })
  expect(() =>
    delegate.store.channels.knowledge.put({
      id: "shared",
      scope: "shared",
      title: "Tamper",
      content: "No",
    }),
  ).toThrow(/read-only/)
  expect(() =>
    delegate.store.channels.knowledge.put({
      id: "new-shared",
      scope: "shared",
      title: "Tamper",
      content: "No",
    }),
  ).toThrow(/read-only/)
  await expect(
    delegate.knowledge.request(
      {
        type: "knowledge.shared.sync",
        sourceHome: "/different-primary",
        sourceID: crypto.randomUUID(),
        version: snapshot.version,
        records: [...snapshot.records],
      },
      { operator: true },
    ),
  ).rejects.toThrow(/different primary/)
  expect(delegate.knowledge.startup({ now: Date.now() + 25 * 60 * 60 * 1000 }).sharedCache.stale).toBe(true)
  await expect(
    delegate.knowledge.request(
      {
        type: "knowledge.shared.sync",
        sourceHome: primary.root,
        sourceID: crypto.randomUUID(),
        version: snapshot.version + 1,
        records: [...snapshot.records],
      },
      { operator: true },
    ),
  ).rejects.toThrow(/different primary/)
})

test("cascade syncs shared knowledge before delegate-owned stow and leaves unknown homes unresolved", async () => {
  const primary = home()
  const delegate = home()
  primary.store.channels.knowledge.put({ id: "shared", scope: "shared", title: "Shared", content: "Primary-owned" })
  delegate.store.channels.knowledge.put({
    id: "stale",
    scope: "fleet",
    title: "Old local note",
    content: "Delegate owns this",
    now: Date.now() - 31 * 86_400_000,
  })
  primary.store.delegates.add({ id: "known", home: delegate.root, scope: "docs" })
  primary.store.delegates.add({ id: "unknown", home: "/missing/home", scope: "docs" })
  const seen: string[] = []
  const knowledge = SupervisorKnowledge.open({
    store: primary.store,
    home: primary.root,
    async requestDelegate(route, operation) {
      if (route.id === "unknown") return { state: "unknown", error: "Home unreachable" }
      seen.push(operation.type)
      return { state: "ok", result: await delegate.knowledge.request(operation, { operator: true }) }
    },
  })
  const result = await knowledge.cascade()
  expect(seen).toEqual(["knowledge.shared.sync", "knowledge.stow"])
  expect(result.unresolved).toMatchObject([{ id: "unknown", state: "unknown", phase: "shared-sync" }])
  expect(result.results[0]).toMatchObject({
    id: "known",
    state: "ok",
    local: { before: { state: "ready" }, after: { state: "ready" } },
  })
  expect(delegate.store.channels.knowledge.get("stale")).toBeUndefined()
  expect(delegate.store.channels.knowledge.archived({ id: "stale" })[0]?.source).toBe(delegate.root)
  expect(delegate.store.channels.knowledge.get("shared")?.sourceHome).toBe(primary.root)
})

test("cascade reports a delegate budget block after shared sync", async () => {
  const primary = home()
  const delegate = home()
  primary.store.channels.knowledge.setBudget(10_000)
  primary.store.channels.knowledge.put({
    id: "large-shared",
    scope: "shared",
    title: "Shared",
    content: "x".repeat(31_000),
  })
  primary.store.delegates.add({ id: "known", home: delegate.root, scope: "docs" })
  const seen: string[] = []
  const knowledge = SupervisorKnowledge.open({
    store: primary.store,
    home: primary.root,
    async requestDelegate(_route, operation) {
      seen.push(operation.type)
      return { state: "ok", result: await delegate.knowledge.request(operation, { operator: true }) }
    },
  })
  const result = await knowledge.cascade()
  expect(seen).toEqual(["knowledge.shared.sync"])
  expect(result.unresolved).toMatchObject([{ state: "error", phase: "shared-sync" }])
  expect(delegate.store.channels.knowledge.get("large-shared")?.sourceHome).toBe(primary.root)
  expect(() => delegate.knowledge.guard()).toThrow(/operator-set/)
})

test("legacy knowledge table migrates in place and accepts shared scope", () => {
  const root = mkdtempSync(join(tmpdir(), "supervisor-knowledge-legacy-"))
  homes.push(root)
  const db = new DatabaseSync(join(root, "legacy.sqlite"))
  db.exec(`CREATE TABLE supervisor_channel_knowledge (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK (scope IN ('preferences','fleet','project','task')),
    scope_id TEXT, title TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ); INSERT INTO supervisor_channel_knowledge VALUES ('old','preferences',NULL,'Old','Keep this',100,200);`)
  const channels = SupervisorChannels.open(db, root)
  expect(channels.knowledge.get("old")).toMatchObject({ tier: "pinned", reinforcedAt: 200, content: "Keep this" })
  expect(channels.knowledge.put({ id: "shared", scope: "shared", title: "New", content: "Works" }).scope).toBe("shared")
  db.close()
})
