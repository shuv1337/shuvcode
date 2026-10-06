import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SupervisorStore } from "../src/supervisor/store"

const homes: string[] = []
const stores: ReturnType<typeof SupervisorStore.open>[] = []
const home = () => {
  const result = mkdtempSync(join(tmpdir(), "supervisor-store-"))
  homes.push(result)
  return result
}
const open = (dir: string, managed?: { epoch: number; pilotID: string }) => {
  const result = SupervisorStore.open(dir, managed)
  stores.push(result)
  return result
}

afterEach(() => {
  stores
    .splice(0)
    .reverse()
    .forEach((store) => store.close())
  homes.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

const task = (id: string) => ({
  id,
  kind: "ship" as const,
  project: "/project",
  worktree: "/project/worktree",
  branch: "native-supervisor",
  baseRef: "integration-v2",
  baseCommit: "a".repeat(40),
  sessionID: `worker-${id}`,
  brief: "Ship the approved change",
  model: { providerID: "openai", modelID: "gpt-6.1-sol" },
  agent: "build",
  permissions: [],
})

test("keyed decision retries preserve the original answer after transfer and completion", () => {
  const dir = home()
  const store = open(dir)
  const first = store.activateLead({ sessionID: "lead-a", expectedGeneration: 0 })
  store.createTask({ authority: first, task: task("a"), messageID: "initial" })
  store.openDecision({ taskID: "a", id: "choice", payload: { question: "Which branch?", requiredAuthority: "user" } })
  const answer = {
    authority: first,
    taskID: "a",
    id: "choice",
    expectedQuestion: "Which branch?",
    requestID: "click-123456",
    resolution: { answer: "integration-v2", requestID: "click-123456", generation: first.generation },
    messageID: "answer-choice",
    payload: { text: "integration-v2", delivery: "steer" as const },
  }
  expect(() => store.resolveDecision({ ...answer, expectedQuestion: "Old question?" })).toThrow("changed")
  store.resolveDecision(answer)
  const next = store.activateLead({ sessionID: "lead-b", expectedGeneration: first.generation, adoptPending: true })
  store.cancelTask({ authority: next, taskID: "a" })
  store.settleCancellation({ authority: next, taskID: "a" })
  expect(
    store.resolveDecision({
      ...answer,
      authority: next,
      resolution: { ...answer.resolution, generation: next.generation },
    }),
  ).toEqual(answer.resolution)
  expect(store.obligations("a")).toHaveLength(2)
  expect(store.decisions("a")[0]?.resolution).toEqual(answer.resolution)
  expect(() =>
    store.resolveDecision({ ...answer, authority: next, resolution: { ...answer.resolution, answer: "main" } }),
  ).toThrow("Conflicting")
})

test("lead generation fences old writers and a revocation cannot be reused", () => {
  const store = open(home())
  const first = store.activateLead({ sessionID: "lead-a", expectedGeneration: 0 })
  store.createTask({ authority: first, task: task("a"), messageID: "initial-a" })
  expect(store.pendingOutbox()).toHaveLength(1)
  const next = store.activateLead({ sessionID: "lead-b", expectedGeneration: first.generation })
  expect(store.pendingOutbox()).toEqual([])
  expect(store.outbox("a")[0]?.generation).toBe(first.generation)
  expect(() =>
    store.enqueue({ authority: first, taskID: "a", messageID: "again", payload: { text: "again", delivery: "steer" } }),
  ).toThrow()
  expect(() => store.ackOutbox({ authority: next, taskID: "a", messageID: "initial-a" })).toThrow()
  expect(
    store.enqueue({
      authority: next,
      taskID: "a",
      messageID: "initial-a",
      payload: { text: "ignored", delivery: "steer" },
    }).payload,
  ).toEqual({ text: task("a").brief, delivery: "queue" })
  expect(store.pendingOutbox()).toHaveLength(1)
  store.ackOutbox({ authority: next, taskID: "a", messageID: "initial-a" })
  store.revokeLead(next)
  expect(store.lead()).toEqual({ sessionID: "lead-b", generation: next.generation + 1, active: false })
  expect(() => store.activateLead({ sessionID: "lead-a", expectedGeneration: next.generation })).toThrow()
})

test("fresh lead adopts pending notices with new native message identities", () => {
  const store = open(home())
  const first = store.activateLead({ sessionID: "lead-a", expectedGeneration: 0 })
  const notice = store.enqueueNotice({ key: "return-input", payload: { text: "Deferred request", delivery: "steer" } })
  const next = store.activateLead({ sessionID: "lead-b", expectedGeneration: first.generation, adoptPending: true })
  const adopted = store.pendingNotices()
  expect(adopted).toHaveLength(1)
  expect(adopted[0]).toMatchObject({
    sessionID: "lead-b",
    generation: next.generation,
    key: notice.key,
    payload: notice.payload,
  })
  expect(adopted[0]!.messageID).not.toBe(notice.messageID)
  expect(store.isNotice(notice.messageID)).toBe(true)
  expect(store.isNotice(adopted[0]!.messageID)).toBe(true)
  store.ackNotice({ generation: next.generation, key: notice.key })
  store.activateLead({ sessionID: "lead-c", expectedGeneration: next.generation, adoptPending: true })
  expect(store.pendingNotices()).toEqual([])
})

test("task creation and initial obligation survive reopen with first payload", () => {
  const dir = home()
  const first = open(dir)
  const lead = first.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  first.bindServer("http://127.0.0.1:4919")
  expect(first.createTask({ authority: lead, task: task("a"), messageID: "initial" }).provisioned).toBe(false)
  first.markProvisioned({ authority: lead, taskID: "a" })
  first.close()
  stores.pop()
  const second = open(dir)
  expect(second.task("a")?.provisioned).toBe(true)
  expect(second.pendingOutbox()).toEqual([
    { taskID: "a", messageID: "initial", payload: { text: task("a").brief, delivery: "queue" } },
  ])
  expect(second.createTask({ authority: lead, task: task("a"), messageID: "initial" }).id).toBe("a")
  expect(() =>
    second.createTask({ authority: lead, task: { ...task("a"), brief: "changed" }, messageID: "initial" }),
  ).toThrow()
  expect(() => second.bindServer("http://127.0.0.1:4920")).toThrow()
  expect(statSync(dir).mode & 0o777).toBe(0o700)
  expect(statSync(join(dir, "supervisor.sqlite")).mode & 0o777).toBe(0o600)
})

test("duplicates keep first message and cancellation stops dispatch", () => {
  const store = open(home())
  const lead = store.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  store.createTask({ authority: lead, task: task("a"), messageID: "initial" })
  const first = store.enqueue({
    authority: lead,
    taskID: "a",
    messageID: "extra",
    payload: { text: "first", delivery: "steer" },
  })
  expect(
    store.enqueue({ authority: lead, taskID: "a", messageID: "extra", payload: { text: "second", delivery: "queue" } }),
  ).toEqual(first)
  store.cancelTask({ authority: lead, taskID: "a" })
  expect(store.task("a")?.status).toBe("cancelling")
  expect(store.pendingOutbox()).toEqual([])
  expect(() => store.enqueue({ authority: lead, taskID: "a", messageID: "extra", payload: first.payload })).toThrow()
  expect(() => store.ackOutbox({ authority: lead, taskID: "a", messageID: "extra" })).toThrow()
  store.settleCancellation({ authority: lead, taskID: "a" })
  expect(store.task("a")?.status).toBe("cancelled")
})

test("cancellation retains a provisional receipt for audit without settling it", () => {
  const dir = home()
  const store = open(dir)
  const lead = store.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  store.createTask({ authority: lead, task: task("a"), messageID: "initial" })
  const proposed = store.proposeReceipt({
    taskID: "a",
    operationID: "initial",
    receipt: { kind: "ship", evidence: { artifact: "proof" } },
  })
  store.cancelTask({ authority: lead, taskID: "a" })
  expect(store.pendingReceipts()).toEqual([{ taskID: "a", receipt: proposed }])
  expect(() => store.observe({ taskID: "a", sessionID: "worker-a", cursor: 1, receipt: proposed })).toThrow()
  expect(store.obligations("a")[0]?.state).toBe("cancelled")
  store.close()
  stores.pop()
  expect(open(dir).pendingReceipts()).toEqual([{ taskID: "a", receipt: proposed }])
})

test("cursor and verified receipt commit together; idle alone cannot complete", () => {
  const dir = home()
  const store = open(dir)
  const lead = store.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  store.createTask({ authority: lead, task: task("a"), messageID: "initial" })
  store.createTask({ authority: lead, task: task("b"), messageID: "initial" })
  expect(() => store.completeTask({ authority: lead, taskID: "a" })).toThrow()
  store.observe({ taskID: "a", sessionID: "worker-a", cursor: 1 })
  expect(() => store.observe({ taskID: "a", sessionID: "worker-b", cursor: 2 })).toThrow()
  expect(store.task("a")?.cursor).toBe(1)
  const receipt = store.proposeReceipt({
    taskID: "a",
    operationID: "initial",
    receipt: { kind: "ship", evidence: { commit: "abc" } },
  })
  expect(store.pendingReceipts()).toEqual([{ taskID: "a", receipt }])
  expect(() => store.observe({ taskID: "a", sessionID: "worker-a", cursor: 2, receipt })).toThrow()
  expect(store.task("a")?.cursor).toBe(1)
  store.ackOutbox({ authority: lead, taskID: "a", messageID: "initial" })
  expect(() => store.observe({ taskID: "a", sessionID: "worker-a", cursor: 2, receipt })).toThrow()
  store.observe({
    taskID: "a",
    sessionID: "worker-a",
    cursor: 2,
    delivered: ["initial"],
    outcome: "succeeded",
    receipt,
  })
  store.observe({ taskID: "a", sessionID: "worker-a", cursor: 2, receipt })
  expect(store.task("a")?.cursor).toBe(2)
  expect(store.pendingReceipts()).toEqual([])
  expect(store.receipts("a")).toEqual([receipt])
  expect(store.receipts("b")).toEqual([])
  store.openDecision({ authority: lead, taskID: "a", id: "review", payload: { question: "Proceed?" } })
  expect(() => store.completeTask({ authority: lead, taskID: "a" })).toThrow()
  store.resolveDecision({ authority: lead, taskID: "a", id: "review", resolution: true })
  store.completeTask({ authority: lead, taskID: "a" })
  expect(store.task("a")?.status).toBe("completed")
  expect(store.ownedMessages("a")).toEqual(["initial"])
  store.recordCleanup({ taskID: "a", evidence: { deleted: true } })
  expect(store.cleanup("a")).toEqual({ deleted: true })
  store.close()
  stores.pop()
  const reopened = open(dir)
  expect(reopened.receipts("a")).toEqual([receipt])
  expect(reopened.cleanup("a")).toEqual({ deleted: true })
})

test("a second opener is locked out until the first closes", () => {
  const dir = home()
  const first = open(dir)
  expect(() => SupervisorStore.open(dir)).toThrow()
  first.close()
  stores.pop()
  expect(open(dir).lead()).toBeUndefined()
})

test("process death releases the SQLite writer lock", async () => {
  const dir = home()
  const moduleURL = new URL("../src/supervisor/store.ts", import.meta.url).href
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { SupervisorStore } from ${JSON.stringify(moduleURL)}; SupervisorStore.open(${JSON.stringify(dir)}); console.log("READY"); setInterval(() => {}, 1000)`,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const ready = await Promise.race([
      child.stdout.getReader().read(),
      Bun.sleep(5000).then(() => {
        throw new Error("Child did not acquire supervisor lock")
      }),
    ])
    expect(new TextDecoder().decode(ready.value)).toContain("READY")
    expect(() => SupervisorStore.open(dir)).toThrow()
  } finally {
    child.kill("SIGKILL")
    await child.exited
  }
  expect(open(dir).lead()).toBeUndefined()
})

test("lead notices persist once per generation and fence transfer", () => {
  const dir = home()
  const store = open(dir)
  const first = store.activateLead({ sessionID: "lead-a", expectedGeneration: 0 })
  const notice = store.enqueueNotice({
    key: "task-a:decision-review",
    payload: { text: "Review A", delivery: "steer" },
  })
  expect(
    store.enqueueNotice({ key: "task-a:decision-review", payload: { text: "Changed", delivery: "queue" } }),
  ).toEqual(notice)
  expect(store.pendingNotices()).toEqual([notice])
  store.close()
  stores.pop()
  const reopened = open(dir)
  expect(reopened.pendingNotices()).toEqual([notice])
  const next = reopened.activateLead({ sessionID: "lead-b", expectedGeneration: first.generation })
  expect(reopened.pendingNotices()).toEqual([])
  expect(() => reopened.ackNotice({ generation: first.generation, key: notice.key })).toThrow()
  const replacement = reopened.enqueueNotice({ key: notice.key, payload: notice.payload })
  expect(replacement.generation).toBe(next.generation)
  expect(replacement.messageID).not.toBe(notice.messageID)
  reopened.ackNotice({ generation: next.generation, key: notice.key })
  expect(reopened.pendingNotices()).toEqual([])
})

test("dispatch retry latches uncertainty and blocks cancellation settlement", () => {
  const store = open(home())
  const lead = store.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  store.createTask({ authority: lead, task: task("a"), messageID: "initial" })
  store.beginDispatch({ authority: lead, taskID: "a", messageID: "initial" })
  expect(store.outbox("a")[0]?.attempted).toBe(true)
  expect(() => store.beginDispatch({ authority: lead, taskID: "a", messageID: "initial" })).toThrow()
  expect(store.task("a")?.admissionUncertain).toBe(true)
  store.cancelTask({ authority: lead, taskID: "a" })
  expect(store.outbox("a")[0]?.state).toBe("cancelled")
  expect(() => store.settleCancellation({ authority: lead, taskID: "a" })).toThrow()
})

test("fenced managed restart clears only attempts made by the retired native epoch", () => {
  const dir = home()
  const first = open(dir, { epoch: 1, pilotID: "pilot" })
  const lead = first.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  first.createTask({ authority: lead, task: task("old"), messageID: "old-message" })
  first.beginDispatch({ authority: lead, taskID: "old", messageID: "old-message" })
  first.markAdmissionUncertain("old")
  first.cancelTask({ authority: lead, taskID: "old" })
  first.close()
  stores.pop()

  const next = open(dir, { epoch: 2, pilotID: "pilot" })
  next.createTask({ authority: lead, task: task("new"), messageID: "new-message" })
  next.beginDispatch({ authority: lead, taskID: "new", messageID: "new-message" })
  next.markAdmissionUncertain("new")
  expect(() => next.settleCancellation({ authority: lead, taskID: "old" })).toThrow()
  expect(() => next.recoverFencedEpoch({ from: 1, to: 2, pilotID: "foreign" })).toThrow()
  next.close()
  stores.pop()
  const resumed = open(dir, { epoch: 2, pilotID: "pilot" })
  expect(resumed.recoverFencedEpoch({ from: 1, to: 2, pilotID: "pilot" })).toEqual({ reset: 1, cleared: 1 })
  expect(() => resumed.recoverFencedEpoch({ from: 1, to: 2, pilotID: "pilot" })).toThrow()
  expect(resumed.task("old")?.admissionUncertain).toBe(false)
  expect(resumed.outbox("old")[0]?.attempted).toBe(false)
  expect(resumed.task("new")?.admissionUncertain).toBe(true)
  expect(resumed.outbox("new")[0]?.attemptEpoch).toBe(2)
  resumed.settleCancellation({ authority: lead, taskID: "old" })
  expect(resumed.task("old")?.status).toBe("cancelled")
})

test("legacy admission without a managed epoch stays uncertain", () => {
  const dir = home()
  const legacy = open(dir)
  const lead = legacy.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  legacy.createTask({ authority: lead, task: task("legacy"), messageID: "initial" })
  legacy.beginDispatch({ authority: lead, taskID: "legacy", messageID: "initial" })
  legacy.markAdmissionUncertain("legacy")
  legacy.close()
  stores.pop()
  const managed = open(dir, { epoch: 1, pilotID: "pilot" })
  expect(() => managed.recoverFencedEpoch({ from: 0, to: 1, pilotID: "pilot" })).toThrow()
  expect(managed.task("legacy")?.admissionUncertain).toBe(true)
})

test("pending recovery spans more than one retired native epoch", () => {
  const dir = home()
  const first = open(dir, { epoch: 1, pilotID: "pilot" })
  const lead = first.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  first.createTask({ authority: lead, task: task("first"), messageID: "first-message" })
  first.beginDispatch({ authority: lead, taskID: "first", messageID: "first-message" })
  first.markAdmissionUncertain("first")
  first.close()
  stores.pop()

  const second = open(dir, { epoch: 2, pilotID: "pilot" })
  second.createTask({ authority: lead, task: task("second"), messageID: "second-message" })
  second.beginDispatch({ authority: lead, taskID: "second", messageID: "second-message" })
  second.markAdmissionUncertain("second")
  second.close()
  stores.pop()

  const third = open(dir, { epoch: 3, pilotID: "pilot" })
  expect(third.recoverFencedEpoch({ from: 1, to: 3, pilotID: "pilot" })).toEqual({ reset: 2, cleared: 2 })
  expect(third.task("first")?.admissionUncertain).toBe(false)
  expect(third.task("second")?.admissionUncertain).toBe(false)
})

test("decision answer and outbox are atomic, and unsuccessful native outcome cannot settle receipt", () => {
  const store = open(home())
  const lead = store.activateLead({ sessionID: "lead", expectedGeneration: 0 })
  store.createTask({ authority: lead, task: task("a"), messageID: "initial" })
  store.openDecision({ taskID: "a", id: "review", payload: { question: "Proceed?" } })
  store.resolveDecision({
    authority: lead,
    taskID: "a",
    id: "review",
    resolution: { answer: "yes" },
    messageID: "msg_answer",
    payload: { text: "yes", delivery: "steer" },
  })
  expect(store.obligations("a")).toHaveLength(2)
  expect(store.pendingOutbox().map((entry) => entry.messageID)).toEqual(["initial", "msg_answer"])
  store.ackOutbox({ authority: lead, taskID: "a", messageID: "initial" })
  const receipt = store.proposeReceipt({
    taskID: "a",
    operationID: "initial",
    receipt: { kind: "ship", evidence: { proof: true } },
  })
  store.observe({ taskID: "a", sessionID: "worker-a", cursor: 1, delivered: ["initial"], outcome: "failed" })
  expect(() => store.observe({ taskID: "a", sessionID: "worker-a", cursor: 1, receipt })).toThrow()
  expect(store.receipts("a")).toEqual([])
  store.observe({ taskID: "a", sessionID: "worker-a", cursor: 2, outcome: "succeeded", receipt })
  expect(store.receipts("a")).toEqual([receipt])
  expect(() => store.completeTask({ authority: lead, taskID: "a" })).toThrow()
})
