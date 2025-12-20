import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import z from "zod"
import { errors } from "./error"
import { homedir } from "os"
import fs from "fs/promises"
import path from "path"
import fuzzysort from "fuzzysort"

const DirectoryInfo = z
  .object({
    path: z.string(),
    name: z.string(),
    isGitRepo: z.boolean(),
    isExistingProject: z.boolean(),
  })
  .meta({ ref: "DirectoryInfo" })
type DirectoryInfo = z.infer<typeof DirectoryInfo>

async function scanDirectories(rootPath: string, maxDepth = 2): Promise<DirectoryInfo[]> {
  const results: DirectoryInfo[] = []
  const existingProjects = await Project.list()
  const existingWorktrees = new Set(existingProjects.map((p) => p.worktree))

  async function scan(dir: string, depth: number) {
    if (depth > maxDepth) return

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        // Skip hidden directories and common non-project directories
        if (entry.name.startsWith(".")) continue
        if (["node_modules", "vendor", "__pycache__", "target", "build", "dist", ".git"].includes(entry.name)) continue

        const fullPath = path.join(dir, entry.name)

        // Check if it's a git repo
        const gitPath = path.join(fullPath, ".git")
        const isGitRepo = await fs
          .access(gitPath)
          .then(() => true)
          .catch(() => false)

        // Check if already a project
        const isExistingProject = existingWorktrees.has(fullPath)

        results.push({
          path: fullPath,
          name: entry.name,
          isGitRepo,
          isExistingProject,
        })

        // Only recurse into non-git directories (don't go into subdirs of git repos)
        if (!isGitRepo && depth < maxDepth) {
          await scan(fullPath, depth + 1)
        }
      }
    } catch {
      // Permission denied or other errors - skip
    }
  }

  await scan(rootPath, 0)
  return results
}

export const ProjectRoute = new Hono()
  .get(
    "/",
    describeRoute({
      summary: "List all projects",
      description: "Get a list of projects that have been opened with OpenCode.",
      operationId: "project.list",
      responses: {
        200: {
          description: "List of projects",
          content: {
            "application/json": {
              schema: resolver(Project.Info.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const projects = await Project.list()
      return c.json(projects)
    },
  )
  .get(
    "/current",
    describeRoute({
      summary: "Get current project",
      description: "Retrieve the currently active project that OpenCode is working with.",
      operationId: "project.current",
      responses: {
        200: {
          description: "Current project information",
          content: {
            "application/json": {
              schema: resolver(Project.Info),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(Instance.project)
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Create project",
      description:
        "Create a new project directory and initialize it as a git repository, or add an existing directory as a project.",
      operationId: "project.create",
      responses: {
        200: {
          description: "Created or added project information",
          content: {
            "application/json": {
              schema: resolver(Project.CreateResult),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", Project.create.schema),
    async (c) => {
      const body = c.req.valid("json")
      const result = await Project.create(body)
      return c.json(result)
    },
  )
  .patch(
    "/:projectID",
    describeRoute({
      summary: "Update project",
      description: "Update project properties such as name, icon and color.",
      operationId: "project.update",
      responses: {
        200: {
          description: "Updated project information",
          content: {
            "application/json": {
              schema: resolver(Project.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ projectID: z.string() })),
    validator("json", Project.update.schema.omit({ projectID: true })),
    async (c) => {
      const projectID = c.req.valid("param").projectID
      const body = c.req.valid("json")
      const project = await Project.update({ ...body, projectID })
      return c.json(project)
    },
  )
  .get(
    "/browse",
    describeRoute({
      summary: "Browse directories",
      description:
        "Browse directories from the user's home directory to find potential projects. Supports fuzzy search filtering.",
      operationId: "project.browse",
      responses: {
        200: {
          description: "List of directories",
          content: {
            "application/json": {
              schema: resolver(DirectoryInfo.array()),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        query: z.string().optional(),
        limit: z.coerce.number().optional().default(50),
      }),
    ),
    async (c) => {
      const { query, limit } = c.req.valid("query")
      const home = homedir()

      // Scan directories from home
      const allDirs = await scanDirectories(home, 2)

      // Sort: git repos first, then by name
      allDirs.sort((a, b) => {
        // Existing projects last (they're already added)
        if (a.isExistingProject !== b.isExistingProject) {
          return a.isExistingProject ? 1 : -1
        }
        // Git repos first
        if (a.isGitRepo !== b.isGitRepo) {
          return a.isGitRepo ? -1 : 1
        }
        // Then alphabetically
        return a.name.localeCompare(b.name)
      })

      // Apply fuzzy filter if query provided
      if (query && query.trim()) {
        const filtered = fuzzysort
          .go(query, allDirs, {
            keys: ["name", "path"],
            limit,
          })
          .map((r) => r.obj)
        return c.json(filtered)
      }

      return c.json(allDirs.slice(0, limit))
    },
  )
