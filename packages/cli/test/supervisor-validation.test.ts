import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorValidation } from "../src/supervisor/validation"

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "supervisor-validation-"))
  const repo = path.join(root, "repo")
  const origin = path.join(root, "origin.git")
  mkdirSync(repo)
  git(repo, "init", "-q", "-b", "feature")
  git(repo, "config", "user.name", "Fixture")
  git(repo, "config", "user.email", "fixture@example.test")
  writeFileSync(path.join(repo, "README.md"), "initial\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-qm", "initial")
  git(root, "clone", "-q", "--bare", repo, origin)
  git(repo, "remote", "add", "origin", origin)
  const db = new DatabaseSync(path.join(root, "supervisor.sqlite"))
  const input = {
    taskID: "task-1",
    generation: 1,
    worktree: repo,
    origin,
    submittedHead: git(repo, "rev-parse", "HEAD"),
    intent: "Repair the user's API while preserving the documented behavior.",
    baseBranch: "integration-v2",
  }
  return {
    root,
    repo,
    origin,
    db,
    input,
    cleanup: () => {
      db.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test("strict receipt binds a real fake CLI process to the submitted HEAD, then preserves an ask-user gate", async () => {
  const item = fixture()
  const statePath = path.join(item.root, "fake-state.json")
  const scriptPath = path.join(item.root, "fake-no-mistakes.ts")
  writeFileSync(
    statePath,
    JSON.stringify({ log: path.join(item.root, "calls.jsonl"), launched: false, responded: false }),
  )
  writeFileSync(
    scriptPath,
    `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
const statePath = process.env.FAKE_STATE
const state = JSON.parse(readFileSync(statePath, "utf8"))
const args = process.argv.slice(2)
appendFileSync(state.log, JSON.stringify(args) + "\\n")
const flag = (name) => args[args.indexOf(name) + 1]
const head = () => new TextDecoder().decode(Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe" }).stdout).trim()
const render = () => {
  const value = ["run:", "  id: 01RUN", "  branch: feature", "  status: " + (state.responded ? "completed" : "awaiting_approval"),
    "  head: " + JSON.stringify(head().slice(0, 12)), "  pr: " + JSON.stringify(state.responded ? "https://github.com/example/repo/pull/1" : "")]
  if (state.responded) value.push("outcome: checks-passed")
  else value.push("  findings[1]{id,severity,file,line,action,description}:",
    "    r1,error,src/api.ts,12,ask-user,Changes product behavior", "gate: review")
  process.stdout.write(value.join("\\n") + "\\n")
}
if (args[0] === "status") {
  process.stdout.write("  repo: " + process.cwd() + "\\nremote: " + ${JSON.stringify(item.origin)} + "\\n")
  process.exit(0)
}
if (args[0] !== "axi") process.exit(2)
if (args[1] === "status") {
  if (!state.launched) process.stdout.write("help[1]:\\n  No active run\\n")
  else render()
} else if (args[1] === "run") {
  state.launched = true
  writeFileSync(statePath, JSON.stringify(state))
  process.stdout.write(["launch_receipt:", "  run_id: 01RUN", "  disposition: created",
    "  launch_nonce: " + JSON.stringify(flag("--launch-nonce")),
    "  validation_generation: " + JSON.stringify(flag("--validation-generation")),
    "  branch: feature", "  head_sha: " + JSON.stringify(head()),
    "  submitted_head_sha: " + JSON.stringify(head()),
    "  intent_digest: " + createHash("sha256").update(flag("--intent")).digest("hex")].join("\\n") + "\\n")
  render()
} else if (args[1] === "respond") {
  Bun.spawnSync(["git", "commit", "--allow-empty", "-qm", "pipeline fix"])
  state.responded = true
  writeFileSync(statePath, JSON.stringify(state))
  render()
} else process.exit(2)
`,
  )
  const runner: SupervisorValidation.Runner = async (cwd, args) => {
    const child = Bun.spawn([process.execPath, scriptPath, ...args], {
      cwd,
      env: { ...process.env, FAKE_STATE: statePath },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, stdout, stderr }
  }
  try {
    const registry = SupervisorValidation.open(item.db, runner)
    const gate = await registry.start(item.input)
    expect(gate).toMatchObject({
      state: "gate",
      runID: "01RUN",
      submittedHead: item.input.submittedHead,
      gateStep: "review",
    })
    expect(gate.findings).toEqual([
      {
        id: "r1",
        severity: "error",
        file: "src/api.ts",
        line: "12",
        action: "ask-user",
        description: "Changes product behavior",
      },
    ])
    expect(registry.validation("task-1")).toMatchObject({ status: "ask-user", trusted: false })
    await expect(registry.respond({ taskID: "task-1", action: "approve" })).rejects.toThrow("recorded user decision")
    const done = await registry.respond({
      taskID: "task-1",
      action: "approve",
      userDecisionReference: "captain-decision-1",
    })
    expect(done.state).toBe("passed")
    expect(done.head).toBe(git(item.repo, "rev-parse", "HEAD"))
    expect(done.headChain).toEqual([item.input.submittedHead, done.head!])
    expect(done.userDecisions).toEqual([
      { reference: "captain-decision-1", action: "approve", gateStep: "review", findingIDs: [] },
    ])
    expect(registry.validation("task-1")).toMatchObject({
      sourceHead: done.head,
      runID: "01RUN",
      status: "passed",
      trusted: true,
    })
    const calls = readFileSync(path.join(item.root, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[])
    const launch = calls.find((args) => args[1] === "run")!
    expect(launch).toContain("--base-branch")
    expect(launch).toContain("integration-v2")
    expect(launch).toContain("--launch-nonce")
    expect(launch).toContain("--validation-generation")
    expect(launch).toContain("--intent")
    expect(launch).not.toContain("--yes")
    expect(calls.filter((args) => args[1] === "respond")).toHaveLength(1)
    expect(calls.flat().includes("--yes")).toBe(false)
  } finally {
    item.cleanup()
  }
}, 20_000)

test("a lost launch receipt persists unknown and never resubmits after reopen", async () => {
  const item = fixture()
  const calls: string[][] = []
  const runner: SupervisorValidation.Runner = async (_cwd, args) => {
    calls.push(args)
    if (args[0] === "status") return { code: 0, stdout: `  repo: ${item.repo}\nremote: ${item.origin}\n`, stderr: "" }
    return args[1] === "status"
      ? { code: 0, stdout: "help[1]:\n  No active run\n", stderr: "" }
      : { code: 1, stdout: "", stderr: "connection lost" }
  }
  try {
    const registry = SupervisorValidation.open(item.db, runner)
    const first = await registry.start(item.input)
    expect(first.state).toBe("unknown")
    expect(first.runID).toBeUndefined()
    expect(first.intentHash).toBe(createHash("sha256").update(item.input.intent).digest("hex"))
    const reopened = new DatabaseSync(path.join(item.root, "supervisor.sqlite"))
    try {
      const resumed = SupervisorValidation.open(reopened, runner)
      expect(await resumed.start(item.input)).toEqual(first)
      await expect(resumed.start({ ...item.input, generation: 2 })).rejects.toThrow("Earlier validation generation")
    } finally {
      reopened.close()
    }
    expect(calls.filter((args) => args[1] === "run")).toHaveLength(1)
  } finally {
    item.cleanup()
  }
})

test("registration preflight refuses a different PR target before any run", async () => {
  const item = fixture()
  const calls: string[][] = []
  const runner: SupervisorValidation.Runner = async (_cwd, args) => {
    calls.push(args)
    return {
      code: 0,
      stdout: `  repo: ${item.repo}\nremote: https://github.com/other/project.git\nfork: ${item.origin}\n`,
      stderr: "",
    }
  }
  try {
    const registry = SupervisorValidation.open(item.db, runner)
    await expect(registry.start(item.input)).rejects.toThrow("registered PR target")
    expect(calls).toEqual([["status"]])
    expect(registry.get(item.input.taskID)).toBeUndefined()
  } finally {
    item.cleanup()
  }
})

test("every gate response is write-ahead even without a user decision reference", async () => {
  const item = fixture()
  const calls: string[][] = []
  const head = git(item.repo, "rev-parse", "HEAD")
  const gate = `run:\n  id: run-1\n  branch: feature\n  head: ${head.slice(0, 12)}\ngate: review\n`
  const runner: SupervisorValidation.Runner = async (_cwd, args) => {
    calls.push(args)
    if (args[1] === "respond") return { code: -1, stdout: "", stderr: "lost response" }
    return { code: 0, stdout: gate, stderr: "" }
  }
  try {
    const registry = SupervisorValidation.open(item.db, runner)
    const record: SupervisorValidation.Record = {
      taskID: item.input.taskID,
      generation: 1,
      worktree: item.repo,
      origin: item.origin,
      baseBranch: "integration-v2",
      branch: "feature",
      nonce: "nonce-1",
      submittedHead: head,
      intentHash: createHash("sha256").update(item.input.intent).digest("hex"),
      runID: "run-1",
      state: "gate",
      head,
      headChain: [head],
      gateStep: "review",
      findings: [],
      rawOutput: gate,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    item.db
      .prepare(
        `INSERT INTO supervisor_validation
      (task_id, generation, nonce, submitted_head, intent_hash, run_id, state, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(record.taskID, 1, record.nonce, head, record.intentHash, record.runID!, "gate", JSON.stringify(record))
    const observed = await registry.respond({ taskID: "task-1", action: "approve" })
    expect(observed.state).toBe("gate")
    expect(observed.responseAttempts).toMatchObject([{ gateStep: "review", action: "approve" }])
    expect(observed.userDecisions).toBeUndefined()
    const reopened = new DatabaseSync(path.join(item.root, "supervisor.sqlite"))
    try {
      const resumed = SupervisorValidation.open(reopened, runner)
      await expect(resumed.respond({ taskID: "task-1", action: "approve" })).rejects.toThrow("uncertain outcome")
    } finally {
      reopened.close()
    }
    expect(calls.filter((args) => args[1] === "respond")).toHaveLength(1)
  } finally {
    item.cleanup()
  }
})

test("abort uses the installed exact-run command and never repeats an uncertain attempt", async () => {
  const item = fixture()
  const head = git(item.repo, "rev-parse", "HEAD")
  const calls: string[][] = []
  let cancelled = false
  const runner: SupervisorValidation.Runner = async (_cwd, args) => {
    calls.push(args)
    if (args[1] === "abort") {
      cancelled = true
      return { code: 0, stdout: "", stderr: "" }
    }
    return {
      code: 0,
      stdout: `run:\n  id: run-1\n  branch: feature\n  head: ${head.slice(0, 12)}\n${cancelled ? "outcome: cancelled\n" : ""}`,
      stderr: "",
    }
  }
  try {
    const registry = SupervisorValidation.open(item.db, runner)
    const record: SupervisorValidation.Record = {
      taskID: item.input.taskID,
      generation: 1,
      worktree: item.repo,
      origin: item.origin,
      baseBranch: "integration-v2",
      branch: "feature",
      nonce: "nonce-1",
      submittedHead: head,
      intentHash: createHash("sha256").update(item.input.intent).digest("hex"),
      runID: "run-1",
      state: "running",
      head,
      headChain: [head],
      findings: [],
      rawOutput: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    item.db
      .prepare(
        `INSERT INTO supervisor_validation
      (task_id, generation, nonce, submitted_head, intent_hash, run_id, state, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(record.taskID, 1, record.nonce, head, record.intentHash, record.runID!, "running", JSON.stringify(record))
    expect(await registry.abort("task-1")).toMatchObject({ state: "failed", outcome: "cancelled" })
    expect(calls.filter((args) => args[1] === "abort")).toEqual([["axi", "abort", "--run", "run-1"]])
    expect(await registry.abort("task-1")).toMatchObject({ outcome: "cancelled" })
    expect(calls.filter((args) => args[1] === "abort")).toHaveLength(1)
  } finally {
    item.cleanup()
  }
})

test("an unconfirmed abort remains a single durable attempt across reopen", async () => {
  const item = fixture()
  const head = git(item.repo, "rev-parse", "HEAD")
  const calls: string[][] = []
  const runner: SupervisorValidation.Runner = async (_cwd, args) => {
    calls.push(args)
    if (args[1] === "abort") return { code: -1, stdout: "", stderr: "connection lost" }
    return { code: 0, stdout: `run:\n  id: run-1\n  branch: feature\n  head: ${head.slice(0, 12)}\n`, stderr: "" }
  }
  try {
    const registry = SupervisorValidation.open(item.db, runner)
    const record: SupervisorValidation.Record = {
      taskID: item.input.taskID,
      generation: 1,
      worktree: item.repo,
      origin: item.origin,
      baseBranch: "integration-v2",
      branch: "feature",
      nonce: "nonce-1",
      submittedHead: head,
      intentHash: createHash("sha256").update(item.input.intent).digest("hex"),
      runID: "run-1",
      state: "running",
      head,
      headChain: [head],
      findings: [],
      rawOutput: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    item.db
      .prepare(
        `INSERT INTO supervisor_validation
      (task_id, generation, nonce, submitted_head, intent_hash, run_id, state, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(record.taskID, 1, record.nonce, head, record.intentHash, record.runID!, "running", JSON.stringify(record))
    await expect(registry.abort("task-1")).rejects.toThrow("no confirmed terminal outcome")
    const reopened = new DatabaseSync(path.join(item.root, "supervisor.sqlite"))
    try {
      const resumed = SupervisorValidation.open(reopened, runner)
      await expect(resumed.abort("task-1")).rejects.toThrow("no confirmed terminal outcome")
      expect(resumed.get("task-1")?.abortAttempt).toMatchObject({ runID: "run-1" })
    } finally {
      reopened.close()
    }
    expect(calls.filter((args) => args[1] === "abort")).toHaveLength(1)
  } finally {
    item.cleanup()
  }
})

test("validation launch rechecks authority after branch observation and before run", async () => {
  const item = fixture()
  const calls: string[][] = []
  let revoked = false
  const runner: SupervisorValidation.Runner = async (_cwd, args) => {
    calls.push(args)
    if (args[0] === "status") return { code: 0, stdout: `  repo: ${item.repo}\nremote: ${item.origin}\n`, stderr: "" }
    if (args[1] === "status") {
      revoked = true
      return { code: 0, stdout: "help[1]:\n  No active run\n", stderr: "" }
    }
    throw new Error("Run must not launch after revocation")
  }
  try {
    const registry = SupervisorValidation.open(item.db, runner)
    await expect(
      registry.start({
        ...item.input,
        beforeMutate: () => {
          if (revoked) throw new Error("Authority revoked")
        },
      }),
    ).rejects.toThrow("Authority revoked")
    expect(registry.get("task-1")).toBeUndefined()
    expect(calls.filter((args) => args[1] === "run")).toEqual([])
  } finally {
    item.cleanup()
  }
})
