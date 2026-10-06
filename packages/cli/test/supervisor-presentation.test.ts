import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Schema } from "effect"
import { SupervisorClient } from "../src/supervisor/client"
import { SupervisorNative } from "../src/supervisor/native"
import { SupervisorPresentation } from "../src/supervisor/presentation"
import { SupervisorSettings } from "../src/supervisor/settings"
import { managedEval } from "./fixtures/supervisor-managed-eval"

test("profiled attachment observes the exact home and Session without admission or a missing-Session fallback", async () => {
  await using fixture = await managedEval("result", process.env.SHUVCODE_SUPERVISOR_BINARY)
  const profile = path.join(fixture.root, "shuvbro.json")
  await Bun.write(
    profile,
    JSON.stringify({ version: 1, id: "shuvbro", leadInstructions: "Preserve the operator's exact parent placement." }),
  )
  try {
    await command(fixture, ["up", ...setup(fixture), "--auto", "--profile", profile])
    const settings = await SupervisorSettings.read(fixture.home)
    const password = await SupervisorSettings.password(settings)
    const client = OpenCode.make({
      baseUrl: settings.endpoint,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    const native = SupervisorNative.connect({ url: settings.endpoint, password })
    const initial = await presentation(fixture)
    expect(initial.entries).toHaveLength(1)
    const lead = initial.entries[0]!
    expect(lead).toMatchObject({ role: "lead", title: "ShuvBro lead", state: "idle", available: true, settled: false })
    expect(settings.profile?.sha256).toHaveLength(64)
    const externalHome = path.join(fixture.root, "external-profile")
    const external = await fixture.cli([
      "init",
      "--home",
      externalHome,
      "--project",
      fixture.project,
      "--endpoint",
      settings.endpoint,
      "--profile",
      profile,
    ])
    expect(external.code).not.toBe(0)
    expect(external.stderr).toContain("profiles require a managed supervisor home")
    expect(await Bun.file(path.join(externalHome, "settings.json")).exists()).toBe(false)
    const before = await native.log({ sessionID: lead.sessionID })
    const sessions = (await client.session.list()).data.map((session) => session.id).sort()
    const attach = [
      "attach",
      "--home",
      fixture.home,
      "--home-id",
      settings.pilotID,
      "--session",
      lead.sessionID,
      "--location",
      fixture.project,
      "--json",
    ]
    expect(JSON.parse(await command(fixture, attach))).toEqual(lead.attachment)
    expect(JSON.parse(await command(fixture, attach))).toEqual(lead.attachment)
    expect((await fixture.cli(attach.map((arg) => (arg === settings.pilotID ? "wrong-home" : arg)))).code).not.toBe(0)
    expect((await fixture.cli(attach.map((arg) => (arg === lead.sessionID ? "ses_missing" : arg)))).code).not.toBe(0)
    expect((await fixture.cli(attach.map((arg) => (arg === fixture.project ? fixture.root : arg)))).code).not.toBe(0)
    const environment = SupervisorSettings.environment(settings, password)
    for (const target of [
      { sessionID: "ses_missing", location: fixture.project },
      { sessionID: lead.sessionID, location: fixture.root },
    ]) {
      const rejected = await fixture.rootCli(
        ["--server", settings.endpoint, "--session", target.sessionID, "--attach-only", target.location],
        environment,
      )
      expect(rejected.code).not.toBe(0)
      expect(rejected.stderr).toContain("Attachment Session is missing or its location changed")
    }
    expect((await client.session.list()).data.map((session) => session.id).sort()).toEqual(sessions)
    expect((await native.log({ sessionID: lead.sessionID })).events).toEqual(before.events)
    expect(fixture.requests).toHaveLength(0)
    const saved = await Bun.file(path.join(fixture.home, "settings.json")).text()
    await Bun.write(profile, JSON.stringify({ version: 1, id: "shuvbro", leadInstructions: "Different profile" }))
    const changed = await fixture.cli(["init", ...setup(fixture), "--profile", profile])
    expect(changed.code).not.toBe(0)
    expect(changed.stderr).toContain("different orchestration profile")
    expect(await Bun.file(path.join(fixture.home, "settings.json")).text()).toBe(saved)
    await command(fixture, ["send", "Check profile", "--home", fixture.home])
    await until(async () => fixture.requests[0])
    expect(JSON.stringify(fixture.requests[0])).toContain("Preserve the operator's exact parent placement.")
    expect(JSON.stringify(fixture.requests[0])).toContain("Orchestration profile: shuvbro")
    expect(fixture.requests[0]?.tools?.map((tool) => tool.name)).toContain("supervisor_task")
  } finally {
    await fixture.cli(["stop", "--home", fixture.home])
  }
}, 60_000)

test("two real worker projections retain identity across blocking, settlement, and manager restart", async () => {
  await using fixture = await managedEval("permission", process.env.SHUVCODE_SUPERVISOR_BINARY)
  try {
    await command(fixture, ["up", ...setup(fixture)])
    for (const name of ["managed-fixture", "managed-fixture-two"])
      await command(fixture, [
        "task",
        "Build and commit RESULT.md with the managed worker finding",
        "--name",
        name,
        "--home",
        fixture.home,
      ])
    const blocked = await until(async () => {
      const current = await presentation(fixture)
      return current.entries.filter((entry) => entry.role !== "lead" && entry.state === "blocked").length === 2
        ? current
        : undefined
    })
    const workers = blocked.entries.filter((entry) => entry.role !== "lead")
    expect(new Set(workers.map((entry) => entry.sessionID)).size).toBe(2)
    expect(new Set(workers.map((entry) => entry.location)).size).toBe(2)
    for (const entry of workers) {
      expect(entry).toMatchObject({ available: true, settled: false, label: "Needs input" })
      expect(entry.attachment.location).toBe(entry.location)
      expect(entry.location).not.toBe(fixture.project)
      expect(entry.attachment.attach_argv.slice(-10)).toEqual([
        "supervisor",
        "attach",
        "--home",
        fixture.home,
        "--home-id",
        blocked.homeID,
        "--session",
        entry.sessionID,
        "--location",
        entry.location,
      ])
    }
    const settings = await SupervisorSettings.read(fixture.home)
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    for (const entry of workers) {
      const requests = await native.permissions(entry.location, entry.sessionID)
      expect(requests.length).toBeGreaterThan(0)
    }
    await command(fixture, ["cancel", workers[0]!.taskID!, "--home", fixture.home])
    const cancelled = await until(async () => {
      const current = (await presentation(fixture)).entries.find((entry) => entry.id === workers[0]!.id)
      return current?.settled ? current : undefined
    })
    expect(cancelled).toMatchObject({ state: "done", label: "Cancelled", settled: true })
    const approved = new Set<string>()
    await until(async () => {
      const current = JSON.parse(await command(fixture, ["status", "--home", fixture.home, "--json"])) as {
        tasks: Array<{ id: string; receipts: unknown[] }>
      }
      for (const request of await native.permissions(workers[1]!.location, workers[1]!.sessionID)) {
        if (approved.has(request.id)) continue
        await command(fixture, ["approve", workers[1]!.taskID!, request.id, "--home", fixture.home])
        approved.add(request.id)
      }
      const worker = current.tasks.find((entry) => entry.id === workers[1]!.taskID)
      return worker?.receipts.length ? worker : undefined
    }).catch(async (error) => {
      const messages = (await native.messages(workers[1]!.sessionID)).data
      const errors = messages.flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) =>
              part.type === "tool" && part.state.status === "error"
                ? [{ tool: part.name, error: part.state.error }]
                : [],
            )
          : [],
      )
      throw new Error(
        `Worker receipt did not settle: ${JSON.stringify({ approved: [...approved], errors, requests: fixture.requests.length, status: JSON.parse(await command(fixture, ["status", "--home", fixture.home, "--json"])) })}`,
        { cause: error },
      )
    })
    await command(fixture, ["complete", workers[1]!.taskID!, "--home", fixture.home])
    await until(async () =>
      (await presentation(fixture)).entries.find((entry) => entry.id === workers[1]!.id && entry.settled),
    )
    await command(fixture, ["stop", "--home", fixture.home])
    expect((await fixture.cli(["presentation", "--home", fixture.home, "--json"])).code).not.toBe(0)
    await command(fixture, ["start", "--home", fixture.home])
    const restored = await presentation(fixture)
    expect(restored.homeID).toBe(blocked.homeID)
    for (const entry of workers)
      expect(restored.entries.find((item) => item.id === entry.id)).toMatchObject({
        sessionID: entry.sessionID,
        location: entry.location,
        attachment: entry.attachment,
        state: "done",
        settled: true,
      })
  } finally {
    await fixture.cli(["stop", "--home", fixture.home])
  }
}, 90_000)

