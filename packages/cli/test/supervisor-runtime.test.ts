import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { SupervisorNative } from "../src/supervisor/native"
import { SupervisorRuntime } from "../src/supervisor/runtime"
import { SupervisorStore } from "../src/supervisor/store"

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "supervisor-runtime-"))
  const project = path.join(root, "project")
  const home = path.join(root, "home")
  await fs.mkdir(project)
  await fs.mkdir(home)
  git(project, "init", "-b", "integration-v2")
  git(project, "config", "user.name", "Fixture")
  git(project, "config", "user.email", "fixture@example.test")
  await fs.writeFile(path.join(project, "README.md"), "# Fixture\n")
  git(project, "add", "README.md")
  git(project, "commit", "-m", "chore: fixture baseline")

  const sessions = new Map<
    string,
    { id: string; location: { directory: string }; parentID?: string; outcome?: "succeeded" }
  >([
    ["lead", { id: "lead", location: { directory: project } }],
    ["other-lead", { id: "other-lead", location: { directory: project } }],
  ])
  const pending = new Map<string, { id: string; type: string; delivery: "queue" | "steer" }[]>()
  const running = new Set<string>()
  const permissionRequests = new Map<string, SupervisorNative.PendingPermission[]>()
  const prompts: string[] = []
  const cancelled: string[] = []
  const interrupts: string[] = []
  const events = new Map<string, SupervisorNative.Event[]>()
  const outcomesOnGet = new Map<string, ("succeeded" | "failed" | "interrupted")[]>()
  let unknownPrompt = false
  const promptGates = new Map<string, Promise<void>>()
  const logGates = new Map<string, { started: () => void; release: Promise<void> }>()
  const native = {
    async get(id: string) {
      const session = sessions.get(id)
      if (!session) throw new Error(`Native session missing: ${id}`)
      const override = outcomesOnGet.get(id)?.shift()
      return override ? { ...session, outcome: override } : session
    },
    async create(input: SupervisorNative.CreateInput) {
      const previous = sessions.get(input.sessionID)
      if (previous) return previous
      const result = { id: input.sessionID, location: { directory: input.directory } }
      sessions.set(input.sessionID, result)
      return result
    },
    async prompt(input: SupervisorNative.PromptInput) {
      if (input.sessionID !== "lead" && input.sessionID !== "other-lead") prompts.push(input.id)
      await promptGates.get(input.sessionID)
      if (unknownPrompt) {
        unknownPrompt = false
        pending.set(input.sessionID, [
          ...(pending.get(input.sessionID) ?? []),
          { id: input.id, type: "user", delivery: input.delivery },
        ])
        throw new SupervisorNative.AdmissionOutcomeUnknownError("prompt", input.id)
      }
      const session = sessions.get(input.sessionID)
      if (session) session.outcome = "succeeded"
      const history = events.get(input.sessionID) ?? []
      history.push({ seq: history.length + 1, name: "session.inbox.delivered", data: { inboxID: input.id } })
      events.set(input.sessionID, history)
    },
    async inbox(id: string) {
      return pending.get(id) ?? []
    },
    async cancel(input: { sessionID: string; inboxID: string }) {
      cancelled.push(input.inboxID)
      pending.set(
        input.sessionID,
        (pending.get(input.sessionID) ?? []).filter((item) => item.id !== input.inboxID),
      )
    },
    async active() {
      return [...running]
    },
    async permissions(_directory: string, sessionID: string) {
      return permissionRequests.get(sessionID) ?? []
    },
    async interrupt(sessionID: string) {
      interrupts.push(sessionID)
    },
    async pluginReady() {},
    async log(input: { sessionID: string; after?: number }) {
      const found = (events.get(input.sessionID) ?? []).filter((event) => event.seq > (input.after ?? 0))
      const gate = logGates.get(input.sessionID)
      logGates.delete(input.sessionID)
      gate?.started()
      await gate?.release
      return { events: found, cursor: found.at(-1)?.seq ?? input.after ?? 0 }
    },
  } as unknown as ReturnType<typeof SupervisorNative.connect>

  const runtimes: Awaited<ReturnType<typeof SupervisorRuntime.open>>[] = []
  async function open(targetHome = home) {
    const runtime = await SupervisorRuntime.open({ home: targetHome, endpoint: "http://127.0.0.1:4919", native })
    runtimes.push(runtime)
    return runtime
  }
  return {
    root,
    project,
    home,
    native,
    sessions,
    pending,
    running,
    permissionRequests,
    prompts,
    cancelled,
    interrupts,
    open,
    appendDelivery(sessionID: string, inboxID: string) {
      const history = events.get(sessionID) ?? []
      history.push({ seq: history.length + 1, name: "session.inbox.delivered", data: { inboxID } })
      events.set(sessionID, history)
    },
    setGetOutcomes(sessionID: string, ...outcomes: ("succeeded" | "failed" | "interrupted")[]) {
      outcomesOnGet.set(sessionID, outcomes)
    },
    failNextPrompt() {
      unknownPrompt = true
    },
    gatePrompt(sessionID: string, gate: Promise<void>) {
      promptGates.set(sessionID, gate)
    },
    gateLog(sessionID: string, started: () => void, release: Promise<void>) {
      logGates.set(sessionID, { started, release })
    },
    async closeRuntime(runtime: Awaited<ReturnType<typeof SupervisorRuntime.open>>) {
      const index = runtimes.indexOf(runtime)
      if (index >= 0) runtimes.splice(index, 1)
      await runtime.close()
    },
    async close() {
      await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
      await fs.rm(root, { recursive: true, force: true })
    },
  }
}

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

