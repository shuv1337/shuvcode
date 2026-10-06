import { expect, test } from "bun:test"
import { SupervisorNative } from "../src/supervisor/native"
import { SupervisorManaged } from "../src/supervisor/managed"
import { SupervisorSettings } from "../src/supervisor/settings"
import { managedEval } from "./fixtures/supervisor-managed-eval"

test("managed CLI delegates through a local Responses model and wakes the lead with a verified result", async () => {
  await using fixture = await managedEval()
  try {
    const up = await fixture.cli([
      "up",
      "--home",
      fixture.home,
      "--project",
      fixture.project,
      "--model",
      "test/test-model",
      "--provider-url",
      fixture.providerURL,
      "--auto",
    ])
    if (up.code !== 0) throw new Error(`Managed up failed: ${up.stderr}`)
    const initial = await status(fixture)
    expect(initial.lead?.active).toBe(true)
    const sent = await fixture.cli(["send", "Build managed-fixture", "--home", fixture.home])
    if (sent.code !== 0) throw new Error(`Lead send failed: ${sent.stderr}`)

    const completed = await until(async () => {
      const current = await status(fixture)
      const task = current.tasks.find((item) => item.id === "managed-fixture")
      if (!task?.receipts.length) return undefined
      return { current, task }
    }, 25_000).catch(async (error) => {
      const current = await status(fixture)
      const task = current.tasks.find((item) => item.id === "managed-fixture")
      throw new Error(
        `Managed flow did not verify a result: ${JSON.stringify({ task: task?.status, error: task?.error, requests: fixture.requests.length })}`,
        { cause: error },
      )
    })
    expect(completed.task.kind).toBe("ship")
    expect(completed.task.model).toMatchObject({ providerID: "test", modelID: "test-model" })
    expect(completed.task.receipts[0]?.evidence.artifact.relativePath).toBe("RESULT.md")
    expect(Buffer.from(completed.task.receipts[0]!.evidence.artifact.contentBase64, "base64").toString()).toBe(
      "Managed worker result\n",
    )
    expect(completed.task.receipts[0]?.evidence.head).toBe(await head(completed.task.worktree))

    const settings = await SupervisorSettings.read(fixture.home)
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    const leadID = initial.lead!.sessionID
    const wake = await until(async () => {
      const messages = (await native.messages(leadID)).data
      return messages.some(
        (message) =>
          message.type === "assistant" &&
          message.content.some((part) => part.type === "text" && part.text.includes("Verified worker result received")),
      )
        ? messages
        : undefined
    }, 15_000)
    expect(
      wake.some((message) => message.type === "user" && message.text.includes("Supervisor verified ship result")),
    ).toBe(true)
    expect(fixture.requests.some((request) => request.tools?.some((tool) => tool.name === "supervisor_task"))).toBe(
      true,
    )
    expect(fixture.requests.some((request) => request.tools?.some((tool) => tool.name === "supervisor_result"))).toBe(
      true,
    )
  } finally {
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 60_000)

test("worker decision can be answered through the managed CLI and resumes the worker", async () => {
  await using fixture = await managedEval("decision")
  try {
    const up = await fixture.cli([
      "up",
      "--home",
      fixture.home,
      "--project",
      fixture.project,
      "--model",
      "test/test-model",
      "--provider-url",
      fixture.providerURL,
      "--auto",
    ])
    if (up.code !== 0) throw new Error(up.stderr)
    const sent = await fixture.cli(["send", "Build managed-fixture", "--home", fixture.home])
    if (sent.code !== 0) throw new Error(sent.stderr)
    const pending = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find(
        (task) => task.id === "managed-fixture" && task.decisions.some((item) => item.id === "scope"),
      )
    }, 20_000)
    expect(pending.decisions.find((item) => item.id === "scope")?.resolution).toBeUndefined()
    const answered = await fixture.cli(["answer", "managed-fixture", "scope", "Proceed", "--home", fixture.home])
    if (answered.code !== 0) throw new Error(`Decision answer failed: ${answered.stderr}`)
    await fixture.resultRequested
    const queued = await fixture.cli([
      "steer",
      "managed-fixture",
      "Queued follow-up",
      "--queue",
      "--home",
      fixture.home,
    ])
    if (queued.code !== 0) throw new Error(`Queue failed: ${queued.stderr}`)
    const beforeResult = (await status(fixture)).tasks.find((item) => item.id === "managed-fixture")!
    const unseen = beforeResult.obligations.find((item) => item.payload.text === "Queued follow-up")
    expect(unseen?.delivered).toBe(false)
    fixture.releaseResult()
    const verified = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.id === "managed-fixture" && task.receipts.length === 2)
    }, 5_000).catch(async (error) => {
      const current = await status(fixture)
      const settings = await SupervisorSettings.read(fixture.home)
      const native = SupervisorNative.connect({
        url: settings.endpoint,
        password: await SupervisorSettings.password(settings),
      })
      const task = current.tasks.find((item) => item.id === "managed-fixture")
      const messages = task ? (await native.messages(task.sessionID)).data : []
      const toolErrors = messages.flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) =>
              part.type === "tool" && part.state.status === "error"
                ? [{ name: part.name, error: part.state.error }]
                : [],
            )
          : [],
      )
      throw new Error(
        `Decision did not resume: ${JSON.stringify({ task: task?.status, error: task?.error, receipts: task?.receipts.length, obligations: task?.obligations.map((item) => ({ id: item.operationID, delivered: item.delivered })), toolErrors, requests: fixture.requests.length })}`,
        { cause: error },
      )
    })
    expect(verified.decisions.find((item) => item.id === "scope")?.resolution).toMatchObject({
      answer: "Proceed",
      answeredBy: "user",
      generation: 1,
    })
    expect(verified.receipts.every((item) => item.evidence.artifact.relativePath === "RESULT.md")).toBe(true)
    expect(verified.receipts.some((item) => item.operationID === unseen?.operationID)).toBe(false)
    const workerRequests = fixture.requests.filter((request) =>
      JSON.stringify(request.input ?? []).includes("Supervisor task: managed-fixture"),
    )
    expect(workerRequests.length).toBeGreaterThan(0)
    expect(workerRequests.every((request) => request.tools?.some((tool) => tool.name === "supervisor_decision"))).toBe(
      true,
    )
    expect(workerRequests.every((request) => !request.tools?.some((tool) => tool.name === "question"))).toBe(true)
  } finally {
    fixture.releaseResult()
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 60_000)

