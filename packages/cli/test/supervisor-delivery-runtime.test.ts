import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorDeliveryRuntime } from "../src/supervisor/delivery-runtime"
import { SupervisorDelivery } from "../src/supervisor/delivery"
import { SupervisorStore } from "../src/supervisor/store"
import { SupervisorWorktree } from "../src/supervisor/worktree"

const homes: string[] = []
const stores: ReturnType<typeof SupervisorStore.open>[] = []

afterEach(() => {
  stores.splice(0).forEach((store) => store.close())
  homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true }))
})

function git(cwd: string, ...args: string[]) {
  const output = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  if (output.exitCode !== 0) throw new Error(new TextDecoder().decode(output.stderr))
  return new TextDecoder().decode(output.stdout).trim()
}

async function fixture(mode: SupervisorDelivery.Mode = "local-only", runGh?: SupervisorDelivery.GhRunner) {
  const home = mkdtempSync(path.join(tmpdir(), "supervisor-delivery-runtime-"))
  homes.push(home)
  const project = path.join(home, "repo")
  mkdirSync(project)
  git(project, "init", "-q", "-b", "main")
  git(project, "config", "user.name", "Test")
  git(project, "config", "user.email", "test@example.test")
  writeFileSync(path.join(project, "base"), "base")
  git(project, "add", "base")
  git(project, "commit", "-qm", "base")
  if (mode !== "local-only") git(project, "remote", "add", "origin", "git@github.com:owner/repo.git")
  const candidate = await SupervisorWorktree.propose({ home, taskID: "task1", project, baseRef: "main" })
  await SupervisorWorktree.create(candidate)
  writeFileSync(path.join(candidate.worktree, "change"), "change")
  git(candidate.worktree, "add", "change")
  git(candidate.worktree, "commit", "-qm", "change")
  const store = SupervisorStore.open(path.join(home, "store"))
  stores.push(store)
  const authority = store.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  store.backlog.enqueue({
    id: "work1",
    projectID: "project1",
    kind: "ship",
    brief: "Ship change",
    deliveryMode: mode,
    mergePolicy: "manual",
  })
  store.backlog.dispatch("work1", () => {
    store.createTask({
      authority,
      messageID: "initial",
      task: {
        id: "task1",
        kind: "ship",
        project,
        worktree: candidate.worktree,
        branch: candidate.branch,
        baseRef: "main",
        baseCommit: git(project, "rev-parse", "HEAD"),
        sessionID: "worker1",
        brief: "Ship change",
        model: { providerID: "openai", modelID: "gpt-test" },
        agent: "build",
        permissions: [],
      },
    })
    return "task1"
  })
  store.ackOutbox({ authority, taskID: "task1", messageID: "initial" })
  const receipt = store.proposeReceipt({
    taskID: "task1",
    operationID: "initial",
    receipt: { kind: "ship", evidence: { head: git(candidate.worktree, "rev-parse", "HEAD") } },
  })
  store.observe({
    taskID: "task1",
    sessionID: "worker1",
    cursor: 1,
    delivered: ["initial"],
    outcome: "succeeded",
    receipt,
  })
  const runtime = SupervisorDeliveryRuntime.open({
    store,
    runGh,
    authorize(actor, generation) {
      const lead = store.lead()
      if (
        !lead?.active ||
        generation !== lead.generation ||
        !("operator" in actor || actor.sessionID === lead.sessionID)
      )
        throw new Error("Not authorized")
      return authority
    },
    quiet: async () => ({ outcome: "succeeded" }),
    complete(task, lead) {
      if (task.status !== "completed") store.completeTask({ authority: lead, taskID: task.id })
    },
    cleanup(task, landing) {
      store.recordCleanup({ taskID: task.id, evidence: landing })
      return store.cleanup(task.id)
    },
  })
  return { home, project, candidate, store, authority, runtime }
}