const operator = { operator: true } as const
const worker = (sessionID: string) => ({ sessionID })

async function activate(runtime: Awaited<ReturnType<typeof SupervisorRuntime.open>>) {
  return (await runtime.request(operator, {
    type: "lead.activate",
    sessionID: "lead",
    expectedGeneration: 0,
  })) as SupervisorStore.Lead
}

async function create(
  runtime: Awaited<ReturnType<typeof SupervisorRuntime.open>>,
  project: string,
  generation: number,
  taskID = "task",
) {
  return (await runtime.request(operator, {
    type: "task.create",
    generation,
    taskID,
    kind: "ship",
    project,
    baseRef: "integration-v2",
    brief: "Ship the fixture",
    model: { providerID: "test", modelID: "test-model" },
    agent: "build",
    permissions: [],
  })) as SupervisorStore.Task
}

test("the managed lead name cannot be used as a worker task ID", async () => {
  const current = await fixture()
  try {
    const runtime = await current.open()
    const lead = await activate(runtime)
    await expect(create(runtime, current.project, lead.generation, "lead")).rejects.toThrow("reserved")
    expect((await status(runtime, "lead")).tasks).toEqual([])
  } finally {
    await current.close()
  }
})

async function status(runtime: Awaited<ReturnType<typeof SupervisorRuntime.open>>, taskID: string) {
  const result = await runtime.request(operator, { type: "status", taskID })
  return result as {
    lead: SupervisorStore.Lead
    tasks: (SupervisorStore.Task & {
      receipts: SupervisorStore.Receipt[]
      obligations: SupervisorStore.Obligation[]
      decisions: SupervisorStore.Decision[]
      cleanup?: unknown
      native: { state: "running" | "idle" | "unknown"; pending: number; permissions: number }
    })[]
  }
}

test("a blocked native admission leaves unrelated work and status responsive", async () => {
  const setup = await fixture()
  const release = Promise.withResolvers<void>()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const slow = await create(runtime, setup.project, lead.generation, "slow")
    const fast = await create(runtime, setup.project, lead.generation, "fast")
    setup.gatePrompt(slow.sessionID, release.promise)
    const draining = runtime.reconcile()
    const deadline = Date.now() + 2000
    while (!setup.sessions.get(fast.sessionID)?.outcome && Date.now() < deadline) await Bun.sleep(5)
    expect(setup.sessions.get(fast.sessionID)?.outcome).toBe("succeeded")
    const snapshot = await Promise.race([
      runtime.request(operator, { type: "status" }),
      Bun.sleep(500).then(() => "blocked"),
    ])
    expect(snapshot).not.toBe("blocked")
    await runtime.request(operator, { type: "task.cancel", taskID: fast.id, generation: lead.generation })
    expect((await status(runtime, fast.id)).tasks[0]?.status).toBe("cancelled")
    expect(setup.interrupts).toContain(fast.sessionID)
    release.resolve()
    await draining
    expect((await status(runtime, fast.id)).tasks[0]?.status).toBe("cancelled")
  } finally {
    release.resolve()
    await setup.close()
  }
})

