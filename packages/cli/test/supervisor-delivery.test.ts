import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorDelivery } from "../src/supervisor/delivery"
import { SupervisorWorktree } from "../src/supervisor/worktree"

describe("native supervisor delivery", () => {
  test("persists intake in the workflow database and freezes landed records", async () => {
    await withRepo(async ({ home, repo }) => {
      const db = new DatabaseSync(path.join(home, "workflow.sqlite"))
      try {
        db.exec("CREATE TABLE task (id TEXT PRIMARY KEY); INSERT INTO task VALUES ('one')")
        const delivery = SupervisorDelivery.open(db)
        const initial = record("one", "local-only", "manual", "pending")
        delivery.record(initial)
        expect(delivery.get("one")).toEqual(initial)
        expect(delivery.list()).toEqual([initial])
        expect(() => delivery.record({ ...initial, mergePolicy: "auto" })).toThrow("fixed at intake")
        const task = await ship(home, repo, "one")
        const state = await SupervisorDelivery.inspect({ task, targetRef: "refs/heads/main" })
        const ready = {
          ...initial,
          status: "ready" as const,
          sourceHead: state.sourceHead,
          targetHead: state.targetHead,
          approval: approval(state.sourceHead, state.targetHead),
        }
        delivery.record(ready)
        const landing = await SupervisorDelivery.landLocal({ task, record: ready })
        const landed = { ...ready, status: "landed" as const, landing }
        delivery.record(landed)
        expect(delivery.get("one")).toEqual(landed)
        expect(() => delivery.record({ ...landed, blocker: "changed" })).toThrow("cannot change")
        expect(await SupervisorDelivery.verifyCleanup({ task, record: landed })).toEqual(landing)
      } finally {
        db.close()
      }
    })
  })

  test("local landing refuses dirty source, dirty target, changed head, and non-fast-forward", async () => {
    await withRepo(async ({ home, repo }) => {
      const task = await ship(home, repo, "guard")
      const state = await SupervisorDelivery.inspect({ task, targetRef: "refs/heads/main" })
      const ready = {
        ...record("guard", "local-only", "manual", "ready"),
        sourceHead: state.sourceHead,
        targetHead: state.targetHead,
        approval: approval(state.sourceHead, state.targetHead),
      }
      await writeFile(path.join(task.worktree, "loose"), "payload")
      await expect(SupervisorDelivery.landLocal({ task, record: ready })).rejects.toMatchObject({
        code: "source_dirty",
      })
      await rm(path.join(task.worktree, "loose"))
      await writeFile(path.join(repo, "loose"), "payload")
      await expect(SupervisorDelivery.landLocal({ task, record: ready })).rejects.toMatchObject({
        code: "target_dirty",
      })
      await rm(path.join(repo, "loose"))
      await writeFile(path.join(task.worktree, "next"), "second")
      await git(task.worktree, "add", "next")
      await git(task.worktree, "commit", "-qm", "second")
      await expect(SupervisorDelivery.landLocal({ task, record: ready })).rejects.toMatchObject({
        code: "head_changed",
      })
      const next = await SupervisorDelivery.inspect({ task, targetRef: "refs/heads/main" })
      await writeFile(path.join(repo, "target"), "diverged")
      await git(repo, "add", "target")
      await git(repo, "commit", "-qm", "target moved")
      const divergent = { ...ready, sourceHead: next.sourceHead, targetHead: await git(repo, "rev-parse", "HEAD") }
      divergent.approval = approval(divergent.sourceHead, divergent.targetHead)
      await expect(SupervisorDelivery.landLocal({ task, record: divergent })).rejects.toMatchObject({
        code: "not_fast_forward",
      })
      expect(await git(repo, "rev-parse", "HEAD")).toBe(divergent.targetHead)
    })
  })

  test("PR identity, required checks, and exact-head no-mistakes gate", async () => {
    await withRepo(async ({ home, repo }) => {
      await git(repo, "remote", "add", "origin", "git@github.com:owner/project.git")
      const task = await ship(home, repo, "pr")
      const state = await SupervisorDelivery.inspect({ task, targetRef: "refs/heads/main" })
      const url = "https://github.com/owner/project/pull/17"
      const events: string[][] = []
      const runGh: SupervisorDelivery.GhRunner = async (cwd, args) => {
        expect(cwd).toBe(repo)
        events.push(args)
        if (args[1] === "view")
          return {
            code: 0,
            stdout: JSON.stringify({
              url,
              number: 17,
              headRefOid: state.sourceHead,
              baseRefName: "main",
              baseRefOid: state.targetHead,
              baseRepository: { nameWithOwner: "owner/project" },
              state: "OPEN",
              mergeCommit: null,
            }),
            stderr: "",
          }
        return { code: 0, stdout: JSON.stringify([{ name: "build", state: "SUCCESS", bucket: "pass" }]), stderr: "" }
      }
      expect(() =>
        SupervisorDelivery.parsePRUrl("https://github.com/upstream/project/pull/17", "github.com/owner/project"),
      ).toThrow("origin repository")
      expect(() => SupervisorDelivery.parsePRUrl(`${url}?foo=bar`, "github.com/owner/project")).toThrow(
        "canonical HTTPS",
      )
      const pr = await SupervisorDelivery.readPR({ project: repo, url, runGh })
      const checks = await SupervisorDelivery.readChecks({ project: repo, pr, runGh })
      expect(checks.status).toBe("passed")
      expect(events.map((args) => args[0])).toEqual(["pr", "pr"])
      const base = {
        ...record("pr", "no-mistakes", "manual", "ready"),
        sourceHead: state.sourceHead,
        targetHead: state.targetHead,
        pr,
        checks,
        approval: approval(state.sourceHead, state.targetHead),
      }
      expect(SupervisorDelivery.assess(base)).toEqual({ ready: false, reason: "validation" })
      const validated = {
        ...base,
        validation: {
          sourceHead: state.sourceHead,
          runID: "run-1",
          status: "passed" as const,
          trusted: true,
          askUserFindings: [],
        },
      }
      expect(SupervisorDelivery.assess(validated)).toEqual({ ready: true })
      expect(
        SupervisorDelivery.assess({
          ...validated,
          validation: { ...validated.validation, sourceHead: state.targetHead },
        }),
      ).toEqual({ ready: false, reason: "validation" })
      expect(
        SupervisorDelivery.assess({
          ...validated,
          validation: { ...validated.validation, askUserFindings: ["needs decision"] },
        }),
      ).toEqual({ ready: false, reason: "validation" })
      expect(SupervisorDelivery.assess({ ...validated, checks: { ...checks, status: "empty", required: [] } })).toEqual(
        { ready: true },
      )
      expect(SupervisorDelivery.assess({ ...validated, checks: { ...checks, status: "pending" } })).toEqual({
        ready: false,
        reason: "checks_pending",
      })
      expect(SupervisorDelivery.assess({ ...validated, checks: { ...checks, status: "failed" } })).toEqual({
        ready: false,
        reason: "checks_failed",
      })
      const pending = await SupervisorDelivery.readChecks({
        project: repo,
        pr,
        runGh: async () => ({
          code: 1,
          stdout: JSON.stringify([{ name: "build", state: "IN_PROGRESS", bucket: "pending" }]),
          stderr: "",
        }),
      })
      expect(pending.status).toBe("pending")
      const empty = await SupervisorDelivery.readChecks({
        project: repo,
        pr,
        runGh: async () => ({ code: 0, stdout: "[]", stderr: "" }),
      })
      expect(empty.status).toBe("empty")
      await expect(
        SupervisorDelivery.readPR({
          project: repo,
          url,
          runGh: async () => ({
            code: 0,
            stdout: JSON.stringify({
              url,
              number: 17,
              headRefOid: state.sourceHead,
              baseRefName: "main",
              baseRefOid: state.targetHead,
              baseRepository: { nameWithOwner: "upstream/project" },
              state: "OPEN",
            }),
            stderr: "",
          }),
        }),
      ).rejects.toMatchObject({ code: "pr_identity_mismatch" })
    })
  })

  test("PR landing needs a fresh green check and cleanup accepts squash merge proof", async () => {
    await withRepo(async ({ home, repo }) => {
      await git(repo, "remote", "add", "origin", "git@github.com:owner/project.git")
      const task = await ship(home, repo, "squash")
      const state = await SupervisorDelivery.inspect({ task, targetRef: "refs/heads/main" })
      const url = "https://github.com/owner/project/pull/18"
      const pr: SupervisorDelivery.PR = {
        url,
        repo: "github.com/owner/project",
        number: 18,
        head: state.sourceHead,
        base: "main",
        baseHead: state.targetHead,
        state: "OPEN",
      }
      const ready = {
        ...record("squash", "direct-PR", "auto", "ready"),
        sourceHead: state.sourceHead,
        targetHead: state.targetHead,
        pr,
        checks: {
          sourceHead: state.sourceHead,
          status: "passed" as const,
          required: [{ name: "build", state: "SUCCESS", bucket: "pass" as const }],
        },
      }
      const mergeCommit = "f".repeat(40)
      let merged = false
      const runGh: SupervisorDelivery.GhRunner = async (_cwd, args) => {
        if (args[1] === "view")
          return {
            code: 0,
            stdout: JSON.stringify({
              url,
              number: 18,
              headRefOid: state.sourceHead,
              baseRefName: "main",
              baseRefOid: state.targetHead,
              baseRepository: { nameWithOwner: "owner/project" },
              state: merged ? "MERGED" : "OPEN",
              mergeCommit: merged ? { oid: mergeCommit } : null,
            }),
            stderr: "",
          }
        if (args[1] === "checks") return { code: 0, stdout: JSON.stringify(ready.checks.required), stderr: "" }
        expect(args).toEqual(["pr", "merge", url, "--merge", "--match-head-commit", state.sourceHead])
        merged = true
        return { code: 0, stdout: "", stderr: "" }
      }
      const landing = await SupervisorDelivery.landPR({ task, record: ready, runGh })
      expect(landing).toEqual({ kind: "pr", sourceHead: state.sourceHead, targetHead: state.targetHead, mergeCommit })
      expect(
        await SupervisorDelivery.verifyCleanup({ task, record: { ...ready, status: "landed", landing }, runGh }),
      ).toEqual(landing)
      await writeFile(path.join(task.worktree, "later"), "dirty")
      await expect(
        SupervisorDelivery.verifyCleanup({ task, record: { ...ready, status: "landed", landing }, runGh }),
      ).rejects.toMatchObject({ code: "source_dirty" })
    })
  })
})

