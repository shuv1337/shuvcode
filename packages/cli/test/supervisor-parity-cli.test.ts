import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const homes: string[] = []
afterEach(() => homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true })))

async function fixture(snapshot: Record<string, unknown> = {}, responses: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), "supervisor-parity-cli-"))
  homes.push(home)
  const operations: Record<string, unknown>[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { operation: Record<string, unknown> }
      operations.push(body.operation)
      return Response.json({
        result:
          body.operation.type === "status"
            ? { lead: { sessionID: "lead", generation: 3, active: true }, tasks: [], ...snapshot }
            : (responses[String(body.operation.type)] ?? { id: body.operation.id ?? "ok", state: "ready" }),
      })
    },
  })
  await Bun.write(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      pilotID: "fixture",
      project: home,
      baseRef: "integration-v2",
      model: { providerID: "openai", modelID: "gpt-6-sol" },
      agent: "build",
      auto: false,
      mode: "managed",
      endpoint: "http://127.0.0.1:1",
      port: 1,
    }),
  )
  await Bun.write(
    join(home, "supervisor.json"),
    JSON.stringify({
      url: `http://127.0.0.1:${server.port}/`,
      operatorToken: "fixture",
      pluginToken: "plugin",
    }),
  )
  return { home, server, operations }
}

async function cli(...args: string[]) {
  const process = Bun.spawn([processExec(), "src/index.ts", "supervisor", ...args], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { stdout, stderr, code }
}

function processExec() {
  return Bun.which("bun")!
}

test("parity commands take normal arguments and map to typed operations", async () => {
  const fixtureValue = await fixture()
  try {
    const channel = await cli(
      "channel",
      "configure",
      "discord",
      "--kind",
      "relay",
      "--endpoint",
      "http://127.0.0.1:9999",
      "--enabled",
      "on",
      "--home",
      fixtureValue.home,
    )
    expect(channel.code).toBe(0)
    expect(channel.stdout).toContain("id: discord")
    const reply = await cli(
      "reply",
      "promise",
      "reply-1",
      "--source",
      "note-1",
      "--work-id",
      "work-1",
      "--task-id",
      "task-1",
      "--home",
      fixtureValue.home,
    )
    expect(reply.code).toBe(0)
    const imageReply = await cli(
      "reply",
      "send",
      "reply-1",
      "--text",
      "Here is the visual",
      "--image",
      "/tmp/visual.png",
      "--home",
      fixtureValue.home,
    )
    expect(imageReply.code).toBe(0)
    const dismiss = await cli("inbox", "dismiss", "relay-1", "--home", fixtureValue.home)
    expect(dismiss.code).toBe(0)
    const replies = await cli("reply", "list", "--work-id", "work-1", "--home", fixtureValue.home)
    expect(replies.code).toBe(0)
    const delegate = await cli(
      "delegate",
      "add",
      "worker-1",
      "--delegate-home",
      "/tmp/worker",
      "--scope",
      "project",
      "--home",
      fixtureValue.home,
    )
    expect(delegate.code).toBe(0)
    const handoff = await cli(
      "handoff",
      "create",
      "handoff-1",
      "--delegate",
      "worker-1",
      "--work",
      "task-1",
      "--home",
      fixtureValue.home,
    )
    expect(handoff.code).toBe(0)
    expect(fixtureValue.operations).toMatchObject([
      { type: "channel.configure", id: "discord", kind: "relay", enabled: true },
      { type: "reply.promise", id: "reply-1", sourceID: "note-1", workID: "work-1", taskID: "task-1" },
      { type: "reply.send", id: "reply-1", text: "Here is the visual", imagePath: "/tmp/visual.png" },
      { type: "inbox.dismiss", id: "relay-1" },
      { type: "reply.list", workID: "work-1" },
      { type: "status" },
      { type: "delegate.add", id: "worker-1", generation: 3, home: "/tmp/worker" },
      { type: "status" },
      { type: "handoff.create", id: "handoff-1", delegateID: "worker-1", workIDs: ["task-1"], generation: 3 },
    ])
  } finally {
    fixtureValue.server.stop(true)
  }
})

test("parity command help exposes explicit transport and handoff actions", async () => {
  for (const name of ["channel", "inbox", "reply", "away", "knowledge", "delegate", "handoff"]) {
    const result = await cli(name, "--help")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`supervisor ${name}`)
    expect(result.stderr).not.toContain("Error")
  }
})

test("show reads a delegated scout report and status recognizes work without a local execution", async () => {
  const fixtureValue = await fixture(
    {
      backlog: [
        {
          id: "remote-readme",
          projectID: "project",
          kind: "scout",
          brief: "Inspect the README",
          deliveryMode: "direct-PR",
          mergePolicy: "manual",
          overrides: {},
          dependencies: [],
          resources: [],
          priority: 0,
          state: "done",
          attempt: 1,
          delegatedHandoffID: "ssh-readme",
          createdAt: 1,
          updatedAt: 2,
          readiness: { eligible: false, reasons: ["done"], dependencies: [] },
        },
      ],
    },
    {
      "handoff.status": {
        id: "ssh-readme",
        delegateID: "secondmate",
        state: "completed",
        result: {
          work: [
            {
              sourceID: "remote-readme",
              report: {
                evidence: { artifact: { contentBase64: Buffer.from("# Verified remote report\n").toString("base64") } },
              },
            },
          ],
        },
      },
    },
  )
  try {
    const shown = await cli("show", "remote-readme", "--home", fixtureValue.home)
    expect(shown.code).toBe(0)
    expect(shown.stdout).toContain("# Verified remote report")
    expect(shown.stdout).toContain("Delegate: secondmate")
    expect(shown.stdout).not.toContain("contentBase64")
    const status = await cli("status", "--task", "remote-readme", "--home", fixtureValue.home)
    expect(status.code).toBe(0)
    expect(status.stdout).toContain("handoff ssh-readme")
    expect(status.stdout).not.toContain("Task not found")
  } finally {
    fixtureValue.server.stop(true)
  }
})

test("ordinary CLI task controls follow a work retry while decision answers retain the exact execution", async () => {
  const fixtureValue = await fixture({
    backlog: [
      {
        id: "retry-work",
        projectID: "project",
        kind: "scout",
        brief: "Inspect the input",
        deliveryMode: "local-only",
        mergePolicy: "manual",
        overrides: {},
        dependencies: [],
        resources: [],
        priority: 0,
        state: "in-flight",
        attempt: 2,
        taskID: "retry-work-attempt-2",
        createdAt: 1,
        updatedAt: 2,
        readiness: { eligible: false, reasons: ["in-flight"], dependencies: [] },
      },
    ],
  })
  try {
    const steer = await cli("steer", "retry-work", "Inspect the new input", "--home", fixtureValue.home)
    expect(steer.code).toBe(0)
    expect(fixtureValue.operations.at(-1)).toMatchObject({ type: "task.send", taskID: "retry-work-attempt-2" })
    const answer = await cli("answer", "retry-work", "choice", "Original answer", "--home", fixtureValue.home)
    expect(answer.code).toBe(0)
    expect(fixtureValue.operations.at(-1)).toMatchObject({ type: "decision.resolve", taskID: "retry-work" })
  } finally {
    fixtureValue.server.stop(true)
  }
})