test("startup knowledge budget blocks new work and queued dispatch until curation recovers", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    await runtime.request(operator, {
      type: "project.add",
      generation: lead.generation,
      id: "fixture",
      path: setup.project,
      baseRef: "integration-v2",
      model: { providerID: "test", modelID: "test-model" },
    })
    await runtime.request(operator, {
      type: "work.create",
      generation: lead.generation,
      id: "waiting",
      kind: "scout",
      brief: "Read the fixture",
    })
    await runtime.request(operator, { type: "knowledge.budget.set", budgetTokens: 1 })
    await expect(create(runtime, setup.project, lead.generation, "blocked")).rejects.toThrow("knowledge exceeds")
    await expect(runtime.request(worker("lead"), { type: "knowledge.budget.set", budgetTokens: 7500 })).rejects.toThrow(
      "Only the operator",
    )
    await runtime.reconcile()
    const blocked = await runtime.request(operator, { type: "status", taskID: "waiting" })
    expect(blocked).toMatchObject({ backlog: [{ id: "waiting", state: "queued" }] })
    expect((await status(runtime, "waiting")).tasks).toEqual([])
    await runtime.request(worker("lead"), { type: "knowledge.stow", changes: [] })
    await runtime.request(operator, { type: "knowledge.budget.set", budgetTokens: 7500 })
    await runtime.reconcile()
    expect((await status(runtime, "waiting")).tasks).toHaveLength(1)
    expect(setup.prompts).toHaveLength(1)
  } finally {
    await setup.close()
  }
})

test("captured policy survives defaults changes and landed dependencies start only after landing", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    await runtime.request(operator, {
      type: "project.add",
      generation: lead.generation,
      id: "fixture",
      path: setup.project,
      baseRef: "integration-v2",
      mode: "local-only",
      yolo: true,
      model: { providerID: "test", modelID: "test-model" },
    })
    await runtime.request(operator, {
      type: "work.create",
      generation: lead.generation,
      id: "ship",
      kind: "ship",
      brief: "Ship fixture",
    })
    await runtime.request(operator, {
      type: "work.create",
      generation: lead.generation,
      id: "after",
      kind: "scout",
      brief: "Read landed fixture",
      dependencies: [{ id: "ship", when: "landed" }],
    })
    await runtime.request(operator, {
      type: "project.update",
      generation: lead.generation,
      id: "fixture",
      mode: "no-mistakes",
      yolo: false,
    })
    await runtime.reconcile()
    const ship = (await status(runtime, "ship")).tasks[0]!
    expect((await status(runtime, "after")).tasks).toHaveLength(0)
    await fs.writeFile(path.join(ship.worktree, "RESULT.md"), "Fixture delivered\n")
    git(ship.worktree, "add", "RESULT.md")
    git(ship.worktree, "commit", "-m", "feat: deliver fixture")
    const head = git(ship.worktree, "rev-parse", "HEAD")
    await runtime.request(worker(ship.sessionID), {
      type: "receipt.propose",
      taskID: ship.id,
      operationID: ship.obligations[0]!.operationID,
      evidence: {
        kind: "ship",
        head,
        artifact: {
          relativePath: "RESULT.md",
          sha256: createHash("sha256").update("Fixture delivered\n").digest("hex"),
        },
      },
    })
    await runtime.reconcile()
    const prepared = (await runtime.request(operator, {
      type: "delivery.prepare",
      taskID: ship.id,
      generation: lead.generation,
    })) as { mode: string; mergePolicy: string }
    expect(prepared).toMatchObject({ mode: "local-only", mergePolicy: "auto" })
    expect((await status(runtime, "after")).tasks).toHaveLength(0)
    await runtime.request(operator, { type: "delivery.land", taskID: ship.id, generation: lead.generation })
    expect(git(setup.project, "rev-parse", "HEAD")).toBe(head)
    await runtime.reconcile()
    expect((await status(runtime, "after")).tasks).toHaveLength(1)
    await runtime.request(operator, { type: "delivery.cleanup", taskID: ship.id, generation: lead.generation })
    await runtime.request(operator, { type: "delivery.cleanup", taskID: ship.id, generation: lead.generation })
    expect(await Bun.file(path.join(ship.worktree, "RESULT.md")).exists()).toBe(false)
  } finally {
    await setup.close()
  }
})

