import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SupervisorDelegatesRuntime } from "../src/supervisor/delegates-runtime"
import { SupervisorStore } from "../src/supervisor/store"
import { SupervisorWorktree } from "../src/supervisor/worktree"

const homes: string[] = []
const stores: ReturnType<typeof SupervisorStore.open>[] = []

function home() {
  const root = mkdtempSync(join(tmpdir(), "supervisor-delegates-runtime-"))
  homes.push(root)
  const store = SupervisorStore.open(root)
  stores.push(store)
  store.activateLead({ sessionID: `lead-${homes.length}`, expectedGeneration: 0 })
  return { root, store }
}

function authorize(store: ReturnType<typeof SupervisorStore.open>) {
  return (actor: { operator: true } | { sessionID: string }, generation?: number) => {
    const lead = store.lead()
    if (
      !lead?.active ||
      ("sessionID" in actor && actor.sessionID !== lead.sessionID) ||
      (generation !== undefined && generation !== lead.generation)
    )
      throw new Error("Lead authority mismatch")
  }
}

function work(id: string, dependencies: { id: string; when: "done" | "landed" }[] = []) {
  return {
    id,
    projectID: "source",
    kind: "ship" as const,
    brief: `Ship ${id}`,
    deliveryMode: "direct-PR" as const,
    mergePolicy: "manual" as const,
    dependencies,
  }
}

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

function pair(options?: {
  request?: SupervisorDelegatesRuntime.Request
  cancelWork?: (store: ReturnType<typeof SupervisorStore.open>, id: string) => void | Promise<void>
}) {
  const source = home()
  const destination = home()
  destination.store.projects.add({
    id: "dest",
    path: join(destination.root, "repo"),
    description: "",
    baseRef: "main",
    mode: "local-only",
    yolo: false,
  })
  const remote = SupervisorDelegatesRuntime.open({
    store: destination.store,
    home: destination.root,
    authorize: authorize(destination.store),
    cancelWork: options?.cancelWork ? (id) => options.cancelWork!(destination.store, id) : undefined,
  })
  const calls: string[] = []
  const route: SupervisorDelegatesRuntime.Request =
    options?.request ??
    (async (_delegate, operation) => {
      calls.push(operation.type)
      try {
        return {
          state: "ok",
          result:
            operation.type === "status"
              ? { lead: destination.store.lead() }
              : await remote.handle(operation, { operator: true }),
        }
      } catch (error) {
        return { state: "error", error: error instanceof Error ? error.message : String(error) }
      }
    })
  const local = SupervisorDelegatesRuntime.open({
    store: source.store,
    home: source.root,
    authorize: authorize(source.store),
    request: route,
  })
  source.store.delegates.add({
    id: "secondmate",
    home: destination.root,
    scope: "docs",
    sourceProjectID: "source",
    projectID: "dest",
  })
  return { source, destination, local, remote, calls }
}

async function completeScout(destination: ReturnType<typeof home>, destinationID: string) {
  const project = join(destination.root, "repo")
  mkdirSync(project)
  git(project, "init", "-b", "main")
  git(project, "config", "user.name", "Fixture")
  git(project, "config", "user.email", "fixture@example.test")
  writeFileSync(join(project, "README.md"), "# Fixture\n")
  git(project, "add", "README.md")
  git(project, "commit", "-m", "chore: fixture")
  const planned = await SupervisorWorktree.propose({
    home: destination.root,
    taskID: "native-scout",
    project,
    baseRef: "main",
    kind: "scout",
  })
  await SupervisorWorktree.create(planned)
  const report = "# Scout report\nVerified destination findings.\n"
  writeFileSync(join(planned.worktree, "REPORT.md"), report)
  const verified = await SupervisorWorktree.verify({
    task: planned,
    receipt: {
      kind: "scout",
      artifact: { relativePath: "REPORT.md", sha256: createHash("sha256").update(report).digest("hex") },
    },
  })
  const lead = destination.store.lead()!
  destination.store.createTask({
    authority: lead,
    task: {
      ...planned,
      sessionID: "native-scout-session",
      brief: "Scout destination",
      model: { providerID: "test", modelID: "test-model" },
      agent: "build",
      permissions: [],
    },
    messageID: "initial-scout",
  })
  destination.store.backlog.markStarted({ id: destinationID, taskID: planned.id })
  destination.store.ackOutbox({ authority: lead, taskID: planned.id, messageID: "initial-scout" })
  const receipt = destination.store.proposeReceipt({
    taskID: planned.id,
    operationID: "initial-scout",
    receipt: { kind: "scout", evidence: verified },
  })
  destination.store.observe({
    taskID: planned.id,
    sessionID: "native-scout-session",
    cursor: 1,
    delivered: ["initial-scout"],
    outcome: "succeeded",
    receipt,
  })
  destination.store.completeTask({ authority: lead, taskID: planned.id })
  destination.store.backlog.finish(destinationID)
  return { project, planned, report, verified }
}

