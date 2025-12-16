import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { mergeDeep } from "remeda"
import { minimatch } from "minimatch"
import * as path from "node:path"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: z.object({
        edit: z.union([Config.Permission, z.record(z.string(), Config.Permission)]),
        bash: z.record(z.string(), Config.Permission),
        webfetch: Config.Permission.optional(),
        doom_loop: Config.Permission.optional(),
        external_directory: Config.Permission.optional(),
      }),
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      tools: z.record(z.string(), z.boolean()),
      options: z.record(z.string(), z.any()),
      maxSteps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()
    const configTools = cfg.tools ?? {}
    const defaultTools: Record<string, boolean> = {
      ask: false,
      ...configTools,
    }
    const defaultPermission: Info["permission"] = {
      edit: "allow",
      bash: {
        "*": "allow",
      },
      webfetch: "allow",
      doom_loop: "ask",
      external_directory: "ask",
    }
    const agentPermission = mergeAgentPermissions(defaultPermission, cfg.permission ?? {})

    const planPermission = mergeAgentPermissions(
      {
        edit: "deny",
        bash: {
          "cut*": "allow",
          "diff*": "allow",
          "du*": "allow",
          "file *": "allow",
          "find * -delete*": "ask",
          "find * -exec*": "ask",
          "find * -fprint*": "ask",
          "find * -fls*": "ask",
          "find * -fprintf*": "ask",
          "find * -ok*": "ask",
          "find *": "allow",
          "git diff*": "allow",
          "git log*": "allow",
          "git show*": "allow",
          "git status*": "allow",
          "git branch": "allow",
          "git branch -v": "allow",
          "grep*": "allow",
          "head*": "allow",
          "less*": "allow",
          "ls*": "allow",
          "more*": "allow",
          "pwd*": "allow",
          "rg*": "allow",
          "sort --output=*": "ask",
          "sort -o *": "ask",
          "sort*": "allow",
          "stat*": "allow",
          "tail*": "allow",
          "tree -o *": "ask",
          "tree*": "allow",
          "uniq*": "allow",
          "wc*": "allow",
          "whereis*": "allow",
          "which*": "allow",
          "*": "ask",
        },
        webfetch: "allow",
      },
      cfg.permission ?? {},
    )

    const result: Record<string, Info> = {
      build: {
        name: "build",
        tools: { ...defaultTools },
        options: {},
        permission: agentPermission,
        mode: "primary",
        native: true,
      },
      plan: {
        name: "plan",
        options: {},
        permission: planPermission,
        tools: {
          ask: true,
          ...configTools,
        },
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        tools: {
          todoread: false,
          todowrite: false,
          ...defaultTools,
        },
        options: {},
        permission: agentPermission,
        mode: "subagent",
        native: true,
        hidden: true,
      },
      explore: {
        name: "explore",
        tools: {
          todoread: false,
          todowrite: false,
          edit: false,
          write: false,
          ...defaultTools,
        },
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        permission: agentPermission,
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        tools: {
          "*": false,
        },
        options: {},
        permission: agentPermission,
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: agentPermission,
        prompt: PROMPT_TITLE,
        tools: {
          ask: false,
        },
      },
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: agentPermission,
        prompt: PROMPT_SUMMARY,
        tools: {
          ask: false,
        },
      },
    }
    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: agentPermission,
          options: {},
          tools: {},
          native: false,
        }
      const {
        name,
        model,
        prompt,
        tools,
        subagents: _subagents,
        description,
        temperature,
        top_p,
        mode,
        permission,
        color,
        maxSteps,
        ...extra
      } = value
      item.options = {
        ...item.options,
        ...extra,
      }
      if (model) item.model = Provider.parseModel(model)
      if (prompt) item.prompt = prompt
      if (tools)
        item.tools = {
          ...item.tools,
          ...tools,
        }
      item.tools = {
        ...defaultTools,
        ...item.tools,
      }
      if (description) item.description = description
      if (temperature != undefined) item.temperature = temperature
      if (top_p != undefined) item.topP = top_p
      if (mode) item.mode = mode
      if (color) item.color = color
      // just here for consistency & to prevent it from being added as an option
      if (name) item.name = name
      if (maxSteps != undefined) item.maxSteps = maxSteps

      if (permission ?? cfg.permission) {
        item.permission = mergeAgentPermissions(cfg.permission ?? {}, permission ?? {})
      }
    }
    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)
    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()
    const result = await generateObject({
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    })
    return result.object
  }

  /**
   * Resolve file permission from a permission value that may be a string or a pattern map.
   *
   * Precedence rules (most specific wins):
   * 1. Exact match wins
   * 2. More path segments wins
   * 3. Longer pattern wins (tiebreaker)
   * 4. "*" is always fallback
   */
  export function resolveFilePermission(input: {
    permission: Config.Permission | Record<string, Config.Permission>
    filePath: string
    baseDir: string
  }): Config.Permission {
    const { permission, filePath, baseDir } = input

    // If permission is a string, return it directly (backward compatible)
    if (typeof permission === "string") {
      return permission
    }

    // Normalize filePath to relative path under baseDir
    const resolved = path.resolve(filePath)
    const relative = path.relative(baseDir, resolved)

    // Convert to POSIX separators for minimatch compatibility
    const posixPath = relative.replace(/\\/g, "/")

    // Detect platform for case sensitivity
    const isCaseInsensitive = process.platform === "darwin" || process.platform === "win32"

    // Evaluate patterns with deterministic precedence
    type Match = { pattern: string; permission: Config.Permission; score: number }
    const matches: Match[] = []

    for (const [pattern, perm] of Object.entries(permission)) {
      // Skip * fallback for now, we'll use it only if nothing else matches
      if (pattern === "*") continue

      const matched = minimatch(posixPath, pattern, {
        nocase: isCaseInsensitive,
        dot: true, // match dotfiles
      })

      if (matched) {
        // Calculate precedence score:
        // - Exact match gets highest score
        // - More path segments = higher score
        // - Longer pattern = higher score (tiebreaker)
        const isExact = pattern === posixPath || pattern === relative
        const segments = pattern.split("/").filter((s) => s && s !== "**").length
        const score = isExact ? 10000 : segments * 100 + pattern.length

        matches.push({ pattern, permission: perm, score })
      }
    }

    // Sort by score descending (highest score = most specific = wins)
    matches.sort((a, b) => b.score - a.score)

    // Return the most specific match, or fall back to * pattern, or default to "allow"
    if (matches.length > 0) {
      return matches[0].permission
    }

    // Use * fallback if defined
    if (permission["*"]) {
      return permission["*"]
    }

    // Default to allow (backward compatible behavior)
    return "allow"
  }
}

