import { createHash, randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

export namespace SupervisorValidation {
  export type State = "pending" | "running" | "gate" | "passed" | "failed" | "unknown"
  export type Finding = {
    id: string
    severity: string
    file: string
    line: string
    action: string
    description: string
  }
  export type Record = {
    taskID: string
    generation: number
    worktree: string
    origin: string
    baseBranch: string
    branch: string
    nonce: string
    submittedHead: string
    intentHash: string
    runID?: string
    state: State
    head?: string
    headChain: string[]
    pr?: string
    gateStep?: string
    findings: Finding[]
    userDecisions?: { reference: string; action: Response["action"]; gateStep: string; findingIDs: string[] }[]
    responseAttempts?: {
      gateStep: string
      action: Response["action"]
      findingIDs: string[]
      instructionsHash?: string
      at: number
    }[]
    abortAttempt?: { runID: string; at: number }
    outcome?: string
    rawOutput: string
    error?: string
    createdAt: number
    updatedAt: number
  }
  export type Start = {
    taskID: string
    generation: number
    worktree: string
    origin: string
    submittedHead: string
    intent: string
    baseBranch: string
    beforeMutate?: () => void
  }
  export type Response = {
    taskID: string
    generation?: number
    action: "approve" | "fix" | "skip"
    findingIDs?: string[]
    instructions?: string
    userDecisionReference?: string
    beforeMutate?: () => void
  }
  export type Runner = (cwd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

  type Row = { record: string }
  const outputLimit = 256 * 1024

  /** Uses the caller's workflow DatabaseSync and lifetime. One workflow writer owns this connection. */
  export function open(db: DatabaseSync, runner: Runner = run) {
    db.exec(`CREATE TABLE IF NOT EXISTS supervisor_validation (
      task_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      nonce TEXT NOT NULL UNIQUE,
      submitted_head TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      run_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'gate', 'passed', 'failed', 'unknown')),
      record TEXT NOT NULL,
      PRIMARY KEY (task_id, generation)
    )`)

    function get(taskID: string, generation?: number): Record | undefined {
      const row = db
        .prepare(
          `SELECT record FROM supervisor_validation WHERE task_id = ?
        AND (? IS NULL OR generation = ?) ORDER BY generation DESC LIMIT 1`,
        )
        .get(taskID, generation ?? null, generation ?? null) as Row | undefined
      return row ? (JSON.parse(row.record) as Record) : undefined
    }

    function list(): Record[] {
      return (db.prepare("SELECT record FROM supervisor_validation ORDER BY task_id, generation").all() as Row[]).map(
        (row) => JSON.parse(row.record) as Record,
      )
    }

    function save(record: Record) {
      db.prepare(
        `UPDATE supervisor_validation SET run_id = ?, state = ?, record = ?
        WHERE task_id = ? AND generation = ?`,
      ).run(record.runID ?? null, record.state, JSON.stringify(record), record.taskID, record.generation)
      return record
    }

    async function start(input: Start): Promise<Record> {
      requireStart(input)
      const existing = get(input.taskID, input.generation)
      const intentHash = createHash("sha256").update(input.intent).digest("hex")
      if (existing) {
        if (
          existing.worktree !== input.worktree ||
          existing.origin !== input.origin ||
          existing.baseBranch !== input.baseBranch ||
          existing.submittedHead !== input.submittedHead ||
          existing.intentHash !== intentHash
        )
          throw new Error("Conflicting validation generation")
        // A lost launch reply may already have started the daemon run. Never submit it again.
        return existing.runID ? status(input.taskID, input.generation) : existing
      }
      if (
        list().some(
          (item) => item.taskID === input.taskID && ["pending", "running", "gate", "unknown"].includes(item.state),
        )
      )
        throw new Error("Earlier validation generation is still active or has an unknown outcome")
      const worktree = await realpath(input.worktree)
      if (worktree !== input.worktree || (await git(worktree, ["rev-parse", "--show-toplevel"])) !== worktree)
        throw new Error("Validation requires the canonical Git worktree root")
      if ((await git(worktree, ["rev-parse", "HEAD"])) !== input.submittedHead)
        throw new Error("Validation submitted HEAD differs from the worktree")
      if ((await git(worktree, ["remote", "get-url", "origin"])) !== input.origin)
        throw new Error("Validation origin differs from the recorded project source")
      if (/(?:^|[:/])anomalyco\/opencode(?:\.git)?$/i.test(input.origin))
        throw new Error("Upstream OpenCode PR target requires an explicit separate approval")
      // no-mistakes opens its PR against the registered upstream_url, even when
      // the worktree origin points at a fork. Require the registered target to
      // be this exact origin and reject fork registrations before launching.
      const registration = await runner(worktree, ["status"])
      const registeredRepo = /^\s*repo:\s+(.+)$/m.exec(registration.stdout)?.[1]?.trim()
      const registeredRemote = /^\s*remote:\s+(.+)$/m.exec(registration.stdout)?.[1]?.trim()
      const registeredFork = /^\s*fork:\s+(.+)$/m.exec(registration.stdout)?.[1]?.trim()
      const mainWorktree = /^worktree (.+)$/m.exec(await git(worktree, ["worktree", "list", "--porcelain"]))?.[1]
      if (
        registration.code !== 0 ||
        !registeredRepo ||
        ![worktree, mainWorktree].includes(registeredRepo) ||
        registeredRemote !== input.origin ||
        registeredFork
      )
        throw new Error("No-mistakes registered PR target must be the exact task origin without a separate fork")
      const branch = await git(worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      const before = await runner(worktree, ["axi", "status"])
      const prior = parseStatus(before.stdout)
      if (
        (before.code !== 0 && !["failed", "cancelled"].includes(prior?.outcome ?? "")) ||
        /^error:/m.test(before.stdout)
      )
        throw new Error("Cannot establish the current no-mistakes branch state")
      if (
        prior &&
        !["passed", "failed", "cancelled", "passed-with-skips", "checks-passed"].includes(prior.outcome ?? "")
      )
        throw new Error(`Another no-mistakes run is active on ${branch}: ${prior.runID}`)
      const now = Date.now()
      const record: Record = {
        taskID: input.taskID,
        generation: input.generation,
        worktree,
        origin: input.origin,
        baseBranch: input.baseBranch,
        branch,
        nonce: randomUUID(),
        submittedHead: input.submittedHead,
        intentHash,
        state: "pending",
        headChain: [input.submittedHead],
        findings: [],
        rawOutput: "",
        createdAt: now,
        updatedAt: now,
      }
      input.beforeMutate?.()
      db.prepare(
        `INSERT INTO supervisor_validation
        (task_id, generation, nonce, submitted_head, intent_hash, run_id, state, record)
        VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?)`,
      ).run(
        record.taskID,
        record.generation,
        record.nonce,
        record.submittedHead,
        record.intentHash,
        JSON.stringify(record),
      )
      const result = await runner(worktree, [
        "axi",
        "run",
        "--intent",
        input.intent,
        "--base-branch",
        input.baseBranch,
        "--launch-nonce",
        record.nonce,
        "--validation-generation",
        String(record.generation),
        "--wait",
        "60s",
      ]).catch((error) => ({ code: -1, stdout: "", stderr: String(error) }))
      const rawOutput = bounded(result.stdout)
      const receipt = result.stdout.length <= outputLimit ? parseReceipt(result.stdout) : undefined
      if (
        !receipt ||
        receipt.runID === "" ||
        receipt.nonce !== record.nonce ||
        receipt.generation !== String(record.generation) ||
        receipt.branch !== record.branch ||
        receipt.submittedHead !== record.submittedHead ||
        receipt.head !== record.submittedHead ||
        receipt.intentHash !== record.intentHash ||
        !["created", "reused"].includes(receipt.disposition)
      )
        return save({
          ...record,
          state: "unknown",
          rawOutput,
          error: "No matching pre-drive launch receipt; inspect the pipeline before any retry",
          updatedAt: Date.now(),
        })
      const bound = save({ ...record, runID: receipt.runID, state: "running", rawOutput, updatedAt: Date.now() })
      return status(bound.taskID, bound.generation)
    }

    async function status(taskID: string, generation?: number): Promise<Record> {
      const current = get(taskID, generation)
      if (!current) throw new Error(`Unknown validation: ${taskID}`)
      if (!current.runID) return current
      const result = await runner(current.worktree, ["axi", "status", "--run", current.runID]).catch((error) => ({
        code: -1,
        stdout: "",
        stderr: String(error),
      }))
      return inspect(current, result)
    }

    async function respond(input: Response): Promise<Record> {
      const current = await status(input.taskID, input.generation)
      if (current.state !== "gate" || !current.gateStep || !current.runID)
        throw new Error("Validation is not at a proven decision gate")
      if (current.responseAttempts?.some((attempt) => attempt.gateStep === current.gateStep))
        throw new Error("Prior response at this gate has an uncertain outcome; inspect the pipeline before retry")
      const implicit = await runner(current.worktree, ["axi", "status"])
      const active = parseStatus(implicit.stdout)
      if (implicit.code !== 0 || active?.runID !== current.runID || active.gateStep !== current.gateStep)
        throw new Error("Current-branch gate differs from the recorded validation run")
      if (current.findings.some((item) => item.action === "ask-user") && !input.userDecisionReference)
        throw new Error("Ask-user findings require a recorded user decision reference")
      if (input.action === "fix" && !input.findingIDs?.length) throw new Error("Fix requires finding IDs")
      if (input.findingIDs?.some((id) => !current.findings.some((item) => item.id === id)))
        throw new Error("Finding ID is absent from the current gate")
      input.beforeMutate?.()
      save({
        ...current,
        responseAttempts: [
          ...(current.responseAttempts ?? []),
          {
            gateStep: current.gateStep,
            action: input.action,
            findingIDs: input.findingIDs ?? [],
            instructionsHash: input.instructions
              ? createHash("sha256").update(input.instructions).digest("hex")
              : undefined,
            at: Date.now(),
          },
        ],
        userDecisions: input.userDecisionReference
          ? [
              ...(current.userDecisions ?? []),
              {
                reference: input.userDecisionReference,
                action: input.action,
                gateStep: current.gateStep,
                findingIDs: input.findingIDs ?? [],
              },
            ]
          : current.userDecisions,
        updatedAt: Date.now(),
      })
      const args = ["axi", "respond", "--action", input.action, "--step", current.gateStep, "--wait", "60s"]
      if (input.action === "fix") args.push("--findings", input.findingIDs!.join(","))
      if (input.instructions) args.push("--instructions", input.instructions)
      const result = await runner(current.worktree, args).catch((error) => ({
        code: -1,
        stdout: "",
        stderr: String(error),
      }))
      // Respond may return at the next gate or after the wait. Re-read the exact run.
      const observed = await status(current.taskID, current.generation)
      return save({ ...observed, rawOutput: bounded(result.stdout || observed.rawOutput) })
    }

    async function abort(taskID: string, generation?: number, beforeMutate?: () => void): Promise<Record> {
      const current = await status(taskID, generation)
      if (!current.runID) throw new Error("Validation launch has no proven run ID; cancellation outcome is unknown")
      if (current.outcome === "cancelled") return current
      if (current.state === "passed" || current.state === "failed") return current
      if (!current.abortAttempt) {
        beforeMutate?.()
        save({ ...current, abortAttempt: { runID: current.runID, at: Date.now() }, updatedAt: Date.now() })
        await runner(current.worktree, ["axi", "abort", "--run", current.runID]).catch(() => undefined)
      }
      const observed = await status(taskID, generation)
      if (observed.outcome !== "cancelled")
        throw new Error("Pipeline cancellation has no confirmed terminal outcome; inspect the run before retry")
      return observed
    }

    function validation(taskID: string, generation?: number) {
      const current = get(taskID, generation)
      if (!current?.runID) return undefined
      return {
        sourceHead: current.head ?? current.submittedHead,
        runID: current.runID,
        status:
          current.state === "passed"
            ? ("passed" as const)
            : current.state === "gate" && current.findings.some((item) => item.action === "ask-user")
              ? ("ask-user" as const)
              : current.state === "failed"
                ? ("failed" as const)
                : ("pending" as const),
        trusted: current.state === "passed" && Boolean(current.head),
        askUserFindings: current.findings
          .filter((item) => item.action === "ask-user")
          .map((item) => JSON.stringify(item)),
      }
    }

    async function inspect(current: Record, result: { code: number; stdout: string; stderr: string }): Promise<Record> {
      const rawOutput = bounded(result.stdout)
      const parsed = result.stdout.length <= outputLimit ? parseStatus(result.stdout) : undefined
      if (!parsed || parsed.runID !== current.runID || parsed.branch !== current.branch)
        return save({
          ...current,
          state: "unknown",
          rawOutput,
          error: "Status did not identify the recorded run and branch",
          updatedAt: Date.now(),
        })
      const head = await resolveHead(current.worktree, parsed.head)
      if (!head)
        return save({
          ...current,
          state: "unknown",
          rawOutput,
          error: "Pipeline head could not be resolved to a full local Git commit",
          updatedAt: Date.now(),
        })
      if (parsed.pr && (!parsed.pr.startsWith("https://") || !URL.canParse(parsed.pr)))
        return save({
          ...current,
          state: "unknown",
          rawOutput,
          error: "Invalid pipeline PR URL",
          updatedAt: Date.now(),
        })
      const state: State = parsed.gateStep
        ? "gate"
        : result.code === 0 && ["checks-passed", "passed"].includes(parsed.outcome ?? "")
          ? "passed"
          : ["failed", "cancelled", "passed-with-skips"].includes(parsed.outcome ?? "")
            ? "failed"
            : result.code === 0
              ? "running"
              : "unknown"
      return save({
        ...current,
        state,
        outcome: parsed.outcome,
        head,
        headChain: current.headChain.includes(head) ? current.headChain : [...current.headChain, head],
        pr: parsed.pr,
        gateStep: parsed.gateStep,
        findings: parsed.findings,
        rawOutput,
        error: state === "unknown" ? "Pipeline status could not be classified" : undefined,
        updatedAt: Date.now(),
      })
    }

    return { get, list, start, status, refresh: status, respond, abort, validation }
  }
}

function requireStart(input: SupervisorValidation.Start) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.taskID) ||
    !Number.isInteger(input.generation) ||
    input.generation < 1
  )
    throw new Error("Validation requires a task ID and positive generation")
  if (!/^[0-9a-f]{40,64}$/.test(input.submittedHead)) throw new Error("Validation requires a full submitted HEAD")
  if (
    !input.intent.trim() ||
    !input.origin ||
    !input.baseBranch ||
    input.baseBranch.startsWith("-") ||
    /[\0\r\n]/.test(input.baseBranch)
  )
    throw new Error("Validation requires intent, recorded origin, and explicit base branch")
}

