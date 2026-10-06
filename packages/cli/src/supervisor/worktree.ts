import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, realpath, mkdir, rename } from "node:fs/promises"
import path from "node:path"

export namespace SupervisorWorktree {
  export type Kind = "ship" | "scout"

  export type Task = {
    id: string
    kind: Kind
    project: string
    worktree: string
    branch: string
    baseRef: string
    baseCommit: string
  }

  export type Receipt = {
    kind: Kind
    artifact: { relativePath: string; sha256: string }
    head?: string
  }

  export type Evidence = {
    kind: Kind
    artifact: { relativePath: string; sha256: string; contentBase64: string }
    head: string
    baseCommit: string
    branch: string
    worktree: string
  }

  export class Error extends globalThis.Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly detail?: string,
    ) {
      super(message)
      this.name = "SupervisorWorktree.Error"
    }
  }

  export async function propose(input: {
    home: string
    taskID: string
    project: string
    baseRef: string
    kind?: Kind
  }): Promise<Task> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.taskID))
      throw new Error("invalid_task_id", "Task ID must be a single safe path segment")
    if (!input.baseRef || input.baseRef.startsWith("-"))
      throw new Error("invalid_base_ref", "An explicit Git base ref is required")
    if (input.kind && input.kind !== "ship" && input.kind !== "scout")
      throw new Error("invalid_kind", "Task kind must be ship or scout")
    const home = await realpath(input.home)
    const project = await canonicalProject(input.project)
    const baseCommit = await git(project, ["rev-parse", "--verify", "--end-of-options", `${input.baseRef}^{commit}`])
    if (!/^[0-9a-f]{40,64}$/.test(baseCommit))
      throw new Error("invalid_base_ref", "Base ref did not resolve to a commit")
    const worktree = path.join(home, "worktrees", input.taskID)
    return {
      id: input.taskID,
      kind: input.kind ?? "ship",
      project,
      worktree,
      branch: branchFor(worktree),
      baseRef: input.baseRef,
      baseCommit,
    }
  }

  export const plan = propose

  export async function create(task: Task) {
    await validateTask(task)
    const registration = await registered(task)
    if (registration)
      return { worktree: task.worktree, branch: task.branch, head: registration.head, baseCommit: task.baseCommit }
    if (await exists(task.worktree))
      throw new Error("path_occupied", "Worktree path already exists but is not registered", task.worktree)
    if (await gitStatus(task.project, ["show-ref", "--verify", "--quiet", `refs/heads/${task.branch}`]))
      throw new Error("branch_occupied", "Task branch exists without the recorded worktree", task.branch)
    await git(task.project, ["worktree", "add", "-b", task.branch, task.worktree, task.baseCommit])
    const created = await registered(task)
    if (!created || created.head !== task.baseCommit)
      throw new Error("creation_mismatch", "Created worktree failed registration or base proof")
    return { worktree: task.worktree, branch: task.branch, head: created.head, baseCommit: task.baseCommit }
  }

  export async function verify(input: { task: Task; receipt: Receipt }): Promise<Evidence> {
    const task = input.task
    await validateTask(task)
    const registration = await registered(task)
    if (!registration) throw new Error("unregistered", "Task worktree is not registered")
    if (input.receipt.kind !== task.kind) throw new Error("kind_mismatch", "Receipt kind differs from task kind")
    if (!/^[0-9a-f]{64}$/.test(input.receipt.artifact.sha256))
      throw new Error("invalid_hash", "Receipt requires a lowercase SHA-256 hash")
    const relativePath = input.receipt.artifact.relativePath
    if (
      !relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === ".." || part === "" || part === ".")
    )
      throw new Error("invalid_artifact_path", "Artifact path must be relative and remain inside the task worktree")
    const root = await realpath(task.worktree)
    if (root !== task.worktree) throw new Error("worktree_redirected", "Task worktree resolves to another path")
    const candidate = path.join(root, relativePath)
    const actual = await realpath(candidate).catch(() => {
      throw new Error("artifact_missing", "Receipt artifact is missing", relativePath)
    })
    if (!inside(root, actual)) throw new Error("artifact_escape", "Receipt artifact leaves the task worktree")
    if (!(await lstat(candidate)).isFile())
      throw new Error("artifact_not_file", "Receipt artifact must be a regular file")
    const bytes = new Uint8Array(await Bun.file(candidate).arrayBuffer())
    if (bytes.byteLength > 1024 * 1024)
      throw new Error("artifact_too_large", "Receipt artifact exceeds the 1 MiB evidence limit")
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    if (sha256 !== input.receipt.artifact.sha256)
      throw new Error("hash_mismatch", "Receipt artifact changed after the reported hash")
    const head = await git(task.worktree, ["rev-parse", "HEAD"])
    if (head !== registration.head)
      throw new Error("head_mismatch", "Registered worktree HEAD changed during verification")
    if (!(await gitStatus(task.project, ["merge-base", "--is-ancestor", task.baseCommit, head])))
      throw new Error("base_mismatch", "Task HEAD does not descend from the recorded base")
    if (task.kind === "ship") {
      if (!input.receipt.head || input.receipt.head !== head)
        throw new Error("head_mismatch", "Ship receipt must name the actual worktree HEAD")
      await requireCleanTracked(task.worktree)
    }
    return {
      kind: task.kind,
      artifact: { relativePath, sha256, contentBase64: Buffer.from(bytes).toString("base64") },
      head,
      baseCommit: task.baseCommit,
      branch: task.branch,
      worktree: task.worktree,
    }
  }

  export async function cleanup(task: Task, input: { landingRef: string }) {
    await validateTask(task)
    const registration = await registered(task)
    if (!registration) throw new Error("unregistered", "Task worktree is not registered")
    if (!input.landingRef || input.landingRef.startsWith("-"))
      throw new Error("invalid_landing_ref", "Cleanup requires an explicit landing ref")
    if (input.landingRef === task.branch || input.landingRef === `refs/heads/${task.branch}`)
      throw new Error("invalid_landing_ref", "Task branch cannot be its own landing target")
    const landingCommit = await git(task.project, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${input.landingRef}^{commit}`,
    ])
    await requireCleanTracked(task.worktree)
    if ((await git(task.worktree, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"])) !== "")
      throw new Error("payload_remains", "Untracked or ignored task files remain in worktree")
    if (!(await gitStatus(task.project, ["merge-base", "--is-ancestor", registration.head, landingCommit])))
      throw new Error("not_landed", "Task HEAD is not an ancestor of the explicit landing target")
    await git(task.project, ["worktree", "remove", task.worktree])
    return { head: registration.head, landingCommit, worktree: task.worktree }
  }

  // The caller verifies the durable forge proof, including squash/rebase landing, before entering here.
  export async function cleanupLanded(
    task: Task,
    input: { sourceHead: string; mergeCommit: string; beforeMutate?: () => void },
  ) {
    await validateTask(task)
    const registration = await registered(task)
    if (!registration || registration.head !== input.sourceHead)
      throw new Error("head_mismatch", "Worktree no longer matches the verified landing")
    await requireCleanTracked(task.worktree)
    if ((await git(task.worktree, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"])) !== "")
      throw new Error("payload_remains", "Untracked or ignored task files remain in worktree")
    input.beforeMutate?.()
    await git(task.project, ["worktree", "remove", task.worktree])
    return { head: registration.head, landingCommit: input.mergeCommit, worktree: task.worktree }
  }

  export async function discard(task: Task, input: { home: string; reference: string }) {
    await validateTask(task)
    if (!input.reference.trim()) throw new Error("missing_approval", "Discard requires a user decision reference")
    const directory = path.join(await realpath(input.home), "discarded", task.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const manifest = path.join(directory, "receipt.json")
    const previous = (await Bun.file(manifest).exists())
      ? ((await Bun.file(manifest).json()) as {
          taskID: string
          head: string
          archive: string
          sha256: string
          reference: string
          worktree: string
        })
      : undefined
    if (previous) {
      if (
        previous.taskID !== task.id ||
        previous.worktree !== task.worktree ||
        previous.archive !== path.join(directory, "worktree.tar.gz") ||
        previous.reference !== input.reference
      )
        throw new Error("discard_conflict", "Discard intent differs from its saved archive")
      if ((await fileHash(previous.archive)) !== previous.sha256)
        throw new Error("archive_changed", "Discard archive failed verification")
      if (!(await exists(task.worktree))) return previous
    }
    const registration = await registered(task)
    if (!registration) throw new Error("unregistered", "Task worktree is not registered")
    if (previous && previous.head !== registration.head)
      throw new Error("head_mismatch", "Task HEAD changed after discard was requested")
    const archive = path.join(directory, "worktree.tar.gz")
    {
      const child = Bun.spawn(["tar", "-czf", `${archive}.tmp`, "--exclude=./.git", "-C", task.worktree, "."], {
        stdout: "ignore",
        stderr: "pipe",
      })
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      if (code !== 0) throw new Error("archive_failed", "Worktree archive failed; no files were removed", stderr)
      await rename(`${archive}.tmp`, archive)
      await Bun.write(
        manifest,
        JSON.stringify({
          taskID: task.id,
          head: registration.head,
          archive,
          sha256: await fileHash(archive),
          reference: input.reference,
          worktree: task.worktree,
        }),
      )
    }
    // Explicit discard is separate from normal cleanup and always preserves a restorable archive.
    await git(task.project, ["worktree", "remove", "--force", task.worktree])
    return (await Bun.file(manifest).json()) as {
      taskID: string
      head: string
      archive: string
      sha256: string
      reference: string
      worktree: string
    }
  }
}

async function fileHash(file: string) {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest("hex")
}

async function canonicalProject(project: string) {
  const canonical = await realpath(project)
  const top = await git(canonical, ["rev-parse", "--show-toplevel"])
  return realpath(top)
}

async function validateTask(task: SupervisorWorktree.Task) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(task.id))
    throw new SupervisorWorktree.Error("invalid_task_id", "Task ID must be a single safe path segment")
  if (task.project !== (await canonicalProject(task.project)))
    throw new SupervisorWorktree.Error("project_mismatch", "Recorded project is not the canonical repository root")
  if (task.worktree !== path.join(path.dirname(path.dirname(task.worktree)), "worktrees", task.id))
    throw new SupervisorWorktree.Error("path_mismatch", "Recorded worktree path is not the task path")
  if (task.branch !== branchFor(task.worktree))
    throw new SupervisorWorktree.Error("branch_mismatch", "Recorded task branch is not deterministic")
  if (!/^[0-9a-f]{40,64}$/.test(task.baseCommit))
    throw new SupervisorWorktree.Error("invalid_base", "Recorded base commit is invalid")
  if (!(await gitStatus(task.project, ["cat-file", "-e", `${task.baseCommit}^{commit}`], true)))
    throw new SupervisorWorktree.Error("base_mismatch", "Recorded base commit is absent from the project")
}

async function registered(task: SupervisorWorktree.Task) {
  const records = (await git(task.project, ["worktree", "list", "--porcelain", "-z"])).split("\0\0")
  const record = records
    .map((entry) =>
      Object.fromEntries(
        entry
          .split("\0")
          .filter(Boolean)
          .map((line) => [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)]),
      ),
    )
    .find((entry) => entry.worktree === task.worktree)
  if (!record) return undefined
  if (record.branch !== `refs/heads/${task.branch}`)
    throw new SupervisorWorktree.Error("branch_mismatch", "Registered worktree uses another branch")
  if (!record.HEAD || !(await gitStatus(task.project, ["merge-base", "--is-ancestor", task.baseCommit, record.HEAD])))
    throw new SupervisorWorktree.Error("base_mismatch", "Registered worktree does not descend from recorded base")
  if ((await realpath(task.worktree)) !== task.worktree)
    throw new SupervisorWorktree.Error("worktree_redirected", "Registered worktree resolves to another path")
  const actualBranch = await git(task.worktree, ["symbolic-ref", "--quiet", "HEAD"])
  const actualHead = await git(task.worktree, ["rev-parse", "HEAD"])
  if (actualBranch !== record.branch || actualHead !== record.HEAD)
    throw new SupervisorWorktree.Error("registration_mismatch", "Worktree contents differ from Git registration")
  return { head: actualHead }
}

async function requireCleanTracked(worktree: string) {
  if (
    !(await gitStatus(worktree, ["diff", "--quiet", "--exit-code"])) ||
    !(await gitStatus(worktree, ["diff", "--cached", "--quiet", "--exit-code"]))
  )
    throw new SupervisorWorktree.Error("tracked_dirty", "Tracked worktree or index changes remain")
}

async function exists(file: string) {
  return lstat(file).then(
    () => true,
    () => false,
  )
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function branchFor(worktree: string) {
  return `native-${createHash("sha256").update(worktree).digest("hex").slice(0, 12)}`
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new SupervisorWorktree.Error("git_failed", `git ${args[0]} failed`, stderr.trim())
  return stdout.trim()
}

async function gitStatus(cwd: string, args: string[], missingIsFalse = false) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code > 1 && !missingIsFalse)
    throw new SupervisorWorktree.Error("git_failed", `git ${args[0]} failed`, stderr.trim())
  return code === 0
}