function record(
  taskID: string,
  mode: SupervisorDelivery.Mode,
  mergePolicy: SupervisorDelivery.MergePolicy,
  status: SupervisorDelivery.Status,
): SupervisorDelivery.Record {
  return {
    taskID,
    mode,
    mergePolicy,
    status,
    targetRef: "refs/heads/main",
    policyProvenance: { source: "captain", reference: "intake-1", capturedAt: "2026-10-05T00:00:00Z" },
  }
}

function approval(sourceHead: string, targetHead: string): SupervisorDelivery.Approval {
  return { source: "captain", reference: "approval-1", approvedAt: "2026-10-05T00:00:00Z", sourceHead, targetHead }
}

async function ship(home: string, repo: string, id: string) {
  const task = await SupervisorWorktree.propose({ home, taskID: id, project: repo, baseRef: "main" })
  await SupervisorWorktree.create(task)
  await writeFile(path.join(task.worktree, `${id}.txt`), "shipped")
  await git(task.worktree, "add", `${id}.txt`)
  await git(task.worktree, "commit", "-qm", "shipped")
  return task
}

async function withRepo(run: (input: { home: string; repo: string }) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "supervisor-delivery-"))
  const repo = path.join(home, "repo")
  try {
    await mkdir(repo)
    await git(repo, "init", "-q", "-b", "main")
    await git(repo, "config", "user.name", "Test")
    await git(repo, "config", "user.email", "test@example.com")
    await writeFile(path.join(repo, "base.txt"), "base")
    await git(repo, "add", "base.txt")
    await git(repo, "commit", "-qm", "base")
    await run({ home, repo })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
  return stdout.trim()
}
