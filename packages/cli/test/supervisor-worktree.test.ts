import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { SupervisorWorktree } from "../src/supervisor/worktree"

describe("native supervisor worktrees", () => {
  test("explicit discard archives tracked, untracked, and ignored payload and preserves the branch", async () => {
    await withRepo(async ({ home, repo }) => {
      const task = await SupervisorWorktree.propose({
        home,
        taskID: "discard",
        project: repo,
        baseRef: "HEAD",
        kind: "scout",
      })
      await SupervisorWorktree.create(task)
      await writeFile(path.join(task.worktree, "tracked.txt"), "uncommitted tracked payload")
      await writeFile(path.join(task.worktree, "report.md"), "scout finding")
      await writeFile(path.join(task.worktree, ".gitignore"), "ignored.txt\n")
      await writeFile(path.join(task.worktree, "ignored.txt"), "retained ignored payload")
      const result = await SupervisorWorktree.discard(task, { home, reference: "operator-approved-discard" })
      expect(await Bun.file(result.archive).exists()).toBe(true)
      const contents = Bun.spawnSync(["tar", "-xOzf", result.archive, "./tracked.txt"], { stdout: "pipe" })
      expect(contents.exitCode).toBe(0)
      expect(new TextDecoder().decode(contents.stdout)).toBe("uncommitted tracked payload")
      expect(await git(repo, "rev-parse", task.branch)).toBe(task.baseCommit)
      expect(await SupervisorWorktree.discard(task, { home, reference: "operator-approved-discard" })).toEqual(result)
      await writeFile(result.archive, "tampered")
      await expect(
        SupervisorWorktree.discard(task, { home, reference: "operator-approved-discard" }),
      ).rejects.toMatchObject({ code: "archive_changed" })
    })
  })
  test("pins an explicit base and adopts only the same registered worktree", async () => {
    await withRepo(async ({ home, repo }) => {
      const task = await SupervisorWorktree.propose({ home, taskID: "task-1", project: repo, baseRef: "HEAD" })
      expect(task.project).toBe(repo)
      expect(task.baseCommit).toBe(await git(repo, "rev-parse", "HEAD"))
      const otherHome = path.join(home, "other")
      await mkdir(otherHome)
      const other = await SupervisorWorktree.propose({
        home: otherHome,
        taskID: "task-1",
        project: repo,
        baseRef: "HEAD",
      })
      expect(other.branch).not.toBe(task.branch)
      const first = await SupervisorWorktree.create(task)
      expect(first.head).toBe(task.baseCommit)
      expect(await SupervisorWorktree.create(task)).toEqual(first)
      await expect(SupervisorWorktree.create({ ...task, branch: "another-branch" })).rejects.toMatchObject({
        code: "branch_mismatch",
      })
      await expect(SupervisorWorktree.create({ ...task, baseCommit: "a".repeat(40) })).rejects.toMatchObject({
        code: "base_mismatch",
      })
    })
  })

  test("verifies ship receipt against actual HEAD and clean tracked files", async () => {
    await withRepo(async ({ home, repo }) => {
      const task = await SupervisorWorktree.propose({ home, taskID: "ship-1", project: repo, baseRef: "HEAD" })
      await SupervisorWorktree.create(task)
      await writeFile(path.join(task.worktree, "receipt.txt"), "candidate")
      await git(task.worktree, "add", "receipt.txt")
      await git(task.worktree, "commit", "-m", "candidate")
      const head = await git(task.worktree, "rev-parse", "HEAD")
      const receipt: SupervisorWorktree.Receipt = {
        kind: "ship",
        artifact: { relativePath: "receipt.txt", sha256: hash("candidate") },
        head,
      }
      expect(await SupervisorWorktree.verify({ task, receipt })).toMatchObject({ head, baseCommit: task.baseCommit })
      await expect(
        SupervisorWorktree.verify({ task, receipt: { ...receipt, head: task.baseCommit } }),
      ).rejects.toMatchObject({ code: "head_mismatch" })
      await writeFile(path.join(task.worktree, "receipt.txt"), "mutated")
      await expect(SupervisorWorktree.verify({ task, receipt })).rejects.toMatchObject({ code: "hash_mismatch" })
      await writeFile(path.join(task.worktree, "receipt.txt"), "candidate")
      await writeFile(path.join(task.worktree, "tracked.txt"), "dirty")
      await expect(SupervisorWorktree.verify({ task, receipt })).rejects.toMatchObject({ code: "tracked_dirty" })
      await git(task.worktree, "add", "tracked.txt")
      await expect(SupervisorWorktree.verify({ task, receipt })).rejects.toMatchObject({ code: "tracked_dirty" })
    })
  })

  test("rejects traversal and symlink escapes", async () => {
    await withRepo(async ({ home, repo }) => {
      const task = await SupervisorWorktree.propose({
        home,
        taskID: "escape-1",
        project: repo,
        baseRef: "HEAD",
        kind: "scout",
      })
      await SupervisorWorktree.create(task)
      await writeFile(path.join(home, "outside.txt"), "outside")
      await symlink(path.join(home, "outside.txt"), path.join(task.worktree, "link.txt"))
      await expect(
        SupervisorWorktree.verify({
          task,
          receipt: { kind: "scout", artifact: { relativePath: "../outside.txt", sha256: hash("outside") } },
        }),
      ).rejects.toMatchObject({ code: "invalid_artifact_path" })
      await expect(
        SupervisorWorktree.verify({
          task,
          receipt: { kind: "scout", artifact: { relativePath: "link.txt", sha256: hash("outside") } },
        }),
      ).rejects.toMatchObject({ code: "artifact_escape" })
    })
  })

  test("returns scout report bytes for durable copy and refuses unlanded or payload cleanup", async () => {
    await withRepo(async ({ home, repo }) => {
      const task = await SupervisorWorktree.propose({
        home,
        taskID: "scout-1",
        project: repo,
        baseRef: "HEAD",
        kind: "scout",
      })
      await SupervisorWorktree.create(task)
      await writeFile(path.join(task.worktree, "report.txt"), "finding one")
      const evidence = await SupervisorWorktree.verify({
        task,
        receipt: { kind: "scout", artifact: { relativePath: "report.txt", sha256: hash("finding one") } },
      })
      await rm(path.join(task.worktree, "report.txt"))
      expect(Buffer.from(evidence.artifact.contentBase64, "base64").toString()).toBe("finding one")
      await writeFile(path.join(task.worktree, "change.txt"), "unique")
      await git(task.worktree, "add", "change.txt")
      await git(task.worktree, "commit", "-m", "unique")
      await expect(SupervisorWorktree.cleanup(task, { landingRef: "HEAD" })).rejects.toMatchObject({
        code: "not_landed",
      })
      await git(repo, "merge", "--ff-only", task.branch)
      await writeFile(path.join(task.worktree, "loose.txt"), "payload")
      await expect(SupervisorWorktree.cleanup(task, { landingRef: "HEAD" })).rejects.toMatchObject({
        code: "payload_remains",
      })
      await rm(path.join(task.worktree, "loose.txt"))
      await writeFile(path.join(task.worktree, ".gitignore"), "ignored.txt\n")
      await git(task.worktree, "add", ".gitignore")
      await git(task.worktree, "commit", "-m", "ignore")
      await git(repo, "merge", "--ff-only", task.branch)
      await writeFile(path.join(task.worktree, "ignored.txt"), "payload")
      await expect(SupervisorWorktree.cleanup(task, { landingRef: "HEAD" })).rejects.toMatchObject({
        code: "payload_remains",
      })
      await rm(path.join(task.worktree, "ignored.txt"))
      const removed = await SupervisorWorktree.cleanup(task, { landingRef: "HEAD" })
      expect(removed.head).toBe(await git(repo, "rev-parse", "HEAD"))
      expect(await git(repo, "rev-parse", task.branch)).toBe(removed.head)
    })
  })

  test("refuses cleanup with tracked worktree or staged changes", async () => {
    await withRepo(async ({ home, repo }) => {
      const task = await SupervisorWorktree.propose({ home, taskID: "dirty-1", project: repo, baseRef: "HEAD" })
      await SupervisorWorktree.create(task)
      await writeFile(path.join(task.worktree, "tracked.txt"), "changed")
      await expect(SupervisorWorktree.cleanup(task, { landingRef: "HEAD" })).rejects.toMatchObject({
        code: "tracked_dirty",
      })
      await git(task.worktree, "add", "tracked.txt")
      await expect(SupervisorWorktree.cleanup(task, { landingRef: "HEAD" })).rejects.toMatchObject({
        code: "tracked_dirty",
      })
    })
  })
})

async function withRepo(run: (context: { home: string; repo: string }) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "supervisor-worktree-"))
  const repo = path.join(home, "repo")
  try {
    await mkdir(repo)
    await git(repo, "init", "-q")
    await git(repo, "config", "user.name", "Test")
    await git(repo, "config", "user.email", "test@example.com")
    await writeFile(path.join(repo, "tracked.txt"), "initial")
    await git(repo, "add", "tracked.txt")
    await git(repo, "commit", "-qm", "initial")
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

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
