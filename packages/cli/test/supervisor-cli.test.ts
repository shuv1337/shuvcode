import { expect, test } from "bun:test"
import { SupervisorFormat } from "../src/supervisor/format"
import { createSupervisorFixture } from "./fixtures/supervisor"

test("supervisor status gives the next action without exposing native session identity", () => {
  const emptyStatus = {
    home: "/private/supervisor",
    project: "/project",
    endpoint: "http://127.0.0.1:9000",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    health: "running" as const,
    error: undefined,
    leadState: undefined,
    leadError: undefined,
    leadPermissions: [],
    snapshotObservedAt: undefined,
    lead: { sessionID: "ses_private_lead", generation: 1, active: true },
    pendingNotifications: [],
    tasks: [],
  }
  const empty = SupervisorFormat.status(emptyStatus)
  expect(empty).toContain("Lead: ready")
  expect(empty).toContain('shuvcode supervisor task "<brief>"')

  const task = {
    id: "api-fix",
    kind: "ship" as const,
    project: "/project",
    worktree: "/project/.worktrees/api-fix",
    branch: "api-fix",
    baseRef: "integration-v2",
    baseCommit: "abc",
    sessionID: "ses_private_native_identity",
    brief: "Repair the API",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    agent: "build",
    permissions: [],
    status: "active" as const,
    cursor: 0,
    provisioned: true,
    admissionUncertain: true,
    state: "unknown" as const,
    pending: 0,
    native: {
      state: "idle" as const,
      pending: 0,
      permissions: 1,
      permissionRequests: [{ id: "req-7", action: "write", resources: ["/project/file.ts"] }],
    },
    decisions: [],
    receipts: [],
    obligations: [],
  }
  const output = SupervisorFormat.status(
    {
      home: "/private/supervisor",
      project: "/project",
      endpoint: "http://127.0.0.1:9000",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      health: "running",
      error: undefined,
      leadState: undefined,
      leadError: undefined,
      leadPermissions: [],
      snapshotObservedAt: undefined,
      lead: { sessionID: "ses_private_lead", generation: 1, active: true },
      pendingNotifications: [],
      tasks: [task],
    },
    task.id,
  )
  expect(output).toContain("api-fix  blocked  ship  Repair the API · 1 permission · delivery uncertain")
  expect(output).toContain("shuvcode supervisor recover api-fix")
  expect(output).toContain("shuvcode supervisor approve api-fix req-7")
  expect(output).not.toContain(task.sessionID)

  const longBrief = `Repair the API ${"with clear behavior and tests ".repeat(8)}\nInclude an acceptance report.`
  const compact = SupervisorFormat.taskLine({ ...task, brief: longBrief })
  expect(compact).toContain("…")
  expect(compact).not.toContain(longBrief)
  expect(SupervisorFormat.details({ ...task, brief: longBrief })).toContain(`Brief: ${longBrief}`)

  const cached = SupervisorFormat.status(
    {
      home: "/private/supervisor",
      project: "/project",
      endpoint: "http://127.0.0.1:9000",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      health: "stopped",
      error: undefined,
      lead: { sessionID: "ses_private_lead", generation: 1, active: true },
      leadState: "failed",
      leadError: "Authentication failed",
      leadPermissions: [],
      snapshotObservedAt: Date.now(),
      pendingNotifications: [],
      tasks: [task],
    },
    task.id,
    "/private/supervisor",
  )
  expect(cached).toContain("Lead: failed")
  expect(cached).toContain("Lead error: Authentication failed")
  expect(cached).toContain("Task state is from the last successful status check")
  expect(cached).toContain("shuvcode supervisor start --home '/private/supervisor'")

  const blocked = SupervisorFormat.status(
    {
      ...emptyStatus,
      leadState: "permission",
      leadPermissions: [{ id: "req-lead", action: "read", resources: ["/project/spec.md"] }],
    },
    undefined,
    "/private/supervisor",
  )
  expect(blocked).toContain("Lead: permission")
  expect(blocked).toContain("Lead permission req-lead: read /project/spec.md")
  expect(blocked).toContain(
    "Run: shuvcode supervisor approve lead req-lead --home '/private/supervisor'  (or add --deny)",
  )
})

test("decision output shows the question without its protocol envelope", () => {
  const line = SupervisorFormat.decision("api-fix", {
    taskID: "api-fix",
    id: "choose-route",
    payload: { question: "Which endpoint should ship?" },
  })
  expect(line).toBe("api-fix  choose-route  Which endpoint should ship?")
  expect(line).not.toContain("payload")
})

