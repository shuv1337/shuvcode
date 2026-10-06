import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorManaged } from "../src/supervisor/managed"
import { SupervisorNative } from "../src/supervisor/native"
import { SupervisorSettings } from "../src/supervisor/settings"
import { SupervisorWorktree } from "../src/supervisor/worktree"
import { managedEval } from "./fixtures/supervisor-managed-eval"

test("real managed prompt timeout remains fenced through cancellation and recovery", async () => {
  await using fixture = await managedEval()
  const gate = path.join(fixture.home, "admission-gate")
  try {
    await success(
      fixture.cli([
        "init",
        "--home",
        fixture.home,
        "--project",
        fixture.project,
        "--model",
        "test/test-model",
        "--provider-url",
        fixture.providerURL,
        "--auto",
      ]),
    )
    await mkdir(gate)
    const plugins = path.join(fixture.home, "config", "plugins")
    await mkdir(plugins)
    await writeFile(
      path.join(plugins, "admission.ts"),
      `export { default } from ${JSON.stringify(path.join(import.meta.dir, "fixtures", "supervisor-admission-plugin.ts"))}\n`,
    )
    await success(fixture.cli(["start", "--home", fixture.home]))
    const settings = await SupervisorSettings.read(fixture.home)
    const originalOwner = await SupervisorManaged.owner(fixture.home)
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    await native.pluginReady(fixture.project, "supervisor-admission-barrier")

    await success(
      fixture.cli([
        "task",
        "Produce an admission timeout fixture",
        "--name",
        "admission-fixture",
        "--mode",
        "local-only",
        "--merge",
        "manual",
        "--home",
        fixture.home,
      ]),
    )
    const entered = await until(async () => {
      if (!(await Bun.file(path.join(gate, "entered.json")).exists())) return undefined
      return (await Bun.file(path.join(gate, "entered.json")).json()) as { sessionID: string; messageID: string }
    }, 15_000)
    const worker = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.id === "admission-fixture")
    }, 5_000)
    expect(entered.sessionID).toBe(worker.sessionID)
    expect(worker.obligations.some((item) => item.operationID === entered.messageID)).toBe(true)
    expect((await native.inbox(worker.sessionID)).some((item) => item.id === entered.messageID)).toBe(false)

    const uncertain = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.id === "admission-fixture" && task.admissionUncertain)
    }, 25_000)
    expect(uncertain.status).toBe("active")
    expect(uncertain.receipts).toEqual([])
    expect(
      (
        await db(fixture.home, "SELECT attempted, attempt_epoch, state FROM outbox WHERE task_id = 'admission-fixture'")
      )[0],
    ).toMatchObject({ attempted: 1, attempt_epoch: originalOwner!.epoch, state: "pending" })

    await success(fixture.cli(["cancel", "admission-fixture", "--home", fixture.home]))
    const cancelling = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.id === "admission-fixture" && task.status === "cancelling")
    }, 5_000)
    expect(cancelling.admissionUncertain).toBe(true)
    expect(cancelling.obligations.every((item) => item.state === "cancelled")).toBe(true)
    expect((await fixture.cli(["complete", "admission-fixture", "--home", fixture.home])).code).not.toBe(0)
    const refusedCleanup = await fixture.cli([
      "cleanup",
      "admission-fixture",
      "--landed",
      "integration-v2",
      "--home",
      fixture.home,
    ])
    expect(refusedCleanup.code).not.toBe(0)
    expect(refusedCleanup.stderr).toMatch(/admission|uncertain/i)

    await writeFile(path.join(gate, "release"), "go")
    await until(async () => ((await Bun.file(path.join(gate, "released")).exists()) ? true : undefined), 5_000)
    await Bun.sleep(500)
    // This abort cancelled preparation in the observed native handler. Keep the
    // supervisor uncertain anyway: a lost response after commit remains possible.
    expect(
      (await native.log({ sessionID: worker.sessionID })).events.some(
        (event) =>
          event.name === "session.inbox.enqueued" && (event.data as { inboxID?: string }).inboxID === entered.messageID,
      ),
    ).toBe(false)
    const beforeRecovery = (await status(fixture)).tasks.find((task) => task.id === "admission-fixture")!
    expect(beforeRecovery.status).toBe("cancelling")
    expect(beforeRecovery.admissionUncertain).toBe(true)
    expect(beforeRecovery.receipts).toEqual([])
    const modelCalls = fixture.requests.filter((request) =>
      JSON.stringify(request.input).includes("Supervisor task: admission-fixture"),
    ).length

    await success(fixture.cli(["recover", "admission-fixture", "--home", fixture.home], 50_000))
    const nextOwner = await SupervisorManaged.owner(fixture.home)
    expect(nextOwner?.epoch).toBe(originalOwner!.epoch + 1)
    const settled = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.id === "admission-fixture" && task.status === "cancelled")
    }, 15_000)
    expect(settled.admissionUncertain).toBe(false)
    expect(settled.receipts).toEqual([])
    expect(settled.obligations.every((item) => item.state === "cancelled")).toBe(true)
    expect((await native.inbox(worker.sessionID)).some((item) => item.id === entered.messageID)).toBe(false)
    const rows = await db(
      fixture.home,
      "SELECT status, admission_uncertain, uncertainty_epoch FROM task WHERE id = 'admission-fixture'",
    )
    expect(rows[0]).toMatchObject({ status: "cancelled", admission_uncertain: 0, uncertainty_epoch: null })
    expect(
      (await db(fixture.home, "SELECT state, attempted FROM outbox WHERE task_id = 'admission-fixture'"))[0],
    ).toMatchObject({ state: "cancelled", attempted: 0 })
    expect(
      (await db(fixture.home, "SELECT from_epoch, to_epoch FROM recovery_audit ORDER BY id DESC LIMIT 1"))[0],
    ).toMatchObject({ from_epoch: originalOwner!.epoch, to_epoch: nextOwner!.epoch })
    await Bun.sleep(500)
    expect(
      fixture.requests.filter((request) => JSON.stringify(request.input).includes("Supervisor task: admission-fixture"))
        .length,
    ).toBe(modelCalls)
    await success(fixture.cli(["cleanup", "admission-fixture", "--landed", "integration-v2", "--home", fixture.home]))
    expect(await Bun.file(path.join(worker.worktree, ".git")).exists()).toBe(false)
  } finally {
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 100_000)

