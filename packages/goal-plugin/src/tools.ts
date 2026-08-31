// The seven goal lifecycle tools. All are direct model tools (codemode: false)
// with raw JSON Schema inputs and a stable structured result envelope; the
// model-visible content is a concise rendering of the same result.

import type { Info } from "@opencode-ai/plugin/promise/tool"
import { BOUNDS } from "./state"
import type { GoalService, GoalToolResult } from "./service"

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "number" },
    ok: { type: "boolean" },
    code: {
      type: "string",
      enum: [
        "ok",
        "no_goal",
        "goal_exists",
        "invalid_transition",
        "invalid_input",
        "evidence_rejected",
        "owned_elsewhere",
        "persistence_failed",
      ],
    },
    state: { type: "string" },
    data: {},
    message: { type: "string" },
  },
  required: ["version", "ok", "code", "message"],
}

export function createGoalTools(service: GoalService): Info[] {
  const options = { codemode: false as const }
  const wrap = (result: GoalToolResult) => ({ output: result, content: result.message })

  return [
    {
      name: "goal_set",
      description:
        "Start one explicit Session goal with a concrete objective, success criteria, and constraints. " +
        "Fails while another goal is active, paused, blocked, or limited; clear it first with goal_clear.",
      input: {
        type: "object",
        properties: {
          objective: { type: "string", maxLength: BOUNDS.objective, description: "The concrete objective to pursue." },
          success_criteria: {
            type: "array",
            items: { type: "string", maxLength: BOUNDS.item },
            maxItems: BOUNDS.criteriaCount,
            description: "Verifiable conditions that define success. Preserve user-stated criteria verbatim.",
          },
          constraints: {
            type: "array",
            items: { type: "string", maxLength: BOUNDS.item },
            maxItems: BOUNDS.criteriaCount,
            description: "Hard constraints the work must respect.",
          },
          references: {
            type: "array",
            items: { type: "string", maxLength: BOUNDS.filePath },
            maxItems: BOUNDS.referenceCount,
            description:
              "Workspace-relative paths of goal-package documents to keep visible every step, " +
              "such as a reviewed plan.md and facts.md. List the plan first.",
          },
        },
        required: ["objective"],
      },
      output: RESULT_SCHEMA,
      options,
      execute: async (input, context) => wrap(await service.set(context.sessionID, input)),
    },
    {
      name: "goal_status",
      description: "Report the active or latest terminal goal state, window usage, and lifetime accounting.",
      input: { type: "object", properties: {} },
      output: RESULT_SCHEMA,
      options,
      execute: async (_input, context) => wrap(await service.status(context.sessionID)),
    },
    {
      name: "goal_pause",
      description: "Pause the active goal. Automatic continuation stops until a user resumes it.",
      input: { type: "object", properties: {} },
      output: RESULT_SCHEMA,
      options,
      execute: async (_input, context) => wrap(await service.pause(context.sessionID)),
    },
    {
      name: "goal_resume",
      description:
        "Resume a paused, blocked, or limited goal with a fresh bounded Window. " +
        "Pass takeover: true only when the user explicitly asks to take over goal state owned by a dead process.",
      input: {
        type: "object",
        properties: {
          takeover: {
            type: "boolean",
            description: "Force-replace a stale owner. Only on explicit user request.",
          },
          limits: {
            type: "object",
            description: "Optional Window limit overrides. Each value is a positive integer or null.",
            properties: {
              continuations: { type: ["integer", "null"] },
              duration_ms: { type: ["integer", "null"] },
              tokens: { type: ["integer", "null"] },
              tool_free_steps: { type: ["integer", "null"] },
              no_progress_steps: { type: ["integer", "null"] },
              prompt_failures: { type: ["integer", "null"] },
            },
          },
        },
      },
      output: RESULT_SCHEMA,
      options,
      execute: async (input, context) => wrap(await service.resume(context.sessionID, input)),
    },
    {
      name: "goal_block",
      description:
        "Record a concrete external dependency that prevents progress and pause the goal. " +
        "Only for dependencies that cannot be resolved with available tools; generic or circular reasons are rejected.",
      input: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            maxLength: BOUNDS.item,
            description: "The concrete blocking dependency.",
          },
          needed: {
            type: "string",
            maxLength: BOUNDS.item,
            description: "What would unblock the goal.",
          },
        },
        required: ["reason"],
      },
      output: RESULT_SCHEMA,
      options,
      execute: async (input, context) => wrap(await service.block(context.sessionID, input)),
    },
    {
      name: "goal_complete",
      description:
        "Submit a structured completion claim for the active goal. Every stored success criterion needs " +
        "non-empty evidence and no check may be failed. Evidence is a claim, not proof; it is validated for " +
        "structure and consistency, and a rejected claim leaves the goal active with exact deficiencies.",
      input: {
        type: "object",
        properties: {
          summary: { type: "string", maxLength: BOUNDS.objective, description: "What was accomplished." },
          criteria: {
            type: "array",
            description: "One entry per stored success criterion with concrete evidence.",
            items: {
              type: "object",
              properties: {
                criterion: { type: "string", maxLength: BOUNDS.item },
                evidence: { type: "string", maxLength: BOUNDS.item },
              },
              required: ["criterion", "evidence"],
            },
          },
          checks: {
            type: "array",
            description: "Verification commands that were run and their outcomes.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                status: { type: "string", enum: ["passed", "failed", "not_run"] },
                detail: { type: "string", maxLength: BOUNDS.detail },
              },
              required: ["name", "status"],
            },
            maxItems: BOUNDS.checkCount,
          },
          changed_files: {
            type: "array",
            items: { type: "string", maxLength: BOUNDS.filePath },
            maxItems: BOUNDS.fileCount,
            description: "Relative, normalized, unique paths of changed files.",
          },
          limitations: {
            type: "array",
            items: { type: "string", maxLength: BOUNDS.item },
            description: "Known limitations. Required when any check is not_run.",
          },
        },
        required: ["summary", "criteria"],
      },
      output: RESULT_SCHEMA,
      options,
      execute: async (input, context) => wrap(await service.complete(context.sessionID, input)),
    },
    {
      name: "goal_clear",
      description: "Remove the retained goal state for this Session. Bounded audit history is kept.",
      input: { type: "object", properties: {} },
      output: RESULT_SCHEMA,
      options,
      execute: async (_input, context) => wrap(await service.clear(context.sessionID)),
    },
  ]
}
