import z from "zod"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { $ } from "bun"
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
      sandboxes: z.array(z.string()),
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

    const { id, sandbox, worktree, vcs } = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const git = await matches.next().then((x) => x.value)
      await matches.return()
      if (git) {
        let sandbox = path.dirname(git)

        // cached id calculation
        let id = await Bun.file(path.join(git, "opencode"))
          .text()
          .then((x) => x.trim())
          .catch(() => {})

        // generate id from root commit
        if (!id) {
          const roots = await $`git rev-list --max-parents=0 --all`
            .quiet()
            .nothrow()
            .cwd(sandbox)
            .text()
            .then((x) =>
              x
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
          id = roots[0]
          if (id) Bun.file(path.join(git, "opencode")).write(id)
        }

        if (!id)
          return {
            id: "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: "git",
          }

        sandbox = await $`git rev-parse --show-toplevel`
          .quiet()
          .nothrow()
          .cwd(sandbox)
          .text()
          .then((x) => path.resolve(sandbox, x.trim()))
        const worktree = await $`git rev-parse --git-common-dir`
          .quiet()
          .nothrow()
          .cwd(sandbox)
          .text()
          .then((x) => {
            const dirname = path.dirname(x.trim())
            if (dirname === ".") return sandbox
            return dirname
          })
        return {
          id,
          sandbox,
          worktree,
          vcs: "git",
        }
      }

      return {
        id: "global",
        worktree: "/",
        sandbox: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    let existing = await Storage.read<Info>(["project", id]).catch(() => undefined)
    if (!existing) {
      existing = {
        id,
        worktree,
        vcs: vcs as Info["vcs"],
        sandboxes: [],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      if (id !== "global") {
        await migrateFromGlobal(id, worktree)
      }
    }

    // migrate old projects before sandboxes
    if (!existing.sandboxes) existing.sandboxes = []

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
    if (sandbox !== result.worktree && !result.sandboxes.includes(sandbox)) result.sandboxes.push(sandbox)
    await Storage.write<Info>(["project", id], result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox }
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
      const { project } = await fromDirectory(projectPath)

      // Set custom name if provided
      if (input.name) {
        await update({ projectID: project.id, name: input.name })
        return { project: { ...project, name: input.name }, created: isNewlyCreated }
      }

      return { project, created: isNewlyCreated }
    },
  )

  export async function sandboxes(projectID: string) {
    const project = await Storage.read<Info>(["project", projectID]).catch(() => undefined)
    if (!project?.sandboxes) return []
    const valid: string[] = []
    for (const dir of project.sandboxes) {
      const stat = await fs.stat(dir).catch(() => undefined)
      if (stat?.isDirectory()) valid.push(dir)
    }
    return valid
  }
}