type Receipt = {
  runID: string
  disposition: string
  nonce: string
  generation: string
  branch: string
  head: string
  submittedHead: string
  intentHash: string
}

function parseReceipt(output: string): Receipt | undefined {
  const block = section(output, "launch_receipt")
  if (!block) return undefined
  const runID = field(block, "run_id")
  const disposition = field(block, "disposition")
  const nonce = field(block, "launch_nonce")
  const generation = field(block, "validation_generation")
  const branch = field(block, "branch")
  const head = field(block, "head_sha")
  const submittedHead = field(block, "submitted_head_sha")
  const intentHash = field(block, "intent_digest")
  if (
    !runID ||
    !disposition ||
    !nonce ||
    !generation ||
    !branch ||
    !head ||
    !submittedHead ||
    !intentHash ||
    !/^[0-9a-f]{40,64}$/.test(head) ||
    !/^[0-9a-f]{40,64}$/.test(submittedHead) ||
    !/^[0-9a-f]{64}$/.test(intentHash)
  )
    return undefined
  return { runID, disposition, nonce, generation, branch, head, submittedHead, intentHash }
}

type Status = {
  runID: string
  branch: string
  head: string
  pr?: string
  outcome?: string
  gateStep?: string
  findings: SupervisorValidation.Finding[]
}

