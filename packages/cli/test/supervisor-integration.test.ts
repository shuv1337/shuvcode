import { expect, test } from "bun:test"
import path from "node:path"
import { SupervisorAPI } from "../src/supervisor/api"
import { SupervisorNative } from "../src/supervisor/native"
import { createSupervisorFixture, toolCallStream } from "./fixtures/supervisor"

test("supervisor runs ship and scout in independent native worktrees and verifies plugin receipts", async () => {
  const calls = new Map<string, number>()
  const worktrees = new Map<string, string>()
  await using fixture = await createSupervisorFixture((body) => {
    const wire = JSON.stringify(body)
    const taskID = wire.includes("Supervisor task: ship-fixture")
      ? "ship-fixture"
      : wire.includes("Supervisor task: scout-fixture")
        ? "scout-fixture"
        : undefined
    if (!taskID) return "Lead notice received"
    const count = calls.get(taskID) ?? 0
    calls.set(taskID, count + 1)
    if (count === 0) {
      const content = `${taskID} artifact\n`
      const command =
        taskID === "ship-fixture"
          ? `printf '%s' '${content.trim()}' > RESULT.md && git add RESULT.md && git commit -m 'feat: fixture ship'`
          : `printf '%s' '${content.trim()}' > RESULT.md`
      return toolCallStream(`call_${taskID}_write`, "shell", { command })
    }
    if (count === 1) {
      return toolCallStream(`call_${taskID}_receipt`, "supervisor_result", { relativePath: "RESULT.md" })
    }
    return `${taskID} done`
  })
  const server = await fixture.startServer()
  const native = SupervisorNative.connect({ url: server.url, password: server.password })
  const leadID = "ses_supervisor_integration_lead"
  await native.create({
    sessionID: leadID,
    directory: fixture.project,
    agent: "build",
    model: { providerID: "test", id: "test-model" },
    permissions: [],
  })
  let api: Awaited<ReturnType<typeof SupervisorAPI.serve>> | undefined = await SupervisorAPI.serve({
    home: fixture.home,
    endpoint: server.url,
    password: server.password,
    intervalMs: 50,
  })
  try {
    const lead = (await SupervisorAPI.request(fixture.home, {
      type: "lead.activate",
      sessionID: leadID,
      expectedGeneration: 0,
    })) as { generation: number }
    expect(lead.generation).toBe(1)
    const tasks = await Promise.all(
      (["ship-fixture", "scout-fixture"] as const).map(async (taskID) => {
        const task = (await SupervisorAPI.request(fixture.home, {
          type: "task.create",
          generation: lead.generation,
          taskID,
          kind: taskID === "ship-fixture" ? "ship" : "scout",
          project: fixture.project,
          baseRef: "integration-v2",
          brief: `Produce ${taskID} artifact and submit its receipt`,
          model: { providerID: "test", modelID: "test-model" },
          agent: "build",
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })) as { id: string; sessionID: string; worktree: string; branch: string; baseCommit: string }
        worktrees.set(taskID, task.worktree)
        return task
      }),
    )
    expect(tasks[0].sessionID).not.toBe(tasks[1].sessionID)
    expect(tasks[0].worktree).not.toBe(tasks[1].worktree)

    const completed = await waitFor(async () => {
      const status = (await SupervisorAPI.request(fixture.home, { type: "status" })) as {
        tasks: Array<{
          id: string
          status: string
          error?: string
          receipts: Array<{
            operationID: string
            evidence: { artifact: { relativePath: string; sha256: string; contentBase64: string }; head: string }
          }>
        }>
      }
      if (status.tasks.some((task) => task.error))
        throw new Error(JSON.stringify(status.tasks.map((task) => ({ id: task.id, error: task.error }))))
      return status.tasks.length === 2 && status.tasks.every((task) => task.receipts.length === 1) ? status : undefined
    }, 20_000).catch(async (error) => {
      const status = (await SupervisorAPI.request(fixture.home, { type: "status" })) as {
        tasks: Array<{ id: string; status: string; error?: string; receipts: unknown[] }>
      }
      const toolErrors = await Promise.all(
        tasks.map(async (task) => ({
          id: task.id,
          errors: (await native.messages(task.sessionID)).data.flatMap((message) =>
            message.type === "assistant"
              ? message.content.flatMap((part) =>
                  part.type === "tool" && part.state.status === "error"
                    ? [{ name: part.name, error: part.state.error }]
                    : [],
                )
              : [],
          ),
        })),
      )
      throw new Error(
        JSON.stringify({
          tasks: status.tasks.map((task) => ({
            id: task.id,
            status: task.status,
            error: task.error,
            receipts: task.receipts.length,
          })),
          calls: [...calls],
          llmRequests: fixture.llm.requests.length,
          toolErrors,
        }),
        { cause: error },
      )
    })
    expect(completed.tasks.map((task) => task.id).sort()).toEqual(["scout-fixture", "ship-fixture"])
    expect(completed.tasks.every((task) => task.status === "active")).toBe(true)
    for (const task of tasks) {
      const session = await native.get(task.sessionID)
      expect(session.parentID).toBeUndefined()
      expect(session.location.directory).toBe(task.worktree)
      expect(session.model).toMatchObject({ providerID: "test", id: "test-model" })
      const receipt = completed.tasks.find((item) => item.id === task.id)?.receipts[0]
      expect(receipt?.evidence.artifact.relativePath).toBe("RESULT.md")
      expect(receipt?.evidence.artifact.contentBase64).toBeTruthy()
      const messages = await native.messages(task.sessionID)
      expect(messages.data.some((message) => message.type === "assistant")).toBe(true)
    }
    expect(fixture.llm.requests.length).toBeGreaterThanOrEqual(6)

    for (const task of tasks) {
      const result = (await SupervisorAPI.request(fixture.home, {
        type: "task.complete",
        generation: lead.generation,
        taskID: task.id,
      })) as { status: string }
      expect(result.status).toBe("completed")
      expect(
        (
          (await SupervisorAPI.request(fixture.home, {
            type: "task.complete",
            generation: lead.generation,
            taskID: task.id,
          })) as { status: string }
        ).status,
      ).toBe("completed")
    }
    const settled = (await SupervisorAPI.request(fixture.home, { type: "status" })) as {
      tasks: Array<{ id: string; status: string; receipts: unknown[]; obligations: unknown[] }>
    }
    expect(settled.tasks.every((task) => task.status === "completed")).toBe(true)
    await waitFor(async () => {
      if ((await native.active()).includes(leadID) || (await native.inbox(leadID)).length) return undefined
      return true
    }, 5_000)
    const beforeRestart = {
      tasks: settled.tasks,
      leadEvents: (await native.log({ sessionID: leadID })).events
        .filter((event) => event.name === "session.inbox.enqueued")
        .map((event) => event.seq),
      llmRequests: fixture.llm.requests.length,
    }

    await api.close()
    api = undefined
    server.server.kill("SIGKILL")
    await server.server.exited
    const restartedServer = await fixture.startServer(Number(new URL(server.url).port))
    expect(restartedServer.url).toBe(server.url)
    api = await SupervisorAPI.serve({
      home: fixture.home,
      endpoint: restartedServer.url,
      password: restartedServer.password,
      intervalMs: 50,
    })
    await Bun.sleep(500)
    const restored = (await SupervisorAPI.request(fixture.home, { type: "status" })) as typeof settled
    expect(restored.tasks).toEqual(beforeRestart.tasks)
    expect(
      (await native.log({ sessionID: leadID })).events
        .filter((event) => event.name === "session.inbox.enqueued")
        .map((event) => event.seq),
    ).toEqual(beforeRestart.leadEvents)
    expect(fixture.llm.requests.length).toBe(beforeRestart.llmRequests)
  } finally {
    await api?.close()
  }
}, 45_000)