test("first delivery prepare revalidates a completed receipt after source HEAD changes", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation, "receipt-drift")
    await runtime.reconcile()
    const active = (await status(runtime, current.id)).tasks[0]!
    await fs.writeFile(path.join(active.worktree, "RESULT.md"), "Commit A\n")
    git(active.worktree, "add", "RESULT.md")
    git(active.worktree, "commit", "-m", "feat: record accepted result")
    const acceptedHead = git(active.worktree, "rev-parse", "HEAD")
    await runtime.request(worker(active.sessionID), {
      type: "receipt.propose",
      taskID: active.id,
      operationID: active.obligations[0]!.operationID,
      evidence: {
        kind: "ship",
        head: acceptedHead,
        artifact: { relativePath: "RESULT.md", sha256: createHash("sha256").update("Commit A\n").digest("hex") },
      },
    })
    await runtime.reconcile()
    await runtime.request(operator, { type: "task.complete", taskID: active.id, generation: lead.generation })
    expect((await status(runtime, active.id)).tasks[0]?.status).toBe("completed")
    await fs.writeFile(path.join(active.worktree, "AFTER.md"), "Commit B\n")
    git(active.worktree, "add", "AFTER.md")
    git(active.worktree, "commit", "-m", "chore: change HEAD after accepted receipt")
    expect(git(active.worktree, "rev-parse", "HEAD")).not.toBe(acceptedHead)
    await expect(
      runtime.request(operator, { type: "delivery.prepare", taskID: active.id, generation: lead.generation }),
    ).rejects.toThrow()
    const snapshot = (await runtime.request(operator, { type: "status", taskID: active.id })) as {
      deliveries: unknown[]
    }
    expect(snapshot.deliveries).toEqual([])
  } finally {
    await setup.close()
  }
})

test("reopen reconciles persisted terminal delivery evidence into in-flight backlog exactly once", async () => {
  for (const terminal of ["landed", "cancelled"] as const) {
    const setup = await fixture()
    try {
      const runtime = await setup.open()
      const lead = await activate(runtime)
      await runtime.request(operator, {
        type: "project.add",
        generation: lead.generation,
        id: "fixture",
        path: setup.project,
        baseRef: "integration-v2",
        mode: "local-only",
        yolo: true,
        model: { providerID: "test", modelID: "test-model" },
      })
      await runtime.request(operator, {
        type: "work.create",
        generation: lead.generation,
        id: `persisted-${terminal}`,
        kind: "ship",
        brief: `Persist ${terminal} delivery`,
      })
      await runtime.reconcile()
      const active = (await status(runtime, `persisted-${terminal}`)).tasks[0]!
      await fs.writeFile(path.join(active.worktree, "RESULT.md"), "Terminal evidence\n")
      git(active.worktree, "add", "RESULT.md")
      git(active.worktree, "commit", "-m", "feat: produce terminal evidence")
      const head = git(active.worktree, "rev-parse", "HEAD")
      await runtime.request(worker(active.sessionID), {
        type: "receipt.propose",
        taskID: active.id,
        operationID: active.obligations[0]!.operationID,
        evidence: {
          kind: "ship",
          head,
          artifact: {
            relativePath: "RESULT.md",
            sha256: createHash("sha256").update("Terminal evidence\n").digest("hex"),
          },
        },
      })
      await runtime.reconcile()
      await runtime.request(operator, { type: "delivery.prepare", taskID: active.id, generation: lead.generation })
      await setup.closeRuntime(runtime)

      const store = SupervisorStore.open(setup.home)
      try {
        const prepared = store.deliveries.get(active.id)!
        expect(store.backlog.get(`persisted-${terminal}`)?.state).toBe("in-flight")
        if (terminal === "landed") {
          git(setup.project, "merge", "--ff-only", head)
          store.deliveries.record({
            ...prepared,
            status: "landed",
            landing: {
              kind: "local",
              sourceHead: prepared.sourceHead!,
              targetHead: prepared.targetHead!,
              mergeCommit: head,
            },
          })
        } else {
          store.deliveries.record({
            ...prepared,
            status: "cancelled",
            cancellation: { source: "operator", at: new Date().toISOString() },
          })
        }
      } finally {
        store.close()
      }

      const resumed = await setup.open()
      await resumed.reconcile()
      const actual = (await resumed.request(operator, { type: "status" })) as {
        backlog: { id: string; state: string; landed?: unknown }[]
      }
      const item = actual.backlog.find((entry) => entry.id === `persisted-${terminal}`)!
      expect(item.state).toBe(terminal === "landed" ? "done" : "cancelled")
      if (terminal === "landed") expect(item.landed).toMatchObject({ mergeCommit: head })
      const settled = item
      await resumed.reconcile()
      const repeated = (await resumed.request(operator, { type: "status" })) as { backlog: typeof actual.backlog }
      expect(repeated.backlog.find((entry) => entry.id === `persisted-${terminal}`)).toEqual(settled)
    } finally {
      await setup.close()
    }
  }
})

