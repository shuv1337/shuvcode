import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

export namespace SupervisorProjects {
  export type Mode = "no-mistakes" | "direct-PR" | "local-only" | "no-mistakes-prod-only"
  export type Model = { providerID: string; modelID: string; variant?: string }
  export type Permission = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
  export type Project = {
    id: string
    path: string
    description: string
    baseRef: string
    mode: Mode
    yolo: boolean
    model?: Model
    agent?: string
    permissions?: Permission[]
    archived: boolean
    createdAt: number
    updatedAt: number
  }
  export type Input = {
    id?: string
    path: string
    description?: string
    baseRef?: string
    mode?: Mode
    yolo?: boolean
    model?: Model
    agent?: string
    permissions?: Permission[]
  }
  export type Provision = Omit<Input, "path"> & {
    home: string
    path?: string
    url?: string
    initialize?: boolean
  }
  export type Prepared = Omit<Project, "archived" | "createdAt" | "updatedAt">
  export type Patch = Partial<
    Pick<Project, "description" | "baseRef" | "mode" | "yolo" | "model" | "agent" | "permissions">
  >

  export type Row = {
    id: string
    path: string
    description: string
    base_ref: string
    mode: Mode
    yolo: number
    model: string | null
    agent: string | null
    permissions: string | null
    archived: number
    created_at: number
    updated_at: number
  }