test("local delivery prepares only completed receipt work and recovers a merge after a lost reply", async () => {
  const { project, candidate, store, authority, runtime } = await fixture()
  const actor = { operator: true as const }
  const prepared = await runtime.request(actor, {
    type: "delivery.prepare",
    taskID: "task1",
    generation: authority.generation,
  })
  expect(prepared).toMatchObject({
    mode: "local-only",
    status: "pending",
    sourceHead: git(candidate.worktree, "rev-parse", "HEAD"),
  })
  const ready = await runtime.request(actor, {
    type: "delivery.approve",
    taskID: "task1",
    generation: authority.generation,
    reference: "operator-approval-1",
  })
  expect(ready).toMatchObject({ status: "ready" })
  const record = store.deliveries.get("task1")!
  store.deliveries.record({ ...record, status: "blocked", blocker: "landing_outcome_unknown" })
  git(project, "merge", "--ff-only", record.sourceHead!)
  const recovered = await runtime.request(actor, {
    type: "delivery.reconcile",
    taskID: "task1",
    generation: authority.generation,
  })
  expect(recovered).toMatchObject({
    status: "landed",
    landing: {
      kind: "local",
      sourceHead: record.sourceHead,
      targetHead: record.targetHead,
      mergeCommit: record.sourceHead,
    },
  })
  expect(
    await runtime.request(actor, { type: "delivery.reconcile", taskID: "task1", generation: authority.generation }),
  ).toEqual(recovered)
  expect(
    await runtime.request(actor, { type: "delivery.cleanup", taskID: "task1", generation: authority.generation }),
  ).toMatchObject({ kind: "local" })
  rmSync(candidate.worktree, { recursive: true, force: true })
  expect(
    await runtime.request(actor, { type: "delivery.cleanup", taskID: "task1", generation: authority.generation }),
  ).toMatchObject({ kind: "local" })
})