test("lead policy changes cannot grant automatic merge or bypass the registered delivery path", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    await runtime.request(operator, {
      type: "project.add",
      generation: lead.generation,
      id: "fixture",
      path: setup.project,
      mode: "no-mistakes",
      yolo: false,
      model: { providerID: "test", modelID: "test-model" },
    })
    const actor = worker(lead.sessionID)
    await expect(
      runtime.request(actor, { type: "project.update", generation: lead.generation, id: "fixture", yolo: true }),
    ).rejects.toThrow("operator")
    await expect(
      runtime.request(actor, {
        type: "work.create",
        generation: lead.generation,
        id: "bypass",
        kind: "ship",
        brief: "Bypass",
        mode: "direct-PR",
      }),
    ).rejects.toThrow("operator")
    await expect(
      runtime.request(actor, {
        type: "work.create",
        generation: lead.generation,
        id: "bypass-auto",
        kind: "ship",
        brief: "Bypass",
        mergePolicy: "auto",
      }),
    ).rejects.toThrow("operator")
    await runtime.request(operator, { type: "project.update", generation: lead.generation, id: "fixture", yolo: true })
    const approved = (await runtime.request(actor, {
      type: "work.create",
      generation: lead.generation,
      id: "approved",
      kind: "ship",
      brief: "Use standing policy",
    })) as { mergePolicy: string; policyProvenance: { source: string } }
    expect(approved.mergePolicy).toBe("auto")
    expect(approved.policyProvenance.source).toBe("registry")
  } finally {
    await setup.close()
  }
})

test("lead operations inherit worker permissions and only the operator can change them", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const actor = worker(lead.sessionID)
    const ask = [{ action: "*", resource: "*", effect: "ask" as const }]
    const allow = [{ action: "*", resource: "*", effect: "allow" as const }]
    await expect(
      runtime.request(actor, {
        type: "project.add",
        generation: lead.generation,
        id: "fixture",
        path: setup.project,
        permissions: allow,
      }),
    ).rejects.toThrow("operator")
    await runtime.request(actor, {
      type: "project.add",
      generation: lead.generation,
      id: "fixture",
      path: setup.project,
      permissions: ask,
      model: { providerID: "test", modelID: "test-model" },
    })
    await expect(
      runtime.request(actor, {
        type: "project.update",
        generation: lead.generation,
        id: "fixture",
        permissions: allow,
      }),
    ).rejects.toThrow("operator")
    await expect(
      runtime.request(actor, {
        type: "work.create",
        generation: lead.generation,
        id: "bypass",
        kind: "ship",
        brief: "Work",
        permissions: allow,
      }),
    ).rejects.toThrow("operator")
    const queued = await runtime.request(actor, {
      type: "work.create",
      generation: lead.generation,
      id: "inherited",
      kind: "ship",
      brief: "Work",
    })
    expect(queued).toMatchObject({ overrides: { permissions: ask } })
    await expect(
      runtime.request(actor, {
        type: "work.update",
        generation: lead.generation,
        id: "inherited",
        permissions: allow,
      }),
    ).rejects.toThrow("operator")
    await expect(
      runtime.request(actor, {
        type: "task.create",
        generation: lead.generation,
        taskID: "legacy-bypass",
        kind: "ship",
        project: setup.project,
        baseRef: "integration-v2",
        brief: "Work",
        model: { providerID: "test", modelID: "test-model" },
        agent: "build",
        permissions: allow,
      }),
    ).rejects.toThrow("operator")
    await runtime.request(operator, {
      type: "project.update",
      generation: lead.generation,
      id: "fixture",
      permissions: allow,
    })
    expect(
      await runtime.request(actor, {
        type: "work.create",
        generation: lead.generation,
        id: "approved-auto",
        kind: "ship",
        brief: "Work",
      }),
    ).toMatchObject({ overrides: { permissions: allow } })
    expect(
      await runtime.request(actor, {
        type: "work.update",
        generation: lead.generation,
        id: "inherited",
        brief: "Still ask",
      }),
    ).toMatchObject({ overrides: { permissions: ask } })
  } finally {
    await setup.close()
  }
})

