import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { and, Database, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { fn } from "@opencode-ai/util/fn"
import { NamedError } from "@opencode-ai/util/error"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import fs from "fs/promises"
import { $ } from "bun"
import { git } from "../util/git"
import { Glob } from "../util/glob"
import { which } from "../util/which"
import { ProjectID } from "./schema"

export namespace Project {
  const log = Log.create({ service: "project" })

  function gitpath(cwd: string, name: string) {
    if (!name) return cwd
    // git output includes trailing newlines; keep path whitespace intact.
    name = name.replace(/[\r\n]+$/, "")
    if (!name) return cwd

    name = Filesystem.windowsPath(name)

    if (path.isAbsolute(name)) return path.normalize(name)
    return path.resolve(cwd, name)
  }

  export const Info = z
    .object({
      id: ProjectID.zod,
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    return {
      id: ProjectID.make(row.id),
      worktree: row.worktree,
      vcs: row.vcs ? Info.shape.vcs.parse(row.vcs) : undefined,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes: row.sandboxes,
      commands: row.commands ?? undefined,
    }
  }

  function readCachedId(dir: string) {
    return Filesystem.readText(path.join(dir, "opencode"))
      .then((x) => x.trim())
      .then(ProjectID.make)
      .catch(() => undefined)
  }

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

    const data = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const dotgit = await matches.next().then((x) => x.value)
      await matches.return()
      if (dotgit) {
        let sandbox = path.dirname(dotgit)

        const gitBinary = which("git")

        // cached id calculation
        let id = await readCachedId(dotgit)

        if (!gitBinary) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        const worktree = await git(["rev-parse", "--git-common-dir"], {
          cwd: sandbox,
        })
          .then(async (result) => {
            const common = gitpath(sandbox, await result.text())
            // Avoid going to parent of sandbox when git-common-dir is empty.
            return common === sandbox ? sandbox : path.dirname(common)
          })
          .catch(() => undefined)

        if (!worktree) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // In the case of a git worktree, it can't cache the id
        // because `.git` is not a folder, but it always needs the
        // same project id as the common dir, so we resolve it now
        if (id == null) {
          id = await readCachedId(path.join(worktree, ".git"))
        }

        // generate id from root commit
        if (!id) {
          const roots = await git(["rev-list", "--max-parents=0", "HEAD"], {
            cwd: sandbox,
          })
            .then(async (result) =>
              (await result.text())
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
            .catch(() => undefined)

          if (!roots) {
            return {
              id: ProjectID.global,
              worktree: sandbox,
              sandbox,
              vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
            }
          }

          id = roots[0] ? ProjectID.make(roots[0]) : undefined
          if (id) {
            // Write to common dir so the cache is shared across worktrees.
            await Filesystem.write(path.join(worktree, ".git", "opencode"), id).catch(() => undefined)
          }
        }

        if (!id) {
          return {
            id: ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: "git",
          }
        }

        const top = await git(["rev-parse", "--show-toplevel"], {
          cwd: sandbox,
        })
          .then(async (result) => gitpath(sandbox, await result.text()))
          .catch(() => undefined)

        if (!top) {
          return {
            id,
            worktree: sandbox,
            sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        sandbox = top

        return {
          id,
          sandbox,
          worktree,
          vcs: "git",
        }
      }

      return {
        id: ProjectID.global,
        worktree: "/",
        sandbox: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
    const existing = row
      ? fromRow(row)
      : {
          id: data.id,
          worktree: data.worktree,
          vcs: data.vcs as Info["vcs"],
          sandboxes: [] as string[],
          time: {
            created: Date.now(),
            updated: Date.now(),
          },
        }

    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    const result: Info = {
      ...existing,
      worktree: data.worktree,
      vcs: data.vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
      result.sandboxes.push(data.sandbox)
    result.sandboxes = result.sandboxes.filter((x) => existsSync(x))
    const insert = {
      id: result.id,
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_created: result.time.created,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    const updateSet = {
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    Database.use((db) =>
      db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run(),
    )
    // Runs after upsert so the target project row exists (FK constraint).
    // Runs on every startup because sessions created before git init
    // accumulate under "global" and need migrating whenever they appear.
    if (data.id !== ProjectID.global) {
      Database.use((db) =>
        db
          .update(SessionTable)
          .set({ project_id: data.id })
          .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, data.worktree)))
          .run(),
      )
    }
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox: data.sandbox }
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const matches = await Glob.scan("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
      cwd: input.worktree,
      absolute: true,
      include: "file",
    })
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const buffer = await Filesystem.readBytes(shortest)
    const base64 = buffer.toString("base64")
    const mime = Filesystem.mimeType(shortest) || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  export function setInitialized(id: ProjectID) {
    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .run(),
    )
  }

  export function list() {
    return Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .all()
        .map((row) => fromRow(row)),
    )
  }

  export function get(id: ProjectID): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return fromRow(row)
  }

  export async function initGit(input: { directory: string; project: Info }) {
    if (input.project.vcs === "git") return input.project
    if (!which("git")) throw new Error("Git is not installed")

    const result = await git(["init", "--quiet"], {
      cwd: input.directory,
    })
    if (result.exitCode !== 0) {
      const text = result.stderr.toString().trim() || result.text().trim()
      throw new Error(text || "Failed to initialize git repository")
    }

    return (await fromDirectory(input.directory)).project
  }

  export const update = fn(
    z.object({
      projectID: ProjectID.zod,
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const id = ProjectID.make(input.projectID)
      const result = Database.use((db) =>
        db
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, id))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: data,
        },
      })
      return data
    },
  )

  export const CreateError = NamedError.create("CreateProjectError", z.object({ message: z.string() }))

  export const CreateResult = z
    .object({
      project: Info,
      created: z.boolean().describe("True if a new project was created, false if an existing project was added"),
    })
    .meta({ ref: "ProjectCreateResult" })
  export type CreateResult = z.infer<typeof CreateResult>

  export const create = fn(
    z.object({
      path: z.string().min(1),
      name: z.string().optional(),
      repo: z.string().optional(),
      degit: z.boolean().optional(),
    }),
    async (input): Promise<CreateResult> => {
      const expandedPath = Filesystem.expanduser(input.path)
      const projectPath = path.resolve(expandedPath)

      // Validate absolute path
      if (!path.isAbsolute(expandedPath)) {
        throw new CreateError({ message: "Path must be absolute" })
      }

      // Check if directory already exists
      const directoryExists = await fs
        .access(projectPath)
        .then(() => true)
        .catch(() => false)

      // Create directory if it doesn't exist
      await fs.mkdir(projectPath, { recursive: true })

      if (input.repo) {
        const entries = await fs.readdir(projectPath)
        if (entries.length > 0) {
          const isGit = await fs
            .access(path.join(projectPath, ".git"))
            .then(() => true)
            .catch(() => false)
          if (!isGit) {
            throw new CreateError({ message: "Directory is not empty" })
          }
        } else {
          await $`git clone ${input.repo} .`.cwd(projectPath).quiet()
        }
      }

      // Check if it's already a git repo with commits
      const gitDir = path.join(projectPath, ".git")
      let isGitRepo = await fs
        .access(gitDir)
        .then(() => true)
        .catch(() => false)

      if (input.degit && isGitRepo) {
        await fs.rm(gitDir, { recursive: true, force: true })
        isGitRepo = false
      }

      // Determine if this is a newly created project or an existing one being added
      const isNewlyCreated = !directoryExists || !isGitRepo || Boolean(input.repo)

      if (!isGitRepo) {
        // Initialize git and create initial commit (required for project ID which is the first commit hash)
        await $`git init`.cwd(projectPath).quiet()
        const entries = await fs.readdir(projectPath)
        const hasFiles = entries.some((e) => e !== ".git")
        if (hasFiles) {
          await $`git add .`.cwd(projectPath).quiet()
          await $`git -c user.name=${Flag.OPENCODE_GIT_USER_NAME} -c user.email=${Flag.OPENCODE_GIT_USER_EMAIL} commit -m "Initial commit"`
            .cwd(projectPath)
            .quiet()
        } else {
          await $`git -c user.name=${Flag.OPENCODE_GIT_USER_NAME} -c user.email=${Flag.OPENCODE_GIT_USER_EMAIL} commit --allow-empty -m "Initial commit"`
            .cwd(projectPath)
            .quiet()
        }
      } else {
        // Check if there are any commits
        const hasCommits = await $`git rev-list -n 1 --all`.cwd(projectPath).quiet().nothrow().text()
        if (!hasCommits.trim()) {
          await $`git commit --allow-empty -m "Initial commit"`.cwd(projectPath).quiet()
        }
      }

      // Register project using fromDirectory
      const { project } = await fromDirectory(projectPath)

      // Set custom name if provided
      if (input.name) {
        await update({ projectID: project.id, name: input.name })
        return { project: { ...project, name: input.name }, created: isNewlyCreated }
      }

      return { project, created: isNewlyCreated }
    },
  )

  export async function sandboxes(id: ProjectID) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []
    const data = fromRow(row)
    const valid: string[] = []
    for (const dir of data.sandboxes) {
      const s = Filesystem.stat(dir)
      if (s?.isDirectory()) valid.push(dir)
    }
    return valid
  }

  export async function addSandbox(id: ProjectID, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = [...row.sandboxes]
    if (!sandboxes.includes(directory)) sandboxes.push(directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }

  export async function removeSandbox(id: ProjectID, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = row.sandboxes.filter((s) => s !== directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }
}