test("completed local work can cancel its waiting delivery and cannot land afterward", async () => {
  const { store, authority, runtime } = await fixture()
  const actor = { operator: true as const }
  const prepared = (await runtime.request(actor, {
    type: "delivery.prepare",
    taskID: "task1",
    generation: authority.generation,
  })) as SupervisorDelivery.Record
  expect(prepared.policyProvenance.source).toBe("registry")
  expect(store.task("task1")?.status).toBe("completed")
  const cancelled = await runtime.request(actor, {
    type: "delivery.cancel",
    taskID: "task1",
    generation: authority.generation,
  })
  expect(cancelled).toMatchObject({ status: "cancelled", cancellation: { source: "operator" } })
  expect(
    await runtime.request(actor, { type: "delivery.cancel", taskID: "task1", generation: authority.generation }),
  ).toEqual(cancelled)
  await expect(
    runtime.request(actor, { type: "delivery.land", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow("Cancelled")
})

test("cancelled completed ship work cannot prepare delivery, including after restart", async () => {
  const { home, store, authority, runtime } = await fixture()
  const actor = { operator: true as const }
  store.completeTask({ authority, taskID: "task1" })
  expect(store.task("task1")?.status).toBe("completed")
  expect(store.backlog.settleCancelled("work1").state).toBe("cancelled")
  await expect(
    runtime.request(actor, { type: "delivery.prepare", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow("Cancelled work")
  expect(store.deliveries.get("task1")).toBeUndefined()

  store.close()
  stores.pop()
  const reopened = SupervisorStore.open(path.join(home, "store"))
  stores.push(reopened)
  const recovered = SupervisorDeliveryRuntime.open({
    store: reopened,
    authorize: () => authority,
    quiet: async () => ({ outcome: "succeeded" }),
    complete: () => {},
    cleanup: () => {},
  })
  await expect(
    recovered.request(actor, { type: "delivery.prepare", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow("Cancelled work")
  expect(reopened.deliveries.get("task1")).toBeUndefined()
})

test("target movement clears exact-head manual approval", async () => {
  const { project, store, authority, runtime } = await fixture()
  const actor = { operator: true as const }
  await runtime.request(actor, { type: "delivery.prepare", taskID: "task1", generation: authority.generation })
  await runtime.request(actor, {
    type: "delivery.approve",
    taskID: "task1",
    generation: authority.generation,
    reference: "operator-approval-1",
  })
  writeFileSync(path.join(project, "other"), "other")
  git(project, "add", "other")
  git(project, "commit", "-qm", "move target")
  const refreshed = await runtime.refresh("task1")
  expect(refreshed.status).toBe("pending")
  expect(refreshed.approval).toBeUndefined()
  expect(refreshed.targetHead).toBe(git(project, "rev-parse", "HEAD"))
  expect(store.deliveries.get("task1")?.approval).toBeUndefined()
  await expect(
    runtime.request(actor, { type: "delivery.land", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow("not ready")
})

test("a merged origin PR reconciles from the saved exact-head landing intent", async () => {
  const url = "https://github.com/owner/repo/pull/7"
  const mergeCommit = "f".repeat(40)
  let merged = false
  let sourceHead = ""
  let targetHead = ""
  const runGh: SupervisorDelivery.GhRunner = async (_cwd, args) => {
    if (args[1] === "view")
      return {
        code: 0,
        stdout: JSON.stringify({
          url,
          number: 7,
          headRefOid: sourceHead,
          baseRefName: "main",
          baseRefOid: targetHead,
          baseRepository: { nameWithOwner: "owner/repo" },
          state: merged ? "MERGED" : "OPEN",
          mergeCommit: merged ? { oid: mergeCommit } : null,
        }),
        stderr: "",
      }
    if (args[1] === "checks") return { code: 0, stdout: "[]", stderr: "" }
    throw new Error("Reconciliation must not issue a merge or create command")
  }
  const { store, authority, runtime } = await fixture("direct-PR", runGh)
  const actor = { operator: true as const }
  const prepared = (await runtime.request(actor, {
    type: "delivery.prepare",
    taskID: "task1",
    generation: authority.generation,
  })) as SupervisorDelivery.Record
  sourceHead = prepared.sourceHead!
  targetHead = prepared.targetHead!
  store.deliveries.record({
    ...prepared,
    pr: {
      url,
      repo: "github.com/owner/repo",
      number: 7,
      head: sourceHead,
      base: "main",
      baseHead: targetHead,
      state: "OPEN",
    },
    checks: { sourceHead, status: "empty", required: [] },
  })
  const ready = (await runtime.request(actor, {
    type: "delivery.approve",
    taskID: "task1",
    generation: authority.generation,
    reference: "approval-7",
  })) as SupervisorDelivery.Record
  expect(ready.status).toBe("ready")
  store.deliveries.record({ ...ready, status: "blocked", blocker: "landing_outcome_unknown" })
  merged = true
  const landed = await runtime.request(actor, {
    type: "delivery.reconcile",
    taskID: "task1",
    generation: authority.generation,
  })
  expect(landed).toMatchObject({ status: "landed", landing: { kind: "pr", sourceHead, targetHead, mergeCommit } })
})

test("revoking the lead during forge observation stops PR publication before push", async () => {
  let storeRef: ReturnType<typeof SupervisorStore.open> | undefined
  let authorityRef: SupervisorStore.Authority | undefined
  const calls: string[][] = []
  const runGh: SupervisorDelivery.GhRunner = async (_cwd, args) => {
    calls.push(args)
    if (args[1] === "list") {
      storeRef!.revokeLead(authorityRef!)
      return { code: 0, stdout: "[]", stderr: "" }
    }
    throw new Error("No PR should be created after revocation")
  }
  const { project, store, authority, runtime } = await fixture("direct-PR", runGh)
  storeRef = store
  authorityRef = authority
  await runtime.request(
    { operator: true },
    { type: "delivery.prepare", taskID: "task1", generation: authority.generation },
  )
  await expect(
    runtime.request(
      { operator: true },
      {
        type: "delivery.publish",
        taskID: "task1",
        generation: authority.generation,
        title: "fix: fixture",
        body: "Fixture PR",
      },
    ),
  ).rejects.toThrow("Not authorized")
  expect(calls.map((args) => args[1])).toEqual(["list"])
  expect(git(project, "branch", "-r")).toBe("")
})

test("revoking the lead while reading final checks stops the merge mutation", async () => {
  const url = "https://github.com/owner/repo/pull/8"
  let storeRef: ReturnType<typeof SupervisorStore.open> | undefined
  let authorityRef: SupervisorStore.Authority | undefined
  let sourceHead = ""
  let targetHead = ""
  let revokeOnChecks = false
  const calls: string[][] = []
  const runGh: SupervisorDelivery.GhRunner = async (_cwd, args) => {
    calls.push(args)
    if (args[1] === "view")
      return {
        code: 0,
        stdout: JSON.stringify({
          url,
          number: 8,
          headRefOid: sourceHead,
          baseRefName: "main",
          baseRefOid: targetHead,
          baseRepository: { nameWithOwner: "owner/repo" },
          state: "OPEN",
          mergeCommit: null,
        }),
        stderr: "",
      }
    if (args[1] === "checks") {
      if (revokeOnChecks) storeRef!.revokeLead(authorityRef!)
      return { code: 0, stdout: "[]", stderr: "" }
    }
    throw new Error("Merge must not be issued after revocation")
  }
  const { store, authority, runtime } = await fixture("direct-PR", runGh)
  storeRef = store
  authorityRef = authority
  const prepared = (await runtime.request(
    { operator: true },
    { type: "delivery.prepare", taskID: "task1", generation: authority.generation },
  )) as SupervisorDelivery.Record
  sourceHead = prepared.sourceHead!
  targetHead = prepared.targetHead!
  store.deliveries.record({
    ...prepared,
    pr: {
      url,
      repo: "github.com/owner/repo",
      number: 8,
      head: sourceHead,
      base: "main",
      baseHead: targetHead,
      state: "OPEN",
    },
  })
  expect(
    await runtime.request(
      { operator: true },
      { type: "delivery.approve", taskID: "task1", generation: authority.generation, reference: "approved" },
    ),
  ).toMatchObject({ status: "ready" })
  revokeOnChecks = true
  await expect(
    runtime.request({ operator: true }, { type: "delivery.land", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow(/authorized|stale|revoked/)
  expect(calls.every((args) => args[1] !== "merge")).toBe(true)
})

test("cancellation with an unproven validation launch stays blocked without terminal proof", async () => {
  const { home, store, authority, runtime } = await fixture("no-mistakes")
  const actor = { operator: true as const }
  const prepared = (await runtime.request(actor, {
    type: "delivery.prepare",
    taskID: "task1",
    generation: authority.generation,
  })) as SupervisorDelivery.Record
  const db = new DatabaseSync(path.join(home, "store", "supervisor.sqlite"))
  try {
    const record = {
      taskID: "task1",
      generation: 1,
      worktree: store.task("task1")!.worktree,
      origin: "git@github.com:owner/repo.git",
      baseBranch: "main",
      branch: store.task("task1")!.branch,
      nonce: "nonce-1",
      submittedHead: prepared.sourceHead,
      intentHash: "f".repeat(64),
      state: "unknown",
      headChain: [prepared.sourceHead],
      findings: [],
      rawOutput: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    db.prepare(
      `INSERT INTO supervisor_validation
      (task_id, generation, nonce, submitted_head, intent_hash, run_id, state, record)
      VALUES (?, ?, ?, ?, ?, NULL, 'unknown', ?)`,
    ).run("task1", 1, "nonce-1", prepared.sourceHead!, record.intentHash, JSON.stringify(record))
  } finally {
    db.close()
  }
  await expect(
    runtime.request(actor, { type: "delivery.cancel", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow("no proven run ID")
  expect(store.deliveries.get("task1")).toMatchObject({ status: "blocked", blocker: "cancellation_outcome_unknown" })
  expect(store.deliveries.get("task1")?.cancellation).toBeUndefined()
  await expect(
    runtime.request(actor, { type: "delivery.land", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow()
})

test("cancel closes only the exact owned PR and retries an uncertain close by observation", async () => {
  const url = "https://github.com/owner/repo/pull/9"
  let sourceHead = ""
  let targetHead = ""
  let branch = ""
  let closed = false
  let closes = 0
  const calls: string[][] = []
  const runGh: SupervisorDelivery.GhRunner = async (_cwd, args) => {
    calls.push(args)
    if (args[1] === "view")
      return {
        code: 0,
        stdout: JSON.stringify({
          url,
          number: 9,
          headRefName: branch,
          headRefOid: sourceHead,
          baseRefName: "main",
          baseRefOid: targetHead,
          baseRepository: { nameWithOwner: "owner/repo" },
          state: closed ? "CLOSED" : "OPEN",
          mergeCommit: null,
        }),
        stderr: "",
      }
    if (args[1] === "close") {
      closes++
      if (closes === 2) closed = true
      return { code: closes === 1 ? 1 : 0, stdout: "", stderr: closes === 1 ? "reply lost" : "" }
    }
    throw new Error("Unexpected forge mutation")
  }
  const { store, authority, runtime, candidate } = await fixture("direct-PR", runGh)
  const actor = { operator: true as const }
  const prepared = (await runtime.request(actor, {
    type: "delivery.prepare",
    taskID: "task1",
    generation: authority.generation,
  })) as SupervisorDelivery.Record
  sourceHead = prepared.sourceHead!
  targetHead = prepared.targetHead!
  branch = candidate.branch
  store.deliveries.record({
    ...prepared,
    pr: {
      url,
      repo: "github.com/owner/repo",
      number: 9,
      head: sourceHead,
      headBranch: branch,
      base: "main",
      baseHead: targetHead,
      state: "OPEN",
    },
  })
  await expect(
    runtime.request(actor, { type: "delivery.cancel", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow("CLOSED proof")
  expect(store.deliveries.get("task1")).toMatchObject({ status: "blocked", blocker: "close_outcome_unknown" })
  expect(store.deliveries.get("task1")?.cancellation).toBeUndefined()
  await expect(
    runtime.request(actor, { type: "delivery.land", taskID: "task1", generation: authority.generation }),
  ).rejects.toThrow()
  const cancelled = await runtime.request(actor, {
    type: "delivery.cancel",
    taskID: "task1",
    generation: authority.generation,
  })
  expect(cancelled).toMatchObject({
    status: "cancelled",
    pr: { state: "CLOSED", head: sourceHead },
    cancellation: { prURL: url, prState: "CLOSED" },
  })
  expect(closes).toBe(2)
  expect(calls.filter((args) => args[1] === "close")).toEqual([
    ["pr", "close", url, "--repo", "owner/repo"],
    ["pr", "close", url, "--repo", "owner/repo"],
  ])
  expect(calls.flat().includes("--delete-branch")).toBe(false)
})