function parseStatus(output: string): Status | undefined {
  const run = section(output, "run")
  if (!run || /^other_branch_run:/m.test(output) || /^error:/m.test(output)) return undefined
  const runID = field(run, "id")
  const branch = field(run, "branch")
  const head = field(run, "head")
  if (!runID || !branch || !head || !/^[0-9a-f]{7,64}$/.test(head)) return undefined
  const gateLine = output.match(/^gate:\s*(\S+)?\s*$/m)?.[1]
  const gateStep = gateLine || (section(output, "gate") ? field(section(output, "gate")!, "step") : undefined)
  const findings = parseFindings(output)
  if (!findings) return undefined
  return {
    runID,
    branch,
    head,
    pr: field(run, "pr") || undefined,
    outcome: output.match(/^outcome:\s*(\S+)\s*$/m)?.[1],
    gateStep,
    findings,
  }
}

function parseFindings(output: string): SupervisorValidation.Finding[] | undefined {
  const lines = output.split(/\r?\n/)
  const header = lines.findIndex((line) => /^\s*findings\[\d+\]\{[^}]+\}:$/.test(line))
  if (header < 0) return []
  const match = lines[header].match(/^(\s*)findings\[(\d+)\]\{([^}]+)\}:$/)
  if (!match) return undefined
  const columns = match[3].split(",")
  const rows = lines.slice(header + 1, header + 1 + Number(match[2]))
  const findings = rows.map((line) => {
    if (!line.startsWith(`${match[1]}  `)) return undefined
    const cells = csv(line.trimStart())
    if (!cells || cells.length !== columns.length) return undefined
    const value = Object.fromEntries(columns.map((name, index) => [name, cells[index]]))
    if (!value.id || !value.action || !value.description) return undefined
    return {
      id: value.id,
      severity: value.severity ?? "",
      file: value.file ?? "",
      line: value.line ?? "",
      action: value.action,
      description: value.description,
    }
  })
  return findings.every((item): item is SupervisorValidation.Finding => Boolean(item)) ? findings : undefined
}