  /** Validate a local Git repository and resolve defaults without fetching or changing it. */
  export async function prepare(input: Input): Promise<Prepared> {
    const canonical = await realpath(input.path)
    const top = await git(canonical, ["rev-parse", "--show-toplevel"])
    if (canonical !== (await realpath(top))) throw new Error(`Use the repository root: ${top}`)
    const branch = await git(canonical, ["symbolic-ref", "--quiet", "--short", "HEAD"], true)
    const baseRef = input.baseRef ?? branch ?? "HEAD"
    if (!baseRef || baseRef.startsWith("-") || /[\0\r\n]/.test(baseRef)) throw new Error("Invalid project base ref")
    const commit = await git(canonical, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], true)
    // An initialized empty repository has a valid symbolic branch but no base commit yet.
    if (!commit && !(branch === baseRef && (await git(canonical, ["rev-list", "--all", "--count"])) === "0"))
      throw new Error(`Project base ref does not resolve to a commit: ${baseRef}`)
    const origin = await git(canonical, ["remote", "get-url", "origin"], true)
    const id =
      input.id ??
      path
        .basename(canonical)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
    const result: Prepared = {
      id,
      path: canonical,
      description: input.description ?? "",
      baseRef,
      mode: input.mode ?? (origin ? "no-mistakes-prod-only" : "local-only"),
      yolo: input.yolo ?? false,
      model: input.model,
      agent: input.agent,
      permissions: input.permissions,
    }
    validate(result)
    return result
  }

  /** Prepare an existing repository, or stage a clone/init before moving it into this supervisor home. */
  export async function provision(input: Provision): Promise<Prepared> {
    if (input.id) validateID(input.id)
    if (!input.path && !input.id) throw new Error("Managed project creation requires an ID")
    if (Number(Boolean(input.path)) + Number(Boolean(input.url)) + Number(Boolean(input.initialize)) !== 1)
      throw new Error("Choose exactly one project source: path, URL, or initialize")
    if (input.path) return prepare({ ...input, path: input.path })
    if (input.url && (input.url.startsWith("-") || /[\0\r\n]/.test(input.url))) throw new Error("Invalid project URL")
    const target = path.join(await realpath(input.home), "projects", input.id!)
    const parent = path.dirname(target)
    await mkdir(parent, { recursive: true, mode: 0o700 })
    if (
      await lstat(target).then(
        () => true,
        () => false,
      )
    ) {
      if ((await realpath(target)) !== target) throw new Error(`Project destination is redirected: ${target}`)
      const origin = await git(target, ["remote", "get-url", "origin"], true)
      if (input.url ? origin !== input.url : origin !== undefined)
        throw new Error(`Project destination has a different origin: ${target}`)
      return prepare({ ...input, path: target })
    }
    const stage = path.join(parent, `.${input.id}.${process.pid}.${crypto.randomUUID()}.tmp`)
    try {
      if (input.url) await runGit(["clone", "--origin", "origin", "--", input.url, stage])
      if (input.initialize) {
        await runGit(["init", "-q", "--initial-branch", input.baseRef ?? "main", stage])
        if (!(await git(stage, ["config", "user.name"], true)))
          await git(stage, ["config", "user.name", "Shuvcode Supervisor"])
        if (!(await git(stage, ["config", "user.email"], true)))
          await git(stage, ["config", "user.email", "supervisor@localhost"])
        await git(stage, ["commit", "--allow-empty", "-m", "chore: initialize project"])
      }
      const prepared = await prepare({ ...input, path: stage, id: input.id })
      await rename(stage, target)
      return { ...prepared, path: target }
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  }

  /** Shares the caller's DatabaseSync and lifetime. Do not call add inside an existing SQL transaction. */
  export function open(db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS supervisor_project (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('no-mistakes', 'direct-PR', 'local-only', 'no-mistakes-prod-only')),
        yolo INTEGER NOT NULL CHECK (yolo IN (0, 1)),
        model TEXT,
        agent TEXT,
        permissions TEXT,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supervisor_project_registry (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        default_project TEXT NOT NULL REFERENCES supervisor_project(id)
      );
    `)
    const byID = db.prepare("SELECT * FROM supervisor_project WHERE id = ?")
    const byPath = db.prepare("SELECT * FROM supervisor_project WHERE path = ?")
    const defaultRow = db.prepare("SELECT default_project FROM supervisor_project_registry WHERE id = 1")

    function get(id: string): Project | undefined {
      const row = byID.get(id) as Row | undefined
      return row ? fromRow(row) : undefined
    }

    function list(options?: { includeArchived?: boolean }): Project[] {
      return (
        db
          .prepare(
            `SELECT * FROM supervisor_project ${options?.includeArchived ? "" : "WHERE archived = 0"} ORDER BY id`,
          )
          .all() as Row[]
      ).map(fromRow)
    }

    function add(input: Prepared): Project {
      validate(input)
      const existing = get(input.id)
      const otherPath = byPath.get(input.path) as Row | undefined
      if (existing) {
        if (sameRegistration(existing, input)) return existing
        throw new Error(`Conflicting supervisor project ID: ${input.id}`)
      }
      if (otherPath) throw new Error(`Project path already registered as ${otherPath.id}`)
      const now = Date.now()
      // First registration and default selection are atomic for the single workflow writer.
      db.exec("BEGIN IMMEDIATE")
      try {
        db.prepare(
          `INSERT INTO supervisor_project
          (id, path, description, base_ref, mode, yolo, model, agent, permissions, archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(
          input.id,
          input.path,
          input.description,
          input.baseRef,
          input.mode,
          Number(input.yolo),
          input.model ? JSON.stringify(input.model) : null,
          input.agent ?? null,
          input.permissions ? JSON.stringify(input.permissions) : null,
          now,
          now,
        )
        db.prepare("INSERT OR IGNORE INTO supervisor_project_registry (id, default_project) VALUES (1, ?)").run(
          input.id,
        )
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
      return get(input.id)!
    }

    function update(id: string, patch: Patch): Project {
      const current = get(id)
      if (!current) throw new Error(`Unknown supervisor project: ${id}`)
      const next = { ...current, ...patch }
      validate(next)
      if (sameRegistration(current, next)) return current
      db.prepare(
        `UPDATE supervisor_project SET description = ?, base_ref = ?, mode = ?, yolo = ?, model = ?, agent = ?,
        permissions = ?, updated_at = ? WHERE id = ?`,
      ).run(
        next.description,
        next.baseRef,
        next.mode,
        Number(next.yolo),
        next.model ? JSON.stringify(next.model) : null,
        next.agent ?? null,
        next.permissions ? JSON.stringify(next.permissions) : null,
        Date.now(),
        id,
      )
      return get(id)!
    }

    function setDefault(id: string): Project {
      const project = get(id)
      if (!project) throw new Error(`Unknown supervisor project: ${id}`)
      if (project.archived) throw new Error(`Cannot select archived supervisor project: ${id}`)
      db.prepare(
        "INSERT INTO supervisor_project_registry (id, default_project) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET default_project = excluded.default_project",
      ).run(id)
      return project
    }

    function getDefault(): Project | undefined {
      const row = defaultRow.get() as { default_project: string } | undefined
      return row ? get(row.default_project) : undefined
    }

    function archive(id: string): Project {
      const project = get(id)
      if (!project) throw new Error(`Unknown supervisor project: ${id}`)
      if (getDefault()?.id === id) throw new Error("Choose another default project before archiving this one")
      if (project.archived) return project
      db.prepare("UPDATE supervisor_project SET archived = 1, updated_at = ? WHERE id = ?").run(Date.now(), id)
      return get(id)!
    }

    function restore(id: string): Project {
      const project = get(id)
      if (!project) throw new Error(`Unknown supervisor project: ${id}`)
      if (!project.archived) return project
      db.prepare("UPDATE supervisor_project SET archived = 0, updated_at = ? WHERE id = ?").run(Date.now(), id)
      return get(id)!
    }

    return { list, get, add, update, setDefault, default: getDefault, archive, restore }
  }
}