test("away return evidence scopes handled work to the current absence", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    await runtime.request(operator, {
      type: "project.add",
      generation: lead.generation,
      id: "fixture",
      path: setup.project,
    })
    for (const id of ["old", "current"])
      await runtime.request(operator, {
        type: "work.create",
        generation: lead.generation,
        id,
        kind: "scout",
        brief: "Work",
      })
    await runtime.request(operator, { type: "work.cancel", generation: lead.generation, id: "old" })
    await Bun.sleep(2)
    await runtime.request(operator, {
      type: "away.propose",
      id: "absence",
      words: "Continue the queued work",
      clauses: [{ action: "dispatch", object: "queued work", when: "ready" }],
    })
    await runtime.request(operator, { type: "away.confirm", proposalID: "absence" })
    await runtime.request(operator, { type: "work.cancel", generation: lead.generation, id: "current" })
    const result = (await runtime.request(operator, { type: "away.return.begin" })) as {
      catchup: { evidence: { handled: string[]; cost: string[] } }
    }
    expect(result.catchup.evidence.handled).toEqual(["current: cancelled"])
    expect(result.catchup.evidence.cost[0]).toContain("lifetime verified results")
  } finally {
    await setup.close()
  }
})

test("a known admission remains recorded if lead authority changes while the reply is pending", async () => {
  const setup = await fixture()
  const release = Promise.withResolvers<void>()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation)
    setup.gatePrompt(current.sessionID, release.promise)
    const draining = runtime.reconcile()
    const deadline = Date.now() + 2000
    while (!setup.prompts.length && Date.now() < deadline) await Bun.sleep(5)
    expect(setup.prompts.length).toBe(1)
    await runtime.request(operator, {
      type: "lead.activate",
      sessionID: "other-lead",
      expectedGeneration: lead.generation,
      adoptPending: true,
    })
    release.resolve()
    await draining
    const result = (await status(runtime, current.id)).tasks[0]!
    expect(result.admissionUncertain).toBe(false)
    expect(result.obligations[0]?.delivered).toBe(true)
    await runtime.reconcile()
    expect(setup.prompts.length).toBe(1)
  } finally {
    release.resolve()
    await setup.close()
  }
})

test("a burst of 1000 distinct obligations is durable and duplicate IDs keep the first text", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    await create(runtime, setup.project, lead.generation)
    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        runtime.request(operator, {
          type: "task.send",
          generation: lead.generation,
          taskID: "task",
          operationID: `msg_${index}`,
          text: `first-${index}`,
          delivery: "queue",
        }),
      ),
    )
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        runtime.request(operator, {
          type: "task.send",
          generation: lead.generation,
          taskID: "task",
          operationID: `msg_${index}`,
          text: `later-${index}`,
          delivery: "steer",
        }),
      ),
    )
    const before = await status(runtime, "task")
    expect(before.tasks[0]?.obligations).toHaveLength(1001)
    expect(before.tasks[0]?.obligations[1]?.payload).toEqual({ text: "first-0", delivery: "queue" })
    await setup.closeRuntime(runtime)
    const reopened = await setup.open()
    const after = await status(reopened, "task")
    expect(after.tasks[0]?.obligations).toEqual(before.tasks[0]?.obligations)
  } finally {
    await setup.close()
  }
})