function mergeAgentPermissions(basePermission: any, overridePermission: any): Agent.Info["permission"] {
  // Normalize bash to object form
  if (typeof basePermission.bash === "string") {
    basePermission.bash = {
      "*": basePermission.bash,
    }
  }
  if (typeof overridePermission.bash === "string") {
    overridePermission.bash = {
      "*": overridePermission.bash,
    }
  }
  // Normalize edit to object form if override is an object (more specific wins)
  // If base is string and override is object, convert base to object with * fallback
  if (typeof basePermission.edit === "string" && typeof overridePermission.edit === "object") {
    basePermission.edit = {
      "*": basePermission.edit,
    }
  }
  // If base is object and override is string, convert override to * fallback in object
  if (typeof basePermission.edit === "object" && typeof overridePermission.edit === "string") {
    overridePermission.edit = {
      "*": overridePermission.edit,
    }
  }

  const merged = mergeDeep(basePermission ?? {}, overridePermission ?? {}) as any

  let mergedBash
  if (merged.bash) {
    if (typeof merged.bash === "string") {
      mergedBash = {
        "*": merged.bash,
      }
    } else if (typeof merged.bash === "object") {
      mergedBash = mergeDeep(
        {
          "*": "allow",
        },
        merged.bash,
      )
    }
  }

  // Merge edit similar to bash - keep as object if either was object
  let mergedEdit: Config.Permission | Record<string, Config.Permission> = merged.edit ?? "allow"
  if (typeof mergedEdit === "object") {
    mergedEdit = mergeDeep(
      {
        "*": "allow" as Config.Permission,
      },
      mergedEdit,
    ) as Record<string, Config.Permission>
  }

  const result: Agent.Info["permission"] = {
    edit: mergedEdit,
    webfetch: merged.webfetch ?? "allow",
    bash: mergedBash ?? { "*": "allow" },
    doom_loop: merged.doom_loop,
    external_directory: merged.external_directory,
  }

  return result
}