test("default ask permissions can be approved for a managed worker through the CLI", async () => {
  await using fixture = await managedEval("permission")
  try {
    const up = await fixture.cli([
      "up",
      "--home",
      fixture.home,
      "--project",
      fixture.project,
      "--model",
      "test/test-model",
      "--provider-url",
      fixture.providerURL,
    ])
    if (up.code !== 0) throw new Error(up.stderr)
    const created = await fixture.cli([
      "task",
      "Build and commit RESULT.md with the managed worker finding",
      "--name",
      "managed-fixture",
      "--home",
      fixture.home,
    ])
    if (created.code !== 0) throw new Error(`Task creation failed: ${created.stderr}`)
    const approved = new Set<string>()
    const actions = new Set<string>()
    const verified = await until(async () => {
      const current = await status(fixture)
      const task = current.tasks.find((item) => item.id === "managed-fixture")
      for (const request of task?.native?.permissionRequests ?? []) {
        if (approved.has(request.id)) continue
        const result = await fixture.cli(["approve", task!.id, request.id, "--home", fixture.home])
        if (result.code !== 0) throw new Error(`Permission approval failed: ${result.stderr}`)
        approved.add(request.id)
        actions.add(request.action)
      }
      return task?.receipts.length ? task : undefined
    }, 25_000)
    expect(approved.size).toBeGreaterThan(0)
    expect(actions.has("shell")).toBe(true)
    expect(verified.receipts[0]?.evidence.artifact.relativePath).toBe("RESULT.md")
  } finally {
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 60_000)

test("default ask permissions can be approved for the managed lead without a worker", async () => {
  await using fixture = await managedEval("lead-permission")
  try {
    const up = await fixture.cli([
      "up",
      "--home",
      fixture.home,
      "--project",
      fixture.project,
      "--model",
      "test/test-model",
      "--provider-url",
      fixture.providerURL,
    ])
    if (up.code !== 0) throw new Error(up.stderr)
    const sent = await fixture.cli(["send", "Run lead shell check", "--home", fixture.home])
    if (sent.code !== 0) throw new Error(sent.stderr)
    const pending = await until(async () => {
      const current = await status(fixture)
      return current.leadState === "permission" && current.leadPermissions.length
        ? current.leadPermissions.find((request) => request.action === "shell")
        : undefined
    }, 20_000)
    const approved = await fixture.cli(["approve", "lead", pending.id, "--home", fixture.home])
    if (approved.code !== 0) throw new Error(approved.stderr)
    const settings = await SupervisorSettings.read(fixture.home)
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    await until(async () => {
      const current = await status(fixture)
      const messages = current.lead
        ? (await native.messages(current.lead.sessionID, { type: "assistant", order: "desc", limit: 1 })).data
        : []
      return messages.some(
        (message) =>
          message.type === "assistant" &&
          message.content.some((part) => part.type === "text" && part.text.includes("Lead shell check finished")),
      )
        ? true
        : undefined
    }, 20_000)
    expect((await status(fixture)).tasks).toEqual([])
  } finally {
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 60_000)

test("managed cancellation settles a permission-blocked worker and stays settled after recovery", async () => {
  await using fixture = await managedEval("permission")
  try {
    const up = await fixture.cli([
      "up",
      "--home",
      fixture.home,
      "--project",
      fixture.project,
      "--model",
      "test/test-model",
      "--provider-url",
      fixture.providerURL,
    ])
    if (up.code !== 0) throw new Error(up.stderr)
    const created = await fixture.cli([
      "task",
      "Build and commit RESULT.md with the managed worker finding",
      "--name",
      "managed-fixture",
      "--home",
      fixture.home,
    ])
    if (created.code !== 0) throw new Error(created.stderr)
    await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.id === "managed-fixture" && (task.native?.permissions ?? 0) > 0)
    }, 20_000)
    const cancelled = await fixture.cli(["cancel", "managed-fixture", "--home", fixture.home])
    if (cancelled.code !== 0) throw new Error(`Cancel failed: ${cancelled.stderr}`)
    const settled = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.id === "managed-fixture" && task.status === "cancelled")
    }, 20_000)
    expect(settled.receipts).toEqual([])
    const workerRequests = fixture.requests.filter((request) =>
      JSON.stringify(request.input).includes("Supervisor task: managed-fixture"),
    ).length
    const recovery = await fixture.cli(["recover", "managed-fixture", "--home", fixture.home], 50_000)
    if (recovery.code !== 0) throw new Error(`Recover failed: ${recovery.stderr}`)
    const after = (await status(fixture)).tasks.find((task) => task.id === "managed-fixture")
    expect(after?.status).toBe("cancelled")
    expect(after?.receipts).toEqual([])
    expect(
      fixture.requests.filter((request) => JSON.stringify(request.input).includes("Supervisor task: managed-fixture"))
        .length,
    ).toBe(workerRequests)
  } finally {
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 70_000)