afterEach(() => {
  stores.splice(0).forEach((store) => store.close())
  homes.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

test("handoff closes dependencies, deduplicates receipt, and settles only after destination completion", async () => {
  const { source, destination, local, calls } = pair()
  source.store.backlog.enqueue(work("parent"))
  source.store.backlog.enqueue(work("child", [{ id: "parent", when: "done" }]))
  const operation = {
    type: "handoff.create" as const,
    generation: 1,
    id: "handoff-1",
    delegateID: "secondmate",
    workIDs: ["child"],
  }
  expect(await local.handle(operation, { operator: true })).toMatchObject({
    state: "received",
    sourceWorkIDs: ["parent", "child"],
  })
  expect(source.store.backlog.get("parent")).toMatchObject({
    state: "queued",
    hold: { reason: "Delegate handoff handoff-1" },
  })
  expect(source.store.backlog.get("child")?.state).toBe("queued")
  const received = destination.store.backlog.list()
  expect(received).toHaveLength(2)
  const parent = received.find((item) => item.dependencies.length === 0)!
  const child = received.find((item) => item.dependencies.length === 1)!
  expect(child.dependencies).toEqual([{ id: parent.id, when: "done" }])
  expect(await local.handle(operation, { operator: true })).toMatchObject({ state: "received" })
  expect(destination.store.backlog.list()).toHaveLength(2)
  expect(calls.filter((type) => type === "delegate.receive")).toHaveLength(1)

  destination.store.backlog.markStarted({ id: parent.id, taskID: "native-parent" })
  destination.store.backlog.finish(parent.id)
  destination.store.backlog.markStarted({ id: child.id, taskID: "native-child" })
  destination.store.backlog.finish(child.id)
  destination.store.backlog.markLanded(child.id, { commit: "abc" })
  expect(source.store.backlog.get("parent")?.state).toBe("queued")
  expect((await local.reconcile({ minAgeMs: 0 }))[0]).toMatchObject({ state: "completed" })
  expect(source.store.backlog.get("parent")).toMatchObject({ state: "done", landed: undefined })
  expect(source.store.backlog.get("child")?.landed).toMatchObject({
    handoffID: "handoff-1",
    destinationWorkID: child.id,
    destinationLanded: { commit: "abc" },
  })
  expect(source.store.delegates.handoff("handoff-1")?.result).toMatchObject({
    work: [
      { sourceID: "parent", state: "done" },
      { sourceID: "child", state: "done", landed: { commit: "abc" } },
    ],
  })
})

test("unknown receipt preserves holds, explicit retry reaches the same destination work", async () => {
  const source = home()
  const destination = home()
  destination.store.projects.add({
    id: "dest",
    path: join(destination.root, "repo"),
    description: "",
    baseRef: "main",
    mode: "local-only",
    yolo: false,
  })
  const remote = SupervisorDelegatesRuntime.open({
    store: destination.store,
    home: destination.root,
    authorize: authorize(destination.store),
  })
  let first = true
  const local = SupervisorDelegatesRuntime.open({
    store: source.store,
    home: source.root,
    authorize: authorize(source.store),
    request: async (_delegate, operation) => {
      const result =
        operation.type === "status"
          ? { lead: destination.store.lead() }
          : await remote.handle(operation, { operator: true })
      if (first && operation.type === "delegate.receive") {
        first = false
        return { state: "unknown", error: "reply lost" }
      }
      return { state: "ok", result }
    },
  })
  source.store.delegates.add({
    id: "secondmate",
    home: destination.root,
    scope: "docs",
    sourceProjectID: "source",
    projectID: "dest",
  })
  source.store.backlog.enqueue(work("one"))
  expect(
    await local.handle(
      { type: "handoff.create", generation: 1, id: "handoff-2", delegateID: "secondmate", workIDs: ["one"] },
      { operator: true },
    ),
  ).toMatchObject({ state: "unknown" })
  expect(source.store.backlog.get("one")?.hold?.reason).toBe("Delegate handoff handoff-2")
  expect(destination.store.backlog.list()).toHaveLength(1)
  expect(
    await local.handle({ type: "handoff.retry", generation: 1, id: "handoff-2" }, { operator: true }),
  ).toMatchObject({ state: "received" })
  expect(destination.store.backlog.list()).toHaveLength(1)
  destination.store.backlog.cancel(destination.store.backlog.list()[0]!.id)
  expect((await local.reconcile({ minAgeMs: 0 }))[0]).toMatchObject({ state: "failed" })
  expect(source.store.backlog.get("one")).toMatchObject({
    state: "queued",
    hold: { reason: "Delegate handoff handoff-2" },
  })
})

test("a landed source predecessor is preserved as evidence without being copied", async () => {
  const { source, destination, local } = pair()
  source.store.backlog.enqueue(work("landed-parent"))
  source.store.backlog.markStarted({ id: "landed-parent", taskID: "native-source-parent" })
  source.store.backlog.finish("landed-parent")
  source.store.backlog.markLanded("landed-parent", { commit: "source-abc" })
  source.store.backlog.enqueue(work("child", [{ id: "landed-parent", when: "landed" }]))
  const handoff = await local.handle(
    { type: "handoff.create", generation: 1, id: "handoff-proof", delegateID: "secondmate", workIDs: ["child"] },
    { operator: true },
  )
  expect(handoff).toMatchObject({
    state: "received",
    sourceWorkIDs: ["child"],
    payload: {
      predecessors: [{ id: "landed-parent", when: "landed", state: "done", landed: { commit: "source-abc" } }],
    },
  })
  expect(destination.store.backlog.list()).toHaveLength(1)
  expect(destination.store.backlog.list()[0]?.dependencies).toEqual([])
})

test("handoff requires an explicit one-project route and keeps local-only work in the main home", async () => {
  const { source, destination, local } = pair()
  source.store.backlog.enqueue({ ...work("local"), deliveryMode: "local-only" })
  await expect(
    local.handle(
      { type: "handoff.create", generation: 1, id: "local-handoff", delegateID: "secondmate", workIDs: ["local"] },
      { operator: true },
    ),
  ).rejects.toThrow(/Local-only/)
  expect(source.store.backlog.get("local")?.delegatedHandoffID).toBeUndefined()
  source.store.backlog.enqueue({ ...work("other-parent"), projectID: "other" })
  source.store.backlog.enqueue(work("mixed-child", [{ id: "other-parent", when: "done" }]))
  await expect(
    local.handle(
      {
        type: "handoff.create",
        generation: 1,
        id: "mixed-handoff",
        delegateID: "secondmate",
        workIDs: ["mixed-child"],
      },
      { operator: true },
    ),
  ).rejects.toThrow(/crosses projects/)
  source.store.backlog.markStarted({ id: "other-parent", taskID: "native-other" })
  source.store.backlog.finish("other-parent")
  await expect(
    local.handle(
      {
        type: "handoff.create",
        generation: 1,
        id: "mixed-completed",
        delegateID: "secondmate",
        workIDs: ["mixed-child"],
      },
      { operator: true },
    ),
  ).rejects.toThrow(/crosses projects through dependency/)
  expect(destination.store.backlog.list()).toEqual([])
  source.store.delegates.add({ id: "unrouted", home: destination.root, scope: "research", projectID: "dest" })
  source.store.backlog.enqueue(work("unrouted-work"))
  await expect(
    local.handle(
      {
        type: "handoff.create",
        generation: 1,
        id: "unrouted-handoff",
        delegateID: "unrouted",
        workIDs: ["unrouted-work"],
      },
      { operator: true },
    ),
  ).rejects.toThrow(/explicit source project/)
})

test("handoff preserves immutable policy provenance at the destination", async () => {
  const { source, destination, local } = pair()
  const provenance = { source: "captain" as const, reference: "approval-18", capturedAt: "2026-10-05T10:00:00Z" }
  source.store.backlog.enqueue({ ...work("one"), policyProvenance: provenance })
  await local.handle(
    { type: "handoff.create", generation: 1, id: "policy-handoff", delegateID: "secondmate", workIDs: ["one"] },
    { operator: true },
  )
  expect(destination.store.backlog.list()[0]?.policyProvenance).toEqual(provenance)
})

test("queued remote cancellation settles source only with exact terminal proof", async () => {
  const { source, destination, local } = pair()
  source.store.backlog.enqueue(work("parent"))
  source.store.backlog.enqueue(work("child", [{ id: "parent", when: "done" }]))
  await local.handle(
    { type: "handoff.create", generation: 1, id: "cancel-queued", delegateID: "secondmate", workIDs: ["child"] },
    { operator: true },
  )
  const cancelled = await local.handle(
    { type: "handoff.cancel", generation: 1, id: "cancel-queued" },
    { operator: true },
  )
  expect(cancelled).toMatchObject({
    state: "failed",
    cancelRequested: true,
    result: {
      work: [
        { sourceID: "parent", state: "cancelled" },
        { sourceID: "child", state: "cancelled" },
      ],
    },
  })
  expect(destination.store.backlog.list().map((item) => item.state)).toEqual(["cancelled", "cancelled"])
  expect(source.store.backlog.get("parent")?.state).toBe("cancelled")
  expect(source.store.backlog.get("child")?.state).toBe("cancelled")
  expect(() => source.store.backlog.retry("child")).toThrow(/delegated/)
  await expect(
    local.handle({ type: "handoff.retry", generation: 1, id: "cancel-queued" }, { operator: true }),
  ).rejects.toThrow(/cancellation/)
  expect(
    await local.handle({ type: "handoff.cancel", generation: 1, id: "cancel-queued" }, { operator: true }),
  ).toEqual(cancelled)
})

test("in-flight cancellation waits for native settlement and never releases on an error", async () => {
  const { source, destination, local } = pair()
  source.store.backlog.enqueue(work("one"))
  await local.handle(
    { type: "handoff.create", generation: 1, id: "cancel-running", delegateID: "secondmate", workIDs: ["one"] },
    { operator: true },
  )
  const targetID = destination.store.backlog.list()[0]!.id
  destination.store.backlog.markStarted({ id: targetID, taskID: "native-running" })
  expect(
    await local.handle({ type: "handoff.cancel", generation: 1, id: "cancel-running" }, { operator: true }),
  ).toMatchObject({ state: "unknown", cancelRequested: true })
  expect(source.store.backlog.get("one")).toMatchObject({ state: "queued", delegatedHandoffID: "cancel-running" })
  expect(destination.store.backlog.get(targetID)?.state).toBe("in-flight")
  destination.store.backlog.settleCancelled(targetID)
  expect((await local.reconcile({ minAgeMs: 0 }))[0]).toMatchObject({
    state: "failed",
    result: { work: [{ sourceID: "one", state: "cancelled" }] },
  })
  expect(source.store.backlog.get("one")?.state).toBe("cancelled")
})

test("in-flight cancellation uses the typed destination controller before source settlement", async () => {
  const calls: string[] = []
  const { source, destination, local } = pair({
    cancelWork(store, id) {
      calls.push(id)
      store.backlog.settleCancelled(id)
    },
  })
  source.store.backlog.enqueue(work("one"))
  await local.handle(
    { type: "handoff.create", generation: 1, id: "cancel-native", delegateID: "secondmate", workIDs: ["one"] },
    { operator: true },
  )
  const targetID = destination.store.backlog.list()[0]!.id
  destination.store.backlog.markStarted({ id: targetID, taskID: "native-one" })
  expect(
    await local.handle({ type: "handoff.cancel", generation: 1, id: "cancel-native" }, { operator: true }),
  ).toMatchObject({
    cancelRequested: true,
    state: "failed",
    result: { work: [{ destinationID: targetID, state: "cancelled" }] },
  })
  expect(calls).toEqual([targetID])
  expect(source.store.backlog.get("one")?.state).toBe("cancelled")
})

test("cancellation keeps ownership when destination admission is uncertain and settles completed work", async () => {
  const source = home()
  const destination = home()
  const local = SupervisorDelegatesRuntime.open({
    store: source.store,
    home: source.root,
    authorize: authorize(source.store),
    request: async (_delegate, operation) =>
      operation.type === "delegate.receive"
        ? { state: "unknown", error: "reply lost" }
        : { state: "ok", result: { found: false } },
  })
  source.store.delegates.add({
    id: "secondmate",
    home: destination.root,
    scope: "docs",
    sourceProjectID: "source",
    projectID: "dest",
  })
  source.store.backlog.enqueue(work("unknown"))
  expect(
    await local.handle(
      { type: "handoff.create", generation: 1, id: "cancel-unknown", delegateID: "secondmate", workIDs: ["unknown"] },
      { operator: true },
    ),
  ).toMatchObject({ state: "unknown" })
  expect(
    await local.handle({ type: "handoff.cancel", generation: 1, id: "cancel-unknown" }, { operator: true }),
  ).toMatchObject({ state: "unknown", cancelRequested: true })
  expect(source.store.backlog.get("unknown")).toMatchObject({ state: "queued", delegatedHandoffID: "cancel-unknown" })

  const complete = pair()
  complete.source.store.backlog.enqueue(work("done"))
  await complete.local.handle(
    { type: "handoff.create", generation: 1, id: "cancel-done", delegateID: "secondmate", workIDs: ["done"] },
    { operator: true },
  )
  const targetID = complete.destination.store.backlog.list()[0]!.id
  complete.destination.store.backlog.markStarted({ id: targetID, taskID: "native-done" })
  complete.destination.store.backlog.finish(targetID)
  expect(
    await complete.local.handle({ type: "handoff.cancel", generation: 1, id: "cancel-done" }, { operator: true }),
  ).toMatchObject({ state: "completed", cancelRequested: true, result: { work: [{ state: "done" }] } })
  expect(complete.source.store.backlog.get("done")).toMatchObject({
    state: "done",
    delegatedHandoffID: "cancel-done",
  })
})

test("cancellation settles a mixed destination graph with exact completion and cancellation evidence", async () => {
  const { source, destination, local } = pair({
    cancelWork(store, id) {
      store.backlog.settleCancelled(id)
    },
  })
  source.store.backlog.enqueue({ ...work("scout"), kind: "scout" })
  source.store.backlog.enqueue(work("ship", [{ id: "scout", when: "done" }]))
  await local.handle(
    { type: "handoff.create", generation: 1, id: "mixed-cancel", delegateID: "secondmate", workIDs: ["ship"] },
    { operator: true },
  )
  const target = destination.store.backlog.list()
  const scout = target.find((item) => item.dependencies.length === 0)!
  const ship = target.find((item) => item.dependencies.length === 1)!
  const accepted = await completeScout(destination, scout.id)
  destination.store.backlog.markStarted({ id: ship.id, taskID: "native-ship" })
  const result = await local.handle({ type: "handoff.cancel", generation: 1, id: "mixed-cancel" }, { operator: true })
  expect(result).toMatchObject({
    state: "failed",
    cancelRequested: true,
    result: {
      work: [
        {
          sourceID: "scout",
          destinationID: scout.id,
          state: "done",
          report: { evidence: { artifact: { contentBase64: accepted.verified.artifact.contentBase64 } } },
        },
        { sourceID: "ship", destinationID: ship.id, state: "cancelled" },
      ],
    },
  })
  expect(source.store.backlog.get("scout")).toMatchObject({ state: "done", delegatedHandoffID: "mixed-cancel" })
  expect(source.store.backlog.get("ship")?.state).toBe("cancelled")
  expect(await local.handle({ type: "handoff.cancel", generation: 1, id: "mixed-cancel" }, { operator: true })).toEqual(
    result,
  )
})

test("delegated scout returns accepted report bytes after destination worktree removal and source reopen", async () => {
  const { source, destination, local } = pair()
  source.store.backlog.enqueue({ ...work("scout"), kind: "scout" })
  await local.handle(
    { type: "handoff.create", generation: 1, id: "scout-return", delegateID: "secondmate", workIDs: ["scout"] },
    { operator: true },
  )
  const destinationID = destination.store.backlog.list()[0]!.id
  const { project, planned, report, verified } = await completeScout(destination, destinationID)
  git(project, "worktree", "remove", "--force", planned.worktree)
  expect(await Bun.file(join(planned.worktree, "REPORT.md")).exists()).toBe(false)

  const settled = (await local.reconcile({ minAgeMs: 0 }))[0]
  expect(settled).toMatchObject({
    state: "completed",
    result: {
      work: [
        {
          sourceID: "scout",
          destinationID,
          state: "done",
          report: {
            operationID: "initial-scout",
            evidence: { artifact: { relativePath: "REPORT.md", sha256: verified.artifact.sha256 } },
          },
        },
      ],
    },
  })
  const reportFromSource = (
    settled?.result as { work: { report: { evidence: { artifact: { contentBase64: string } } } }[] }
  ).work[0]!.report
  expect(Buffer.from(reportFromSource.evidence.artifact.contentBase64, "base64").toString()).toBe(report)
  expect(source.store.backlog.get("scout")).toMatchObject({ state: "done", delegatedHandoffID: "scout-return" })
  expect(await local.handle({ type: "handoff.status", id: "scout-return" }, { operator: true })).toEqual(settled)

  source.store.close()
  stores.splice(stores.indexOf(source.store), 1)
  const reopened = SupervisorStore.open(source.root)
  stores.push(reopened)
  expect(reopened.delegates.handoff("scout-return")?.result).toEqual(settled?.result)
  expect(reopened.backlog.get("scout")?.state).toBe("done")
})

test("configuration is operator-only; follow-up reuses the target lead and message ID", async () => {
  const { source, destination, local } = pair()
  expect(await local.handle({ type: "delegate.list" }, { sessionID: "lead-1" })).toHaveLength(1)
  await expect(
    local.handle({ type: "delegate.archive", generation: 1, id: "secondmate" }, { sessionID: "lead-1" }),
  ).rejects.toThrow(/operator/)
  expect(
    await local.handle(
      { type: "delegate.update", generation: 1, id: "secondmate", scope: "docs and tests" },
      { operator: true },
    ),
  ).toMatchObject({ scope: "docs and tests", projectID: "dest", enabled: true })
  const leadBefore = destination.store.lead()
  const send = {
    type: "delegate.send" as const,
    generation: 1,
    id: "secondmate",
    operationID: "followup-1",
    text: "Check the tests",
    delivery: "queue" as const,
  }
  expect(await local.handle(send, { sessionID: "lead-1" })).toMatchObject({ state: "ok" })
  expect(await local.handle(send, { sessionID: "lead-1" })).toMatchObject({ state: "ok" })
  expect(destination.store.lead()).toEqual(leadBefore)
  expect(destination.store.pendingNotices()).toHaveLength(1)
  expect(await local.handle({ ...send, text: "Different follow-up" }, { sessionID: "lead-1" })).toMatchObject({
    state: "error",
    error: expect.stringContaining("Conflicting"),
  })
  expect(source.store.delegates.list()).toHaveLength(1)
})