type Fixture = Awaited<ReturnType<typeof managedEval>>

test("cancelling an open worker decision settles its display without deleting decision history", async () => {
  await using fixture = await managedEval("decision", process.env.SHUVCODE_SUPERVISOR_BINARY)
  try {
    await command(fixture, ["up", ...setup(fixture), "--auto"])
    await command(fixture, ["task", "Build and commit RESULT.md", "--name", "managed-fixture", "--home", fixture.home])
    await until(async () =>
      (await presentation(fixture)).entries.find(
        (entry) => entry.id === "managed-fixture" && entry.state === "blocked",
      ),
    )
    await command(fixture, ["cancel", "managed-fixture", "--home", fixture.home])
    const settled = await until(async () =>
      (await presentation(fixture)).entries.find((entry) => entry.id === "managed-fixture" && entry.settled),
    )
    expect(settled).toMatchObject({ state: "done", label: "Cancelled", available: true, settled: true })
    const current = JSON.parse(await command(fixture, ["status", "--home", fixture.home, "--json"])) as {
      tasks: Array<{ id: string; decisions: Array<{ id: string }> }>
    }
    expect(current.tasks.find((entry) => entry.id === "managed-fixture")?.decisions).toContainEqual(
      expect.objectContaining({ id: "scope" }),
    )
  } finally {
    fixture.releaseResult()
    await fixture.cli(["stop", "--home", fixture.home])
  }
}, 60_000)