test("lead creates a task through the friendly supervisor tool with registered project defaults", async () => {
  await using fixture = await createSupervisorFixture((body) => {
    const wire = JSON.stringify(body)
    if (!wire.includes("Delegate friendly-fixture")) return "Worker ready"
    if (wire.includes("Queued scout task friendly-fixture")) return "Task assigned"
    return toolCallStream("call_friendly_task", "supervisor_task", {
      name: "friendly-fixture",
      brief: "Write RESULT.md with a short finding",
      kind: "scout",
    })
  })
  const configPath = path.join(fixture.root, "config", "opencode.json")
  const config = (await Bun.file(configPath).json()) as {
    plugins: Array<{ package: string; options: Record<string, unknown> }>
    [key: string]: unknown
  }
  config.plugins[0]!.options = { home: fixture.home }
  await Bun.write(configPath, JSON.stringify(config))
  const server = await fixture.startServer()
  const native = SupervisorNative.connect({ url: server.url, password: server.password })
  const leadID = "ses_supervisor_friendly_lead"
  await native.create({
    sessionID: leadID,
    directory: fixture.project,
    agent: "build",
    model: { providerID: "test", id: "test-model" },
    permissions: [],
  })
  const api = await SupervisorAPI.serve({
    home: fixture.home,
    endpoint: server.url,
    password: server.password,
    intervalMs: 50,
  })
  try {
    await SupervisorAPI.request(fixture.home, { type: "lead.activate", sessionID: leadID, expectedGeneration: 0 })
    await SupervisorAPI.request(fixture.home, {
      type: "project.add",
      generation: 1,
      id: "fixture",
      path: fixture.project,
      baseRef: "integration-v2",
      model: { providerID: "test", modelID: "test-model" },
      agent: "build",
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    await native.pluginReady(fixture.project, "native-supervisor-pilot")
    await native.prompt({
      sessionID: leadID,
      id: "msg_friendly_delegate",
      text: "Delegate friendly-fixture using supervisor_task",
      delivery: "queue",
      resume: true,
    })
    const task = await waitFor(async () => {
      const status = (await SupervisorAPI.request(fixture.home, { type: "status" })) as {
        tasks: Array<{ id: string; kind: string; project: string; baseRef: string; model: { modelID: string } }>
      }
      return status.tasks.find((item) => item.id === "friendly-fixture")
    }, 3_000).catch(async (error) => {
      const messages = await native.messages(leadID)
      const requests = fixture.llm.requests.map((request) => {
        const body = request as { tools?: Array<{ function?: { name?: string }; name?: string }>; messages?: unknown[] }
        return { tools: body.tools?.map((tool) => tool.function?.name ?? tool.name), messages: body.messages?.length }
      })
      throw new Error(
        `Friendly task was not created; requests=${JSON.stringify(requests)}; messages=${JSON.stringify(messages.data)}`,
        { cause: error },
      )
    })
    expect(task).toMatchObject({ kind: "scout", project: fixture.project, baseRef: "integration-v2" })
    expect(task.model.modelID).toBe("test-model")
  } finally {
    await api.close()
  }
}, 30_000)

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result !== undefined) return result
    await Bun.sleep(100)
  }
  throw new Error("Timed out waiting for verified supervisor receipts")
}