test("transfer fences the prior lead and two homes keep the same task ID separate", async () => {
  const setup = await fixture()
  try {
    const first = await setup.open()
    const lead = await activate(first)
    const taskA = await create(first, setup.project, lead.generation)
    const next = (await first.request(operator, {
      type: "lead.activate",
      sessionID: "other-lead",
      expectedGeneration: lead.generation,
    })) as SupervisorStore.Lead
    await expect(
      first.request(worker("lead"), {
        type: "task.send",
        generation: lead.generation,
        taskID: "task",
        operationID: "msg_old",
        text: "old",
        delivery: "queue",
      }),
    ).rejects.toThrow()
    await expect(
      first.request(operator, {
        type: "task.send",
        generation: lead.generation,
        taskID: "task",
        operationID: "msg_old",
        text: "old",
        delivery: "queue",
      }),
    ).rejects.toThrow()
    await first.request(operator, {
      type: "task.send",
      generation: next.generation,
      taskID: "task",
      operationID: "msg_new",
      text: "new",
      delivery: "queue",
    })

    const anotherHome = path.join(setup.root, "another-home")
    await fs.mkdir(anotherHome)
    const second = await setup.open(anotherHome)
    const otherLead = await activate(second)
    const taskB = await create(second, setup.project, otherLead.generation)
    expect(taskB.sessionID).not.toBe(taskA.sessionID)
    expect(taskB.worktree).not.toBe(taskA.worktree)
    expect((await status(second, "task")).tasks[0]?.obligations).toHaveLength(1)
    expect((await status(first, "task")).tasks[0]?.obligations).toHaveLength(2)
  } finally {
    await setup.close()
  }
})

test("worker receipt and decision calls stay within their assigned native session", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation)
    await runtime.reconcile()
    expect(setup.prompts).toHaveLength(1)
    expect((await status(runtime, "task")).tasks[0]?.native).toMatchObject({
      state: "idle",
      pending: 0,
      permissions: 0,
    })
    setup.running.add(current.sessionID)
    setup.permissionRequests.set(current.sessionID, [
      { id: "perm_1", sessionID: current.sessionID, action: "shell", resources: ["*"] },
    ])
    expect((await status(runtime, "task")).tasks[0]?.native).toMatchObject({
      state: "running",
      pending: 0,
      permissions: 1,
    })
    setup.running.delete(current.sessionID)
    await expect(
      runtime.request(worker("another-worker"), {
        type: "decision.open",
        taskID: "task",
        id: "review",
        question: "Proceed?",
      }),
    ).rejects.toThrow()
    await runtime.request(worker(current.sessionID), {
      type: "decision.open",
      taskID: "task",
      id: "review",
      question: "Proceed?",
    })
    expect((await status(runtime, "task")).tasks[0]?.decisions).toHaveLength(1)
    await expect(
      runtime.request(operator, {
        type: "task.cleanup",
        generation: lead.generation,
        taskID: "task",
        landingRef: "integration-v2",
      }),
    ).rejects.toThrow()
    expect((await status(runtime, "task")).tasks[0]?.cleanup).toBeUndefined()
  } finally {
    await setup.close()
  }
})

test("an unknown prompt admission blocks cancellation settlement without later replay", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation)
    setup.failNextPrompt()
    await runtime.reconcile()
    expect(setup.prompts).toHaveLength(1)
    expect(setup.pending.get(current.sessionID)).toHaveLength(1)
    await runtime.request(operator, { type: "task.cancel", generation: lead.generation, taskID: "task" })
    await runtime.reconcile()
    expect(setup.cancelled).toHaveLength(1)
    expect(setup.pending.get(current.sessionID)).toEqual([])
    expect((await status(runtime, "task")).tasks[0]?.status).toBe("cancelling")
    expect((await status(runtime, "task")).tasks[0]?.admissionUncertain).toBe(true)
    await runtime.reconcile()
    expect(setup.prompts).toHaveLength(1)
  } finally {
    await setup.close()
  }
})

