import { expect, test } from "bun:test"
import { SupervisorManaged } from "../src/supervisor/managed"
import { SupervisorNative } from "../src/supervisor/native"
import { SupervisorSettings } from "../src/supervisor/settings"
import { SupervisorStore } from "../src/supervisor/store"
import { managedEval } from "./fixtures/supervisor-managed-eval"

test("managed recovery never resumes a worker whose cancellation was durable before native interruption", async () => {
  await using fixture = await managedEval("decision")
  const calls = () =>
    fixture.requests.filter((request) => JSON.stringify(request.input).includes("Supervisor task: managed-fixture"))
      .length
  try {
    await success(
      fixture.cli([
        "up",
        "--project",
        fixture.project,
        "--model",
        "test/test-model",
        "--provider-url",
        fixture.providerURL,
        "--auto",
        "--home",
        fixture.home,
      ]),
    )
    await success(fixture.cli(["send", "Build managed-fixture", "--home", fixture.home]))
    const worker = await until(async () => {
      const current = await status(fixture)
      return current.tasks.find((task) => task.decisions.some((decision) => decision.id === "scope"))
    })
    await success(fixture.cli(["answer", "managed-fixture", "scope", "Proceed", "--home", fixture.home]))
    await Promise.race([
      fixture.resultRequested,
      Bun.sleep(15_000).then(() => {
        throw new Error("Worker did not reach its gated model request")
      }),
    ])
    const settings = await SupervisorSettings.read(fixture.home)
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    expect((await native.active()).includes(worker.sessionID)).toBe(true)
    const original = await SupervisorManaged.owner(fixture.home)
    if (!original || !(await SupervisorManaged.running(original.owner)))
      throw new Error("Manager exited before the crash fixture")
    process.kill(original.owner.pid, "SIGKILL")
    await until(async () => !(await SupervisorManaged.running(original.owner)) || undefined)
    if (original.native) await SupervisorManaged.terminate(original.native)

    // Freeze the crash checkpoint after the supervisor persisted cancellation but before
    // the native user interruption could release its durable execution claim.
    const store = SupervisorStore.open(fixture.home, { epoch: original.epoch, pilotID: original.pilotID })
    try {
      const lead = store.lead()
      if (!lead) throw new Error("Fixture lost its lead")
      store.cancelTask({ authority: lead, taskID: worker.id })
      expect(store.tasks().find((task) => task.id === worker.id)?.status).toBe("cancelling")
    } finally {
      store.close()
    }
    const before = calls()
    await success(fixture.cli(["start", "--home", fixture.home], 50_000))
    const recovered = await until(async () => {
      const current = (await status(fixture)).tasks.find((task) => task.id === worker.id)
      return calls() > before || current?.status === "cancelled" ? current : undefined
    })
    expect(calls()).toBe(before)
    expect(recovered.status).toBe("cancelled")
    expect(recovered.receipts).toEqual([])
    expect((await native.active()).includes(worker.sessionID)).toBe(false)
    fixture.releaseResult()
    await Bun.sleep(100)
    expect(calls()).toBe(before)
  } finally {
    fixture.releaseResult()
    await fixture.cli(["stop", "--home", fixture.home]).catch(() => undefined)
  }
}, 75_000)

type Fixture = Awaited<ReturnType<typeof managedEval>>
async function status(fixture: Fixture) {
  const result = await success(fixture.cli(["status", "--json", "--home", fixture.home]))
  return JSON.parse(result.stdout) as {
    tasks: { id: string; sessionID: string; status: string; decisions: { id: string }[]; receipts: unknown[] }[]
  }
}
async function success(result: ReturnType<Fixture["cli"]>) {
  const value = await result
  if (value.code) throw new Error(value.stderr)
  return value
}
async function until<T>(probe: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for cancellation recovery")
}