test("supervisor help lists normal commands and keeps request available", async () => {
  const process = Bun.spawn([Bun.which("bun")!, "src/index.ts", "supervisor", "--help"], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  expect(exit).toBe(0)
  expect(stderr).not.toContain("Error")
  for (const command of [
    "up",
    "lead",
    "send",
    "read",
    "task",
    "show",
    "status",
    "steer",
    "recover",
    "decisions",
    "answer",
    "approve",
    "doctor",
    "request",
    "projects",
    "project",
    "backlog",
    "bearings",
    "hold",
    "release",
    "retry",
    "dispatch",
    "interrupt",
    "resume",
  ])
    expect(stdout).toContain(command)
}, 30_000)

test("one-command setup and lead help expose their human-facing options", async () => {
  for (const [command, options] of [
    ["up", ["--project", "--model", "--auto", "--open", "--provider-url"]],
    ["lead", ["--session", "--new", "--no-open"]],
    ["task", ["--kind", "--base", "--agent"]],
    ["project set", ["--mode", "--yolo", "--no-yolo", "--base", "--model"]],
    ["project add", ["--name"]],
    ["backlog", ["--project", "--status"]],
  ] as const) {
    const process = Bun.spawn([Bun.which("bun")!, "src/index.ts", "supervisor", ...command.split(" "), "--help"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, exit] = await Promise.all([new Response(process.stdout).text(), process.exited])
    expect(exit).toBe(0)
    options.forEach((option) => expect(stdout).toContain(option))
  }
}, 30_000)

test("project and bearings views surface defaults and queued gates", () => {
  const project = {
    id: "api",
    path: "/project",
    description: "API",
    baseRef: "main",
    mode: "no-mistakes-prod-only" as const,
    yolo: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  }
  expect(SupervisorFormat.projects({ projects: [project], defaultProject: "api" })).toContain(
    "api (default)  no-mistakes-prod-only",
  )
  const queued = {
    id: "fix-api",
    projectID: "api",
    kind: "ship" as const,
    brief: "Repair the API",
    deliveryMode: "no-mistakes" as const,
    mergePolicy: "manual" as const,
    overrides: {},
    dependencies: [],
    resources: [],
    priority: 0,
    state: "queued" as const,
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
    readiness: { eligible: false, reasons: ["dependency review pending"], dependencies: [] },
  }
  expect(SupervisorFormat.backlog([queued])).toContain("waiting: dependency review pending")
  const status = {
    home: "/private/supervisor",
    project: "/project",
    endpoint: "http://127.0.0.1:9000",
    model: { providerID: "test", modelID: "model" },
    health: "running" as const,
    error: undefined,
    lead: undefined,
    leadState: undefined,
    leadError: undefined,
    leadPermissions: [],
    snapshotObservedAt: undefined,
    pendingNotifications: [],
    tasks: [],
    projects: [project],
    defaultProject: "api",
    backlog: [queued],
    deliveries: [],
  }
  expect(SupervisorFormat.status(status)).toContain("Registered projects: 1 · default api")
  const bearings = SupervisorFormat.bearings(status)
  expect(bearings).toContain("Underway\nNone")
  expect(bearings).toContain("User decisions\nNone")
  expect(bearings).toContain("Queued gates\nfix-api  dependency review pending")
  expect(bearings).toContain("Recent done\nNone")
})

test("normal CLI workflow registers projects and queues held work", async () => {
  await using fixture = await createSupervisorFixture()
  const server = await fixture.startServer()
  const env = { ...process.env, OPENCODE_PASSWORD: server.password }
  async function command(args: string[]) {
    const child = Bun.spawn([process.execPath, "src/index.ts", "supervisor", ...args, "--home", fixture.home], {
      cwd: import.meta.dir + "/..",
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`${args.join(" ")} failed: ${stderr}`)
    return stdout
  }
  async function bridge(body: string) {
    const child = Bun.spawn([process.execPath, "src/index.ts", "supervisor", "bridge", "--home", fixture.home], {
      cwd: import.meta.dir + "/..",
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    child.stdin.write(body)
    child.stdin.end()
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`Bridge failed: ${stderr}`)
    return JSON.parse(stdout) as { result?: { projects?: Array<{ id: string }> }; error?: string }
  }
  try {
    await command(["up", "--project", fixture.project, "--endpoint", server.url, "--model", "test/test-model"])
    expect(await command(["projects"])).toContain("project (default)")
    expect((await bridge(JSON.stringify({ operation: { type: "status" } }))).result?.projects?.[0]?.id).toBe("project")
    expect((await bridge("invalid json")).error).toBeTruthy()
    expect(await command(["project", "new", "blank"])).toContain("Project blank:")
    expect(await command(["project", "default", "blank"])).toContain("Default project: blank")
    expect(await command(["project", "set", "blank", "--mode", "local-only", "--yolo"])).toContain("updated")
    expect(
      await command(["task", "Review API", "--name", "review-api", "--project", "project", "--hold", "wait for scope"]),
    ).toContain("Work review-api: queued")
    expect(await command(["backlog", "--project", "project", "--status", "queued"])).toContain("review-api  queued")
    expect(await command(["bearings"])).toContain("review-api  held")
    await command(["project", "default", "project"])
    expect(await command(["project", "archive", "blank"])).toContain("Project archived: blank")
    expect(await command(["projects", "--all"])).toContain("blank (archived)")
  } finally {
    await command(["stop"])
  }
}, 45_000)