test("manager death preserves a held backlog item, an answered decision, and active execution", async () => {
  await using fixture = await managedEval("decision")
  try {
    for (const args of [
      [
        "up",
        "--project",
        fixture.project,
        "--model",
        "test/test-model",
        "--provider-url",
        fixture.providerURL,
        "--auto",
      ],
      ["send", "Build managed-fixture"],
    ]) {
      const result = await fixture.cli([...args, "--home", fixture.home])
      if (result.code) throw new Error(result.stderr)
    }
    const initial = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.decisions.some((decision) => decision.id === "scope"))
        ? current
        : undefined
    }, 20_000)
    const held = await fixture.cli([
      "task",
      "Remain held across restart",
      "--name",
      "held-fixture",
      "--kind",
      "scout",
      "--hold",
      "operator-release",
      "--home",
      fixture.home,
    ])
    if (held.code) throw new Error(held.stderr)
    const answer = await fixture.cli(["answer", "managed-fixture", "scope", "Proceed", "--home", fixture.home])
    if (answer.code) throw new Error(answer.stderr)
    await Promise.race([
      fixture.resultRequested,
      Bun.sleep(15_000).then(() => {
        throw new Error("Worker did not reach the gated model request")
      }),
    ])
    const before = (await status(fixture)).tasks.find((task) => task.id === "managed-fixture")!
    expect(before.native?.state).toBe("running")
    expect(before.receipts).toEqual([])
    const settings = await SupervisorSettings.read(fixture.home)
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    const inboxBefore = (await native.log({ sessionID: before.sessionID })).events.filter(
      (event) => event.name === "session.inbox.enqueued",
    )
    const first = await SupervisorManaged.owner(fixture.home)
    if (!first || !(await SupervisorManaged.running(first.owner))) throw new Error("Owner exited before the crash test")
    process.kill(first.owner.pid, "SIGKILL")
    await until(async () => !(await SupervisorManaged.running(first.owner)) || undefined, 10_000)
    const start = await fixture.cli(["start", "--home", fixture.home], 50_000)
    if (start.code) throw new Error(start.stderr)
    const second = await SupervisorManaged.owner(fixture.home)
    expect(second?.epoch).toBe(first.epoch + 1)
    expect(second?.native).not.toEqual(first.native)
    expect(await SupervisorManaged.running(first.native!)).toBe(false)
    fixture.releaseResult()
    const after = await until(async () => {
      const current = await status(fixture)
      const task = current.tasks.find((item) => item.id === before.id)
      return task?.receipts.length === before.obligations.length && task.native?.state === "idle"
        ? { current, task }
        : undefined
    }, 25_000).catch(async (error) => {
      const current = (await status(fixture)).tasks.find((item) => item.id === before.id)
      throw new Error(
        `Worker did not recover after manager death: ${JSON.stringify({ state: current?.native?.state, status: current?.status, error: current?.error, receipts: current?.receipts.length, expectedReceipts: before.obligations.length, requests: fixture.requests.length })}`,
        { cause: error },
      )
    })
    expect(after.current.lead).toEqual(initial.lead)
    expect(after.current.backlog?.find((item) => item.id === "held-fixture")).toMatchObject({
      state: "queued",
      hold: { reason: "operator-release" },
    })
    expect(after.current.tasks.some((task) => task.id === "held-fixture")).toBe(false)
    expect(after.task.decisions).toMatchObject([{ id: "scope", resolution: { answer: "Proceed" } }])
    expect(after.task.obligations.map((item) => item.operationID)).toEqual(
      before.obligations.map((item) => item.operationID),
    )
    expect(
      (await native.log({ sessionID: before.sessionID })).events.filter(
        (event) => event.name === "session.inbox.enqueued",
      ),
    ).toEqual(inboxBefore)
    const commits = Bun.spawnSync(["git", "-C", after.task.worktree, "rev-list", "--count", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(commits.exitCode).toBe(0)
    expect(new TextDecoder().decode(commits.stdout).trim()).toBe("2")
  } finally {
    fixture.releaseResult()
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 90_000)

type Fixture = Awaited<ReturnType<typeof managedEval>>
type Status = {
  lead?: { sessionID: string; generation: number; active: boolean }
  leadState?: string
  leadPermissions: Array<{ id: string; action: string }>
  backlog?: Array<{ id: string; state: string; hold?: { reason: string } }>
  tasks: Array<{
    id: string
    sessionID: string
    kind: string
    status: string
    error?: string
    worktree: string
    model: { providerID: string; modelID: string }
    receipts: Array<{
      operationID: string
      evidence: { artifact: { relativePath: string; contentBase64: string }; head: string }
    }>
    decisions: Array<{ id: string; resolution?: { answer: string } }>
    obligations: Array<{ operationID: string; payload: { text: string }; delivered: boolean }>
    native?: {
      state: string
      pending: number
      permissions: number
      permissionRequests: Array<{ id: string; action: string }>
    }
  }>
}

async function status(fixture: Fixture) {
  const result = await fixture.cli(["status", "--home", fixture.home, "--json"])
  if (result.code !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout) as Status
}

async function until<T>(probe: () => Promise<T | undefined>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result !== undefined) return result
    await Bun.sleep(100)
  }
  throw new Error("Timed out waiting for managed model workflow")
}

async function head(worktree: string) {
  const child = Bun.spawn(["git", "-C", worktree, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(stderr)
  return stdout.trim()
}