test("artifact mutation after a provisional receipt prevents settlement", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation)
    await runtime.reconcile()
    const artifact = path.join(current.worktree, "result.txt")
    await fs.writeFile(artifact, "verified bytes\n")
    git(current.worktree, "add", "result.txt")
    git(
      current.worktree,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "feat: result",
    )
    const evidence = {
      kind: "ship" as const,
      artifact: { relativePath: "result.txt", sha256: createHash("sha256").update("verified bytes\n").digest("hex") },
      head: git(current.worktree, "rev-parse", "HEAD"),
    }
    await expect(
      runtime.request(worker("another-worker"), {
        type: "receipt.propose",
        taskID: "task",
        operationID: setup.prompts[0]!,
        evidence,
      }),
    ).rejects.toThrow()
    await runtime.request(worker(current.sessionID), {
      type: "receipt.propose",
      taskID: "task",
      operationID: setup.prompts[0]!,
      evidence,
    })
    await fs.writeFile(artifact, "changed bytes\n")
    await runtime.reconcile()
    const currentStatus = (await status(runtime, "task")).tasks[0]
    expect(currentStatus?.receipts).toEqual([])
    expect(currentStatus?.obligations[0]?.state).toBe("open")
    expect(currentStatus?.error).toMatch(/changed|hash|dirty/i)
    await expect(
      runtime.request(operator, { type: "task.complete", generation: lead.generation, taskID: "task" }),
    ).rejects.toThrow()
    await fs.writeFile(artifact, "corrected bytes\n")
    git(current.worktree, "add", "result.txt")
    git(
      current.worktree,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "fix: correct result",
    )
    await runtime.request(worker(current.sessionID), {
      type: "receipt.propose",
      taskID: "task",
      operationID: setup.prompts[0]!,
      evidence: {
        kind: "ship",
        artifact: {
          relativePath: "result.txt",
          sha256: createHash("sha256").update("corrected bytes\n").digest("hex"),
        },
        head: git(current.worktree, "rev-parse", "HEAD"),
      },
    })
    await runtime.reconcile()
    expect((await status(runtime, "task")).tasks[0]?.receipts).toHaveLength(1)
    expect((await status(runtime, "task")).tasks[0]?.obligations[0]?.state).toBe("settled")
  } finally {
    await setup.close()
  }
})

test("status delivery refresh cannot overtake an in-flight reconciliation cursor", async () => {
  const setup = await fixture()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation)
    await runtime.reconcile()
    await runtime.request(operator, {
      type: "task.send",
      generation: lead.generation,
      taskID: current.id,
      operationID: "msg_next",
      text: "Continue the work",
      delivery: "queue",
    })
    setup.gateLog(current.sessionID, started.resolve, release.promise)
    const draining = runtime.reconcile()
    await started.promise
    setup.appendDelivery(current.sessionID, "synthetic-foreign")
    const snapshot = (await runtime.request(operator, { type: "status" })) as Awaited<ReturnType<typeof status>>
    expect(snapshot.tasks[0]?.obligations.find((item) => item.operationID === "msg_next")?.delivered).toBe(true)
    release.resolve()
    await draining
    const observed = (await status(runtime, current.id)).tasks[0]
    expect(observed?.error).toBeUndefined()
    expect(observed?.cursor).toBe(2)
    await runtime.reconcile()
    expect((await status(runtime, current.id)).tasks[0]?.cursor).toBe(3)
    expect(setup.prompts).toHaveLength(2)
  } finally {
    release.resolve()
    await setup.close()
  }
})

test("foreign native inbox deliveries advance the cursor without changing owned obligations", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation)
    await runtime.reconcile()
    expect((await status(runtime, "task")).tasks[0]?.cursor).toBe(1)
    setup.appendDelivery(current.sessionID, "synthetic-foreign")
    await runtime.reconcile()
    const observed = (await status(runtime, "task")).tasks[0]
    expect(observed?.cursor).toBe(2)
    expect(observed?.obligations).toHaveLength(1)
    expect(observed?.obligations[0]?.delivered).toBe(true)
    expect(observed?.error).toBeUndefined()
  } finally {
    await setup.close()
  }
})

test("a newer failed native outcome cannot finalize a provisional receipt", async () => {
  const setup = await fixture()
  try {
    const runtime = await setup.open()
    const lead = await activate(runtime)
    const current = await create(runtime, setup.project, lead.generation)
    await runtime.reconcile()
    await fs.writeFile(path.join(current.worktree, "result.txt"), "verified bytes\n")
    git(current.worktree, "add", "result.txt")
    git(
      current.worktree,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "feat: result",
    )
    await runtime.request(worker(current.sessionID), {
      type: "receipt.propose",
      taskID: "task",
      operationID: setup.prompts[0]!,
      evidence: {
        kind: "ship",
        artifact: { relativePath: "result.txt", sha256: createHash("sha256").update("verified bytes\n").digest("hex") },
        head: git(current.worktree, "rev-parse", "HEAD"),
      },
    })
    setup.setGetOutcomes(current.sessionID, "succeeded", "failed")
    await runtime.reconcile()
    const observed = (await status(runtime, "task")).tasks[0]
    expect(observed?.receipts).toEqual([])
    expect(observed?.obligations[0]?.state).toBe("open")
    expect(observed?.error).toMatch(/not completed successfully/)
  } finally {
    await setup.close()
  }
})
