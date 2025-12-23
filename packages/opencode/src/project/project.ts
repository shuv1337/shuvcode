import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { $ } from "bun"
import fs from "fs/promises"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { Session } from "../session"
import { work } from "../util/queue"
import { fn } from "@opencode-ai/util/fn"
import { NamedError } from "@opencode-ai/util/error"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"

export namespace Project {
  const log = Log.create({ service: "project" })
  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

    const { id, worktree, vcs } = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const git = await matches.next().then((x) => x.value)
      await matches.return()
      if (git) {
        // Task 1.1: Resolve worktree path early before ID generation
        let worktree = path.dirname(git)
        worktree = await $`git rev-parse --show-toplevel`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) => path.resolve(worktree, x.trim()))

        // Task 1.2: Resolve actual gitDir (handles linked worktrees where .git is a file)
        // May be relative for main worktrees, absolute for linked
        const gitDirRaw = await $`git rev-parse --git-dir`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) => x.trim())
        // Fall back to Filesystem.up result if git command fails
        const gitDir = gitDirRaw ? path.resolve(worktree, gitDirRaw) : git

        // Task 1.3: Detect linked worktree (case-insensitive for Windows)
        const normalizedGitDir = path.normalize(gitDir).toLowerCase()
        const worktreeMarker = path.join(".git", "worktrees").toLowerCase()
        const isLinkedWorktree = normalizedGitDir.includes(worktreeMarker)
        log.info("worktree detection", { isLinkedWorktree, gitDir: normalizedGitDir })

        // Task 1.4: Read caches
        const cachedRootCommit = await Bun.file(path.join(gitDir, "opencode"))
          .text()
          .then((x) => x.trim())
          .catch(() => undefined)
        const cachedWorktreeHash = isLinkedWorktree
          ? await Bun.file(path.join(gitDir, "opencode-worktree"))
              .text()
              .then((x) => x.trim())
              .catch(() => undefined)
          : undefined

        // Return early with cached ID if both are available
        if (cachedRootCommit && (!isLinkedWorktree || cachedWorktreeHash)) {
          const id = isLinkedWorktree ? `${cachedRootCommit}-${cachedWorktreeHash}` : cachedRootCommit
          return { id, worktree, vcs: "git" }
        }

        // Compute root commit if needed
        const roots = await $`git rev-list --max-parents=0 --all`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) =>
            x
              .split("\n")
              .filter(Boolean)
              .map((x) => x.trim())
              .toSorted(),
          )
        const rootCommit = roots[0]
        if (!rootCommit) {
          return {
            id: "global",
            worktree,
            vcs: "git",
          }
        }

        // Task 1.5: Generate differentiated ID (cross-platform safe)
        // Normalize path separators for consistent hashing across platforms (WSL + Windows)
        const normalizedPath = worktree.replace(/\\/g, "/")
        const worktreeHash = isLinkedWorktree ? Bun.hash(normalizedPath).toString(16) : undefined
        const id = isLinkedWorktree ? `${rootCommit}-${worktreeHash}` : rootCommit

        // Task 1.6: Write caches (awaited - fixes existing bug where writes weren't awaited)
        if (isLinkedWorktree && worktreeHash) {
          await Bun.file(path.join(gitDir, "opencode-worktree")).write(worktreeHash)
        }
        if (!cachedRootCommit) {
          await Bun.file(path.join(gitDir, "opencode")).write(rootCommit)
        }

        // Task 2.1-2.3: Migration hook (linked worktrees only, with race protection)
        if (isLinkedWorktree) {
          const newProjectExists = await Storage.read(["project", id]).catch(() => undefined)
          if (!newProjectExists) {
            await migrateWorktreeSessions(rootCommit, id, worktree)
            await cleanupLegacyProject(rootCommit)
          }
        }

        return { id, worktree, vcs: "git" }
      }

      return {
        id: "global",
        worktree: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    let existing = await Storage.read<Info>(["project", id]).catch(() => undefined)
    if (!existing) {
      existing = {
        id,
        worktree,
        vcs: vcs as Info["vcs"],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      if (id !== "global") {
        await migrateFromGlobal(id, worktree)
      }
    }
    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)
    const result: Info = {
      ...existing,
      worktree,
      vcs: vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    await Storage.write<Info>(["project", id], result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return result
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.url) return
    const glob = new Bun.Glob("**/{favicon}.{ico,png,svg,jpg,jpeg,webp}")
    const matches = await Array.fromAsync(
      glob.scan({
        cwd: input.worktree,
        absolute: true,
        onlyFiles: true,
        followSymlinks: false,
        dot: false,
      }),
    )
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const file = Bun.file(shortest)
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const mime = file.type || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  async function migrateFromGlobal(newProjectID: string, worktree: string) {
    const globalProject = await Storage.read<Info>(["project", "global"]).catch(() => undefined)
    if (!globalProject) return

    const globalSessions = await Storage.list(["session", "global"]).catch(() => [])
    if (globalSessions.length === 0) return

    log.info("migrating sessions from global", { newProjectID, worktree, count: globalSessions.length })

    await work(10, globalSessions, async (key) => {
      const sessionID = key[key.length - 1]
      const session = await Storage.read<Session.Info>(key).catch(() => undefined)
      if (!session) return
      if (session.directory && session.directory !== worktree) return

      session.projectID = newProjectID
      log.info("migrating session", { sessionID, from: "global", to: newProjectID })
      await Storage.write(["session", newProjectID, sessionID], session)
      await Storage.remove(key)
    }).catch((error) => {
      log.error("failed to migrate sessions from global to project", { error, projectId: newProjectID })
    })
  }

  // Project ID formats:
  // - Main worktree: "{rootCommit}" (e.g., "a1b2c3d4...")
  // - Linked worktree: "{rootCommit}-{pathHash}" (e.g., "a1b2c3d4...-7f8a9b2c")
  // The separator is "-" (not "|") because project IDs are used in filesystem paths

  // Task 2.2: Migrate sessions from old project ID to new project ID for linked worktrees
  async function migrateWorktreeSessions(oldProjectID: string, newProjectID: string, worktree: string) {
    const oldSessions = await Storage.list(["session", oldProjectID]).catch(() => [])
    if (oldSessions.length === 0) return

    log.info("migrating worktree sessions", {
      from: oldProjectID,
      to: newProjectID,
      worktree,
      count: oldSessions.length,
    })

    await work(10, oldSessions, async (key) => {
      const sessionID = key[key.length - 1]
      const session = await Storage.read<Session.Info>(key).catch(() => undefined)
      if (!session) return
      // Only migrate sessions that match this worktree
      if (session.directory !== worktree) return

      // Idempotency check: skip if already migrated
      const existingSession = await Storage.read(["session", newProjectID, sessionID]).catch(() => undefined)
      if (existingSession) {
        log.info("session already migrated, skipping", { sessionID })
        return
      }

      session.projectID = newProjectID
      log.info("migrating session", { sessionID, from: oldProjectID, to: newProjectID })
      await Storage.write(["session", newProjectID, sessionID], session)
      await Storage.remove(key)
    }).catch((error) => {
      log.error("failed to migrate worktree sessions", { error, from: oldProjectID, to: newProjectID })
    })
  }

  // Task 2.3: Clean up empty legacy project entry after migration
  async function cleanupLegacyProject(oldProjectID: string) {
    const remainingSessions = await Storage.list(["session", oldProjectID]).catch(() => [])
    if (remainingSessions.length === 0) {
      log.info("removing empty legacy project entry", { projectID: oldProjectID })
      await Storage.remove(["project", oldProjectID]).catch(() => {})
    }
  }

  export async function setInitialized(projectID: string) {
    await Storage.update<Info>(["project", projectID], (draft) => {
      draft.time.initialized = Date.now()
    })
  }

  export async function list() {
    const keys = await Storage.list(["project"])
    return await Promise.all(keys.map((x) => Storage.read<Info>(x)))
  }

  export const update = fn(
    z.object({
      projectID: z.string(),
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
    }),
    async (input) => {
      const result = await Storage.update<Info>(["project", input.projectID], (draft) => {
        if (input.name !== undefined) draft.name = input.name
        if (input.icon !== undefined) {
          draft.icon = {
            ...draft.icon,
          }
          if (input.icon.url !== undefined) draft.icon.url = input.icon.url
          if (input.icon.color !== undefined) draft.icon.color = input.icon.color
        }
        draft.time.updated = Date.now()
      })
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: result,
        },
      })
      return result
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
      const project = await fromDirectory(projectPath)

      // Set custom name if provided
      if (input.name) {
        await update({ projectID: project.id, name: input.name })
        return { project: { ...project, name: input.name }, created: isNewlyCreated }
      }

      return { project, created: isNewlyCreated }
    },
  )
}