test("real native HTTP can admit after a client timeout when the transport keeps the request alive", async () => {
  await using fixture = await managedEval()
  const gate = path.join(fixture.home, "admission-gate")
  try {
    await success(
      fixture.cli([
        "init",
        "--home",
        fixture.home,
        "--project",
        fixture.project,
        "--model",
        "test/test-model",
        "--provider-url",
        fixture.providerURL,
        "--auto",
      ]),
    )
    await mkdir(gate)
    const plugins = path.join(fixture.home, "config", "plugins")
    await mkdir(plugins)
    await writeFile(
      path.join(plugins, "admission.ts"),
      `export { default } from ${JSON.stringify(path.join(import.meta.dir, "fixtures", "supervisor-admission-plugin.ts"))}\n`,
    )
    await success(fixture.cli(["start", "--home", fixture.home]))
    const settings = await SupervisorSettings.read(fixture.home)
    const password = await SupervisorSettings.password(settings)
    const native = SupervisorNative.connect({ url: settings.endpoint, password })
    const task = await SupervisorWorktree.propose({
      home: fixture.home,
      taskID: "admission-fixture",
      project: fixture.project,
      baseRef: "integration-v2",
    })
    await SupervisorWorktree.create(task)
    const sessionID = "ses_supervisor_late_transport"
    const messageID = "msg_supervisor_late_transport"
    await native.create({
      sessionID,
      directory: task.worktree,
      agent: "build",
      model: { providerID: "test", id: "test-model" },
      permissions: [],
    })
    await native.pluginReady(task.worktree, "supervisor-admission-barrier")

    const releaseResponse = Promise.withResolvers<void>()
    const upstreamFinished = Promise.withResolvers<void>()
    const keepaliveFetch: typeof fetch = Object.assign(
      (input: URL | RequestInfo, init?: RequestInit) => {
        const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
        const forwarded = new Request(input, { ...init, signal: new AbortController().signal })
        const upstream = fetch(forwarded).then(async (response) => {
          upstreamFinished.resolve()
          await releaseResponse.promise
          return response
        })
        upstream.catch(() => undefined)
        const aborted = new Promise<never>((_resolve, reject) => {
          if (originalSignal?.aborted) return reject(originalSignal.reason)
          originalSignal?.addEventListener("abort", () => reject(originalSignal.reason), { once: true })
        })
        return Promise.race([upstream, aborted])
      },
      { preconnect: fetch.preconnect },
    )
    const lossy = SupervisorNative.connect({ url: settings.endpoint, password, fetch: keepaliveFetch, timeoutMs: 500 })
    const admission = lossy.prompt({
      sessionID,
      id: messageID,
      text: "Supervisor task: admission-fixture",
      delivery: "queue",
      resume: false,
    })
    const entered = await until(async () => {
      if (!(await Bun.file(path.join(gate, "entered.json")).exists())) return undefined
      return (await Bun.file(path.join(gate, "entered.json")).json()) as { sessionID: string; messageID: string }
    }, 5_000)
    expect(entered).toEqual({ sessionID, messageID })
    await expect(admission).rejects.toBeInstanceOf(SupervisorNative.AdmissionOutcomeUnknownError)
    expect(await native.inbox(sessionID)).toEqual([])
    await writeFile(path.join(gate, "release"), "go")
    await until(async () => ((await Bun.file(path.join(gate, "released")).exists()) ? true : undefined), 5_000)
    await upstreamFinished.promise
    const late = await until(
      async () =>
        (await native.log({ sessionID })).events.find(
          (event) =>
            event.name === "session.inbox.enqueued" && (event.data as { inboxID?: string }).inboxID === messageID,
        ),
      5_000,
    )
    expect(late.name).toBe("session.inbox.enqueued")
    expect(await native.inbox(sessionID)).toEqual([
      { id: messageID, type: "user", delivery: "queue", text: "Supervisor task: admission-fixture" },
    ])
    await native.cancel({ sessionID, inboxID: messageID })
    expect(await native.inbox(sessionID)).toEqual([])
    releaseResponse.resolve()
  } finally {
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 50_000)

type Fixture = Awaited<ReturnType<typeof managedEval>>
type Task = {
  id: string
  sessionID: string
  worktree: string
  status: string
  admissionUncertain: boolean
  receipts: unknown[]
  obligations: Array<{ operationID: string; state: string }>
}

async function status(fixture: Fixture) {
  const result = await fixture.cli(["status", "--home", fixture.home, "--json"])
  if (result.code !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout) as { tasks: Task[] }
}

async function success(result: Promise<{ code: number; stdout: string; stderr: string }>) {
  const value = await result
  if (value.code !== 0) throw new Error(value.stderr)
  return value
}

async function until<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result !== undefined) return result
    await Bun.sleep(100)
  }
  throw new Error("Timed out waiting for native admission evidence")
}

async function db(home: string, query: string) {
  const database = new DatabaseSync(path.join(home, "supervisor.sqlite"), { readOnly: true })
  try {
    return database.prepare(query).all() as Record<string, unknown>[]
  } finally {
    database.close()
  }
}