function csv(line: string): string[] | undefined {
  const result: string[] = []
  let value = ""
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index++
        continue
      }
      quoted = !quoted
      continue
    }
    if (char === "," && !quoted) {
      result.push(value)
      value = ""
      continue
    }
    value += char
  }
  if (quoted) return undefined
  result.push(value)
  return result
}

function section(output: string, key: string) {
  const lines = output.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `${key}:`)
  if (start < 0) return undefined
  const end = lines.findIndex((line, index) => index > start && /^[a-z_]+:/.test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n")
}

function field(block: string, key: string) {
  const raw = block.match(new RegExp(`^  ${key}:\\s*(.*)$`, "m"))?.[1]?.trim()
  if (!raw) return undefined
  if (!raw.startsWith('"')) return raw
  try {
    return JSON.parse(raw) as string
  } catch {
    return undefined
  }
}

async function resolveHead(worktree: string, value: string) {
  if (!/^[0-9a-f]{7,64}$/.test(value)) return undefined
  const full = await git(worktree, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`], true)
  return full && /^[0-9a-f]{40,64}$/.test(full) && full.startsWith(value) ? full : undefined
}

async function git(worktree: string, args: string[], optional = false): Promise<string> {
  const child = Bun.spawnSync(["git", "-C", worktree, ...args], { stdout: "pipe", stderr: "pipe" })
  if (child.exitCode !== 0) {
    if (optional) return ""
    throw new Error(`Git ${args[0]} failed: ${new TextDecoder().decode(child.stderr).trim()}`)
  }
  return new TextDecoder().decode(child.stdout).trim()
}

function bounded(output: string) {
  return output.slice(0, 256 * 1024)
}

async function run(cwd: string, args: string[]) {
  const binary = Bun.which("no-mistakes")
  if (!binary) throw new Error("no-mistakes CLI is not installed")
  const child = Bun.spawn([binary, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(67_000),
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}