function fromRow(row: SupervisorProjects.Row): SupervisorProjects.Project {
  return {
    id: row.id,
    path: row.path,
    description: row.description,
    baseRef: row.base_ref,
    mode: row.mode,
    yolo: Boolean(row.yolo),
    model: row.model ? JSON.parse(row.model) : undefined,
    agent: row.agent ?? undefined,
    permissions: row.permissions ? JSON.parse(row.permissions) : undefined,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sameRegistration(current: SupervisorProjects.Project, input: SupervisorProjects.Prepared) {
  return (
    current.id === input.id &&
    current.path === input.path &&
    current.description === input.description &&
    current.baseRef === input.baseRef &&
    current.mode === input.mode &&
    current.yolo === input.yolo &&
    JSON.stringify(current.model) === JSON.stringify(input.model) &&
    current.agent === input.agent &&
    JSON.stringify(current.permissions) === JSON.stringify(input.permissions)
  )
}

function validate(input: SupervisorProjects.Prepared) {
  validateID(input.id)
  if (!path.isAbsolute(input.path)) throw new Error("Project path must be absolute")
  if (!input.baseRef || input.baseRef.startsWith("-") || /[\0\r\n]/.test(input.baseRef))
    throw new Error("Invalid project base ref")
  if (!["no-mistakes", "direct-PR", "local-only", "no-mistakes-prod-only"].includes(input.mode))
    throw new Error("Invalid project mode")
  if (typeof input.yolo !== "boolean") throw new Error("Project yolo must be boolean")
  if (typeof input.description !== "string") throw new Error("Project description must be text")
  if (input.model && (!input.model.providerID || !input.model.modelID))
    throw new Error("Project model requires provider and model IDs")
  if (input.agent !== undefined && !input.agent) throw new Error("Project agent cannot be empty")
  if (
    input.permissions?.some((item) => !item.action || !item.resource || !["allow", "deny", "ask"].includes(item.effect))
  )
    throw new Error("Invalid project permissions")
}

function validateID(id: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id))
    throw new Error(
      "Project ID must be lowercase, at most 80 characters, and use only letters, digits, hyphens, or underscores",
    )
}

async function git(project: string, args: string[]): Promise<string>
async function git(project: string, args: string[], optional: true): Promise<string | undefined>
async function git(project: string, args: string[], optional = false): Promise<string | undefined> {
  const result = Bun.spawnSync(["git", "-C", project, ...args], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    if (optional) return undefined
    throw new Error(`Git ${args[0]} failed: ${new TextDecoder().decode(result.stderr).trim()}`)
  }
  return new TextDecoder().decode(result.stdout).trim()
}

async function runGit(args: string[]) {
  const child = Bun.spawn(["git", ...args], { stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`Git ${args[0]} failed: ${stderr.trim()}`)
}
