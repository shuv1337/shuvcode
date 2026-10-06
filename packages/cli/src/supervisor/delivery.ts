import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

export namespace SupervisorDelivery {
  export type Mode = "no-mistakes" | "direct-PR" | "local-only"
  export type MergePolicy = "manual" | "auto"
  export type Status = "pending" | "validating" | "ready" | "landed" | "blocked" | "cancelled"
  export type Approval = {
    source: "captain"
    reference: string
    approvedAt: string
    sourceHead: string
    targetHead: string
  }
  export type Validation = {
    sourceHead: string
    runID: string
    status: "passed" | "pending" | "failed" | "ask-user"
    trusted: boolean
    askUserFindings: string[]
  }
  export type Check = { name: string; state: string; bucket: "pass" | "pending" | "fail" | "skipping" | "cancel" }
  export type Checks = { sourceHead: string; status: "empty" | "pending" | "failed" | "passed"; required: Check[] }
  export type PR = {
    url: string
    repo: string
    number: number
    head: string
    headBranch?: string
    base: string
    baseHead: string
    state: "OPEN" | "CLOSED" | "MERGED"
    mergeCommit?: string
  }
  export type Landing = { kind: "local" | "pr"; sourceHead: string; targetHead: string; mergeCommit: string }
  export type Record = {
    taskID: string
    mode: Mode
    mergePolicy: MergePolicy
    policyProvenance: { source: "captain" | "registry"; reference: string; capturedAt: string }
    status: Status
    targetRef: string
    sourceHead?: string
    targetHead?: string
    pr?: PR
    checks?: Checks
    validation?: Validation
    approval?: Approval
    landing?: Landing
    cancellation?: {
      source: "operator" | "lead"
      at: string
      validationRunID?: string
      validationOutcome?: string
      prURL?: string
      prState?: "CLOSED"
    }
    blocker?: string
  }
  export type Task = { id: string; kind: "ship" | "scout"; project: string; worktree: string; branch: string }
  export type GhRunner = (cwd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

  export class Error extends globalThis.Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly detail?: string,
    ) {
      super(message)
      this.name = "SupervisorDelivery.Error"
    }
  }

  // Called with the workflow DatabaseSync, never a separate delivery database.
  export function open(db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS supervisor_delivery (
      task_id TEXT PRIMARY KEY REFERENCES task(id),
      status TEXT NOT NULL CHECK (status IN ('pending', 'validating', 'ready', 'landed', 'blocked', 'cancelled')),
      record TEXT NOT NULL
    )`)
    const table = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'supervisor_delivery'")
      .get() as { sql: string }
    if (!table.sql.includes("'cancelled'"))
      db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE supervisor_delivery_next (
        task_id TEXT PRIMARY KEY REFERENCES task(id),
        status TEXT NOT NULL CHECK (status IN ('pending', 'validating', 'ready', 'landed', 'blocked', 'cancelled')),
        record TEXT NOT NULL
      );
      INSERT INTO supervisor_delivery_next SELECT task_id, status, record FROM supervisor_delivery;
      DROP TABLE supervisor_delivery;
      ALTER TABLE supervisor_delivery_next RENAME TO supervisor_delivery;
      COMMIT;
    `)
    function get(taskID: string): Record | undefined {
      const row = db.prepare("SELECT record FROM supervisor_delivery WHERE task_id = ?").get(taskID) as
        | { record: string }
        | undefined
      return row ? (JSON.parse(row.record) as Record) : undefined
    }
    function list(): Record[] {
      return (db.prepare("SELECT record FROM supervisor_delivery ORDER BY task_id").all() as { record: string }[]).map(
        (row) => JSON.parse(row.record) as Record,
      )
    }
    function record(next: Record): Record {
      requireRecord(next)
      const previous = get(next.taskID)
      if (previous?.status === "landed" || previous?.status === "cancelled") {
        if (JSON.stringify(previous) === JSON.stringify(next)) return previous
        throw new Error("terminal_immutable", "A landed or cancelled delivery record cannot change")
      }
      if (
        previous &&
        (previous.mode !== next.mode ||
          previous.mergePolicy !== next.mergePolicy ||
          previous.targetRef !== next.targetRef ||
          JSON.stringify(previous.policyProvenance) !== JSON.stringify(next.policyProvenance))
      )
        throw new Error("intake_immutable", "Delivery mode, merge authority, and target are fixed at intake")
      if (next.status === "ready" || next.status === "landed") {
        const gate = assess(next)
        if (!gate.ready) throw new Error("not_ready", `Delivery gate is not satisfied: ${gate.reason}`)
      }
      if (next.status === "landed" && !next.landing)
        throw new Error("missing_landing", "Landed delivery requires a landing proof")
      if (next.status === "cancelled" && !next.cancellation)
        throw new Error("missing_cancellation", "Cancelled delivery requires a cancellation proof")
      if (next.status !== "cancelled" && next.cancellation)
        throw new Error("premature_cancellation", "Cancellation proof requires cancelled status")
      if (next.status !== "landed" && next.landing)
        throw new Error("premature_landing", "Landing proof requires landed status")
      if (
        next.landing &&
        (next.landing.sourceHead !== next.sourceHead ||
          next.landing.targetHead !== next.targetHead ||
          !validHead(next.landing.mergeCommit) ||
          (next.mode === "local-only") !== (next.landing.kind === "local"))
      )
        throw new Error("invalid_landing", "Landing proof does not match the approved source, target, or mode")
      db.prepare(
        `INSERT INTO supervisor_delivery (task_id, status, record) VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET status = excluded.status, record = excluded.record`,
      ).run(next.taskID, next.status, JSON.stringify(next))
      return next
    }
    return { get, list, record }
  }

  export function assess(record: Record): { ready: true } | { ready: false; reason: string } {
    if (record.status === "cancelled") return { ready: false, reason: "cancelled" }
    if (!record.sourceHead || !validHead(record.sourceHead)) return { ready: false, reason: "source_head" }
    if (!record.targetHead || !validHead(record.targetHead)) return { ready: false, reason: "target_head" }
    if (record.blocker) return { ready: false, reason: "blocked" }
    if (
      record.mergePolicy === "manual" &&
      (!record.approval ||
        !record.approval.reference ||
        record.approval.source !== "captain" ||
        record.approval.sourceHead !== record.sourceHead ||
        record.approval.targetHead !== record.targetHead)
    )
      return { ready: false, reason: "approval" }
    if (record.mode === "local-only") {
      if (record.pr || record.checks) return { ready: false, reason: "unexpected_pr" }
      return { ready: true }
    }
    if (
      !record.pr ||
      record.pr.state !== "OPEN" ||
      record.pr.head !== record.sourceHead ||
      record.pr.baseHead !== record.targetHead
    )
      return { ready: false, reason: "pr_head" }
    if (!record.checks || record.checks.sourceHead !== record.sourceHead) return { ready: false, reason: "checks_head" }
    if (record.checks.status !== "passed" && record.checks.status !== "empty")
      return { ready: false, reason: `checks_${record.checks.status}` }
    if (record.mode === "no-mistakes") {
      if (
        !record.validation ||
        record.validation.sourceHead !== record.sourceHead ||
        !record.validation.runID ||
        record.validation.status !== "passed" ||
        !record.validation.trusted ||
        record.validation.askUserFindings.length > 0
      )
        return { ready: false, reason: "validation" }
    }
    return { ready: true }
  }

  export async function inspect(input: { task: Task; targetRef: string }) {
    const project = await canonicalProject(input.task.project)
    const worktree = await realpath(input.task.worktree)
    if (project !== input.task.project || worktree !== input.task.worktree)
      throw new Error("path_mismatch", "Task paths must be canonical")
    if ((await git(project, ["rev-parse", "--show-toplevel"])) !== project)
      throw new Error("project_mismatch", "Project is not the canonical repository root")
    if ((await git(worktree, ["rev-parse", "--show-toplevel"])) !== worktree)
      throw new Error("worktree_mismatch", "Task worktree is not registered at its recorded path")
    if ((await git(worktree, ["symbolic-ref", "--quiet", "HEAD"])) !== `refs/heads/${input.task.branch}`)
      throw new Error("branch_mismatch", "Task worktree changed branch")
    if ((await git(worktree, ["status", "--porcelain=v1", "--untracked-files=all"])) !== "")
      throw new Error("source_dirty", "Task worktree has uncommitted or untracked payload")
    if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.targetRef) || input.targetRef.includes(".."))
      throw new Error("invalid_target_ref", "Target must be an explicit local branch ref")
    const sourceHead = await git(worktree, ["rev-parse", "HEAD"])
    const targetHead = await git(project, ["rev-parse", "--verify", `${input.targetRef}^{commit}`])
    if (!validHead(sourceHead) || !validHead(targetHead))
      throw new Error("invalid_head", "Git returned an invalid commit")
    return { project, worktree, sourceHead, targetHead, targetRef: input.targetRef }
  }

  export function parsePRUrl(url: string, originRepo: string) {
    const parsed = new URL(url)
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.port ||
      parsed.pathname.endsWith("/")
    )
      throw new Error("invalid_pr_url", "PR URL must be a canonical HTTPS GitHub pull request URL")
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(parsed.pathname)
    if (!match || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) < 1)
      throw new Error("invalid_pr_url", "PR URL must identify one GitHub pull request")
    const repo = `${parsed.host}/${match[1]}/${match[2]}`
    if (repo !== originRepo) throw new Error("wrong_pr_repo", "PR must target the task project's origin repository")
    return { url: parsed.href, repo, number: Number(match[3]), base: match[2] }
  }

  export async function originRepo(project: string) {
    const canonical = await canonicalProject(project)
    const remote = await git(canonical, ["remote", "get-url", "origin"])
    const match = /^(?:https:\/\/([^/]+)\/|git@([^:]+):)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote)
    if (!match) throw new Error("invalid_origin", "Origin must be a GitHub repository URL")
    return `${match[1] ?? match[2]}/${match[3]}/${match[4]}`
  }

  export async function readPR(input: { project: string; url: string; runGh?: GhRunner }): Promise<PR> {
    const project = await canonicalProject(input.project)
    const expected = parsePRUrl(input.url, await originRepo(project))
    const output = await (input.runGh ?? gh)(project, [
      "pr",
      "view",
      expected.url,
      "--json",
      "url,number,headRefName,headRefOid,baseRefName,baseRefOid,baseRepository,state,mergeCommit",
    ])
    if (output.code !== 0) throw new Error("gh_failed", "Could not read pull request", output.stderr)
    const value = JSON.parse(output.stdout) as {
      url?: string
      number?: number
      headRefOid?: string
      headRefName?: string
      baseRefName?: string
      baseRefOid?: string
      baseRepository?: { nameWithOwner?: string }
      state?: PR["state"]
      mergeCommit?: { oid?: string } | null
    }
    if (
      value.url !== expected.url ||
      value.number !== expected.number ||
      !validHead(value.headRefOid) ||
      !validHead(value.baseRefOid) ||
      !value.baseRefName ||
      value.baseRepository?.nameWithOwner !== expected.repo.slice(expected.repo.indexOf("/") + 1) ||
      !["OPEN", "CLOSED", "MERGED"].includes(value.state ?? "")
    )
      throw new Error("pr_identity_mismatch", "Forge PR identity or head differs from the requested origin PR")
    return {
      url: expected.url,
      repo: expected.repo,
      number: expected.number,
      head: value.headRefOid,
      ...(value.headRefName ? { headBranch: value.headRefName } : {}),
      base: value.baseRefName,
      baseHead: value.baseRefOid,
      state: value.state!,
      ...(value.mergeCommit?.oid ? { mergeCommit: value.mergeCommit.oid } : {}),
    }
  }

  /** Close only the exact owned PR; repeated explicit cancellation first observes its current state. */
  export async function closePR(input: {
    task: Task
    record: Record
    runGh?: GhRunner
    beforeMutate?: () => void
  }): Promise<PR> {
    const expected = input.record.pr
    if (!expected || !input.record.sourceHead)
      throw new Error("missing_pr", "Cancellation requires a saved PR identity")
    const current = await readPR({ project: input.task.project, url: expected.url, runGh: input.runGh })
    if (
      current.url !== expected.url ||
      current.repo !== expected.repo ||
      current.number !== expected.number ||
      current.head !== expected.head ||
      current.head !== input.record.sourceHead ||
      current.headBranch !== input.task.branch ||
      current.base !== input.record.targetRef.slice("refs/heads/".length)
    )
      throw new Error("pr_identity_mismatch", "Cancellation PR branch, repository, or exact HEAD changed")
    if (current.state === "MERGED")
      throw new Error("already_merged", "PR has merged; reconcile landing instead of cancelling")
    if (current.state === "CLOSED") return current
    input.beforeMutate?.()
    await (input.runGh ?? gh)(input.task.project, [
      "pr",
      "close",
      current.url,
      "--repo",
      current.repo.slice(current.repo.indexOf("/") + 1),
    ])
    const closed = await readPR({ project: input.task.project, url: current.url, runGh: input.runGh })
    if (
      closed.state !== "CLOSED" ||
      closed.url !== current.url ||
      closed.repo !== current.repo ||
      closed.number !== current.number ||
      closed.head !== current.head ||
      closed.headBranch !== current.headBranch
    )
      throw new Error(
        "close_unknown",
        "PR close has no exact-identity CLOSED proof; retry explicit cancellation after inspection",
      )
    return closed
  }

  export async function readChecks(input: { project: string; pr: PR; runGh?: GhRunner }): Promise<Checks> {
    const project = await canonicalProject(input.project)
    parsePRUrl(input.pr.url, await originRepo(project))
    const output = await (input.runGh ?? gh)(project, ["pr", "checks", input.pr.url, "--json", "name,state,bucket"])
    if (![0, 1, 8].includes(output.code)) throw new Error("gh_failed", "Could not read PR checks", output.stderr)
    const rows = JSON.parse(output.stdout) as { name?: string; state?: string; bucket?: Check["bucket"] }[]
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !row.name || !row.state || !["pass", "pending", "fail", "skipping", "cancel"].includes(row.bucket ?? ""),
      )
    )
      throw new Error("invalid_checks", "Forge returned invalid required-check evidence")
    const required = rows as Check[]
    return {
      sourceHead: input.pr.head,
      status:
        required.length === 0
          ? "empty"
          : required.some((row) => row.bucket === "fail" || row.bucket === "cancel")
            ? "failed"
            : required.some((row) => row.bucket === "pending")
              ? "pending"
              : "passed",
      required,
    }
  }

  /** The origin branch and origin repository are the only direct-publish destination. */
  export async function publish(input: {
    task: Task
    record: Record
    title: string
    body: string
    inspectOnly?: boolean
    runGh?: GhRunner
    beforeMutate?: () => void
  }) {
    if (input.task.kind !== "ship" || input.record.taskID !== input.task.id || input.record.mode !== "direct-PR")
      throw new Error("wrong_mode", "Direct publishing requires this ship task's direct-PR record")
    if (!/^(feat|fix|docs|chore|refactor|test)(\([a-z0-9-]+\))?: .+/.test(input.title))
      throw new Error("invalid_title", "PR title must use conventional commit style")
    const state = await inspect({ task: input.task, targetRef: input.record.targetRef })
    if (state.sourceHead !== input.record.sourceHead || state.targetHead !== input.record.targetHead)
      throw new Error("head_changed", "Source or target HEAD changed since preparation")
    const repo = await originRepo(state.project)
    if (!repo.startsWith("github.com/")) throw new Error("invalid_origin", "Direct publishing requires a GitHub origin")
    if (repo.toLowerCase() === "github.com/anomalyco/opencode")
      throw new Error("upstream_forbidden", "Publishing to upstream OpenCode requires a separate explicit override")
    const base = state.targetRef.slice("refs/heads/".length)
    const branch = input.task.branch
    const runGh = input.runGh ?? gh
    const list = await runGh(state.project, [
      "pr",
      "list",
      "--repo",
      repo.slice("github.com/".length),
      "--head",
      branch,
      "--base",
      base,
      "--state",
      "all",
      "--json",
      "url,headRefName,headRefOid,baseRefName,baseRefOid,state,isCrossRepository",
    ])
    if (list.code !== 0) throw new Error("gh_failed", "Could not inspect origin pull requests", list.stderr)
    const rows = JSON.parse(list.stdout) as {
      url?: string
      headRefName?: string
      headRefOid?: string
      baseRefName?: string
      baseRefOid?: string
      state?: PR["state"]
      isCrossRepository?: boolean
    }[]
    if (!Array.isArray(rows)) throw new Error("invalid_pr_list", "Forge returned an invalid pull request list")
    const matching = rows.filter((row) => row.headRefName === branch && row.baseRefName === base)
    if (
      matching.some(
        (row) => row.isCrossRepository || row.headRefOid !== state.sourceHead || row.baseRefOid !== state.targetHead,
      )
    )
      throw new Error("pr_conflict", "Origin branch has a PR with a different repository or HEAD")
    if (matching.length > 1) throw new Error("pr_conflict", "Origin branch has more than one matching PR")
    if (matching[0]) {
      if (matching[0].state !== "OPEN" || !matching[0].url)
        throw new Error("pr_conflict", "Origin branch PR is not open")
      return readPR({ project: state.project, url: matching[0].url, runGh })
    }
    if (input.inspectOnly) throw new Error("publish_unknown", "No exact origin PR proves the earlier publish outcome")
    input.beforeMutate?.()
    await git(state.worktree, ["push", "origin", `HEAD:refs/heads/${branch}`])
    const directory = await mkdtemp(join(tmpdir(), "shuvcode-pr-"))
    try {
      const bodyFile = join(directory, "body.md")
      await writeFile(bodyFile, input.body, { mode: 0o600 })
      input.beforeMutate?.()
      const created = await runGh(state.project, [
        "pr",
        "create",
        "--repo",
        repo.slice("github.com/".length),
        "--head",
        branch,
        "--base",
        base,
        "--title",
        input.title,
        "--body-file",
        bodyFile,
      ])
      if (created.code !== 0)
        throw new Error("publish_unknown", "PR creation outcome requires inspection", created.stderr)
      const url = created.stdout.trim()
      parsePRUrl(url, repo)
      const pr = await readPR({ project: state.project, url, runGh })
      if (pr.head !== state.sourceHead || pr.baseHead !== state.targetHead || pr.base !== base || pr.state !== "OPEN")
        throw new Error("pr_identity_mismatch", "New PR does not match the exact prepared source and target")
      return pr
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  export async function landLocal(input: { task: Task; record: Record; beforeMutate?: () => void }) {
    if (input.task.kind !== "ship" || input.record.taskID !== input.task.id || input.record.mode !== "local-only")
      throw new Error("wrong_mode", "Local landing requires this ship task's local-only record")
    const gate = assess(input.record)
    if (!gate.ready || input.record.status !== "ready")
      throw new Error("not_ready", `Local landing is not ready: ${gate.ready ? input.record.status : gate.reason}`)
    const state = await inspect({ task: input.task, targetRef: input.record.targetRef })
    if (state.sourceHead !== input.record.sourceHead || state.targetHead !== input.record.targetHead)
      throw new Error("head_changed", "Source or target HEAD changed since delivery was approved")
    if ((await git(state.project, ["symbolic-ref", "--quiet", "HEAD"])) !== state.targetRef)
      throw new Error("target_checkout", "Canonical project must have the target branch checked out")
    if ((await git(state.project, ["status", "--porcelain=v1", "--untracked-files=all"])) !== "")
      throw new Error("target_dirty", "Target worktree must be clean before landing")
    if (!(await gitOk(state.project, ["merge-base", "--is-ancestor", state.targetHead, state.sourceHead])))
      throw new Error("not_fast_forward", "Task HEAD does not fast-forward the target")
    input.beforeMutate?.()
    await git(state.project, ["merge", "--ff-only", state.sourceHead])
    const landedHead = await git(state.project, ["rev-parse", "HEAD"])
    if (landedHead !== state.sourceHead)
      throw new Error("landing_mismatch", "Local landing did not reach the exact task HEAD")
    return {
      kind: "local",
      sourceHead: state.sourceHead,
      targetHead: state.targetHead,
      mergeCommit: landedHead,
    } satisfies Landing
  }

  export async function landPR(input: { task: Task; record: Record; runGh?: GhRunner; beforeMutate?: () => void }) {
    if (input.task.kind !== "ship" || input.record.taskID !== input.task.id || input.record.mode === "local-only")
      throw new Error("wrong_mode", "PR landing requires this ship task's PR record")
    const gate = assess(input.record)
    if (!gate.ready || input.record.status !== "ready")
      throw new Error("not_ready", `PR landing is not ready: ${gate.ready ? input.record.status : gate.reason}`)
    const state = await inspect({ task: input.task, targetRef: input.record.targetRef })
    if (state.sourceHead !== input.record.sourceHead)
      throw new Error("head_changed", "Source HEAD changed since delivery was approved")
    const pr = await readPR({ project: state.project, url: input.record.pr!.url, runGh: input.runGh })
    if (
      pr.url !== input.record.pr!.url ||
      pr.repo !== input.record.pr!.repo ||
      pr.number !== input.record.pr!.number ||
      pr.head !== state.sourceHead ||
      pr.baseHead !== input.record.targetHead ||
      pr.base !== state.targetRef.slice("refs/heads/".length) ||
      pr.state !== "OPEN"
    )
      throw new Error("pr_changed", "PR head, base, or state changed since validation")
    const checks = await readChecks({ project: state.project, pr, runGh: input.runGh })
    if (checks.status !== "passed" && checks.status !== "empty")
      throw new Error("checks_changed", "PR checks are no longer green")
    input.beforeMutate?.()
    const output = await (input.runGh ?? gh)(state.project, [
      "pr",
      "merge",
      pr.url,
      "--merge",
      "--match-head-commit",
      state.sourceHead,
    ])
    if (output.code !== 0) throw new Error("gh_failed", "PR merge failed", output.stderr)
    const merged = await readPR({ project: state.project, url: pr.url, runGh: input.runGh })
    if (merged.state !== "MERGED" || merged.head !== state.sourceHead || !validHead(merged.mergeCommit))
      throw new Error("merge_unproved", "Forge did not prove an exact-head PR merge")
    return {
      kind: "pr",
      sourceHead: state.sourceHead,
      targetHead: input.record.targetHead!,
      mergeCommit: merged.mergeCommit,
    } satisfies Landing
  }

  // Supports squash/rebase: the forge's exact submitted head and merge commit are the proof.
  export async function verifyCleanup(input: { task: Task; record: Record; runGh?: GhRunner }) {
    if (input.record.status !== "landed" || !input.record.landing)
      throw new Error("not_landed", "Cleanup requires a durable landing proof")
    const state = await inspect({ task: input.task, targetRef: input.record.targetRef })
    if (state.sourceHead !== input.record.sourceHead || state.sourceHead !== input.record.landing.sourceHead)
      throw new Error("head_changed", "Task HEAD changed after landing")
    if (input.record.landing.kind === "local") {
      const targetHead = await git(state.project, ["rev-parse", "--verify", `${state.targetRef}^{commit}`])
      if (!(await gitOk(state.project, ["merge-base", "--is-ancestor", state.sourceHead, targetHead])))
        throw new Error("not_landed", "Local target no longer contains the task HEAD")
      return input.record.landing
    }
    if (!input.record.pr) throw new Error("missing_pr", "PR landing proof has no PR identity")
    const pr = await readPR({ project: state.project, url: input.record.pr.url, runGh: input.runGh })
    if (pr.state !== "MERGED" || pr.head !== state.sourceHead || pr.mergeCommit !== input.record.landing.mergeCommit)
      throw new Error("merge_unproved", "Forge no longer proves this exact submitted task HEAD landed")
    return input.record.landing
  }
}

function requireRecord(record: SupervisorDelivery.Record) {
  if (!record.taskID || !record.policyProvenance.reference || !record.policyProvenance.capturedAt)
    throw new SupervisorDelivery.Error("invalid_record", "Delivery intake requires task and policy provenance")
  if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(record.targetRef) || record.targetRef.includes(".."))
    throw new SupervisorDelivery.Error("invalid_record", "Delivery target must be an explicit branch ref")
  if (record.sourceHead && !validHead(record.sourceHead))
    throw new SupervisorDelivery.Error("invalid_record", "Invalid source HEAD")
  if (record.targetHead && !validHead(record.targetHead))
    throw new SupervisorDelivery.Error("invalid_record", "Invalid target HEAD")
}

function validHead(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value)
}

async function canonicalProject(project: string) {
  const canonical = await realpath(project)
  return realpath(await git(canonical, ["rev-parse", "--show-toplevel"]))
}

async function git(cwd: string, args: string[]) {
  const output = await command("git", cwd, ["-C", cwd, ...args])
  if (output.code !== 0) throw new SupervisorDelivery.Error("git_failed", `git ${args[0]} failed`, output.stderr.trim())
  return output.stdout.trim()
}

async function gitOk(cwd: string, args: string[]) {
  const output = await command("git", cwd, ["-C", cwd, ...args])
  if (output.code > 1) throw new SupervisorDelivery.Error("git_failed", `git ${args[0]} failed`, output.stderr.trim())
  return output.code === 0
}

async function gh(cwd: string, args: string[]) {
  return command("gh", cwd, args)
}

async function command(bin: string, cwd: string, args: string[]) {
  const child = Bun.spawn([bin, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const timeout = setTimeout(() => child.kill(), 30_000)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, stdout, stderr }
  } finally {
    clearTimeout(timeout)
  }
}