test("an adopted lead follows its actual location and shows pending descendant forms", async () => {
  await using fixture = await managedEval("result", process.env.SHUVCODE_SUPERVISOR_BINARY)
  try {
    await command(fixture, ["up", ...setup(fixture), "--auto"])
    const settings = await SupervisorSettings.read(fixture.home)
    const client = OpenCode.make({
      baseUrl: settings.endpoint,
      headers: { authorization: `Basic ${btoa(`opencode:${await SupervisorSettings.password(settings)}`)}` },
    })
    const directory = path.join(fixture.root, "adopted")
    await mkdir(directory)
    const adopted = await client.session.create({
      id: "ses_adopted_lead",
      location: { directory },
      agent: "supervisor-lead",
      model: { providerID: "test", id: "test-model" },
    })
    await command(fixture, ["lead", "--home", fixture.home, "--session", adopted.id, "--no-open"])
    const current = (await presentation(fixture)).entries.find((entry) => entry.role === "lead")!
    expect(current).toMatchObject({
      sessionID: adopted.id,
      location: directory,
      available: true,
      state: "idle",
      attachment: { location: directory },
    })
    const child = await client.session.create({ id: "ses_child_form", parentID: adopted.id })
    const form = await client.session.form.create({
      sessionID: child.id,
      title: "Pick a branch",
      fields: [{ key: "branch", type: "string", required: true }],
    })
    expect((await presentation(fixture)).entries.find((entry) => entry.role === "lead")).toMatchObject({
      state: "blocked",
      label: "Needs input",
      settled: false,
    })
    const rejected = await fixture.cli([
      "attach",
      "--home",
      fixture.home,
      "--home-id",
      settings.pilotID,
      "--session",
      child.id,
      "--location",
      directory,
      "--json",
    ])
    expect(rejected.code).not.toBe(0)
    expect(rejected.stderr).toContain("exact root Session")
    await client.session.form.reply({ sessionID: child.id, formID: form.id, answer: { branch: "integration-v2" } })
    expect((await presentation(fixture)).entries.find((entry) => entry.role === "lead")?.state).toBe("idle")
    const facts = Schema.decodeUnknownSync(SupervisorPresentation.Facts)(
      await SupervisorClient.request(fixture.home, { type: "presentation" }),
    )
    const unavailable = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("Unavailable", { status: 503 }),
    })
    try {
      const unknown = await SupervisorPresentation.read({
        settings,
        facts,
        native: SupervisorNative.connect({ url: unavailable.url.toString() }),
        command: ["/test/shuvcode"],
      })
      expect(unknown.entries.every((entry) => entry.state === "unknown" && !entry.available && !entry.settled)).toBe(
        true,
      )
    } finally {
      await unavailable.stop(true)
    }
    expect(fixture.requests).toHaveLength(0)
  } finally {
    await fixture.cli(["stop", "--home", fixture.home])
  }
}, 60_000)

function setup(fixture: Fixture) {
  return [
    "--home",
    fixture.home,
    "--project",
    fixture.project,
    "--model",
    "test/test-model",
    "--provider-url",
    fixture.providerURL,
  ]
}

async function command(fixture: Fixture, args: string[]) {
  const result = await fixture.cli(args)
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout
}

async function presentation(fixture: Fixture) {
  return Schema.decodeUnknownSync(SupervisorPresentation.Snapshot)(
    JSON.parse(await command(fixture, ["presentation", "--home", fixture.home, "--json"])),
  )
}

async function until<T>(probe: () => Promise<T | undefined>) {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await Bun.sleep(50)
  }
  throw new Error("Presentation condition did not settle")
}
