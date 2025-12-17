import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Permission } from "../permission"

const DEFAULT_TIMEOUT = 5 * 60 * 1000 // 5 minutes

// =============================================================================
// Normalization helpers for permissive input parsing
// =============================================================================

/**
 * Normalize a single option: string -> {value, label} or fill missing value/label
 */
function normalizeOption(opt: unknown): { value: string; label: string; hint?: string } {
  if (typeof opt === "string") {
    return { value: opt, label: opt }
  }
  if (opt && typeof opt === "object") {
    const obj = opt as Record<string, unknown>
    const value = typeof obj.value === "string" ? obj.value : undefined
    const label = typeof obj.label === "string" ? obj.label : undefined
    const hint = typeof obj.hint === "string" ? obj.hint : undefined
    // Fill missing value/label from the other
    const resolvedValue = value ?? label ?? ""
    const resolvedLabel = label ?? value ?? ""
    return { value: resolvedValue, label: resolvedLabel, ...(hint ? { hint } : {}) }
  }
  return { value: String(opt), label: String(opt) }
}

/**
 * Normalize options array: handle string arrays or objects with partial fields
 */
function normalizeOptions(options: unknown): { value: string; label: string; hint?: string }[] {
  if (!Array.isArray(options)) return []
  return options.map(normalizeOption)
}

/**
 * Extract message from common alias keys: text, prompt, question
 */
function extractMessage(q: Record<string, unknown>): string | undefined {
  if (typeof q.message === "string") return q.message
  if (typeof q.text === "string") return q.text
  if (typeof q.prompt === "string") return q.prompt
  if (typeof q.question === "string") return q.question
  return undefined
}

/**
 * Normalize type field to canonical values
 */
function normalizeType(type: unknown): string {
  if (typeof type !== "string") return "text"
  const lower = type.toLowerCase().replace(/[_-]/g, "")
  if (lower === "multiselect" || lower === "multi") return "multi-select"
  if (lower === "select" || lower === "multiselect" || lower === "confirm" || lower === "text") {
    // return as-is for canonical types
  }
  // Map common variations
  if (type === "multi_select" || type === "multiselect") return "multi-select"
  return type
}

/**
 * Normalize defaultValue for multi-select (wrap string in array)
 */
function normalizeMultiSelectDefault(val: unknown): string[] | undefined {
  if (val === undefined || val === null) return undefined
  if (Array.isArray(val)) return val.map((v) => String(v))
  if (typeof val === "string") return [val]
  return undefined
}

/**
 * Normalize a single question object
 */
function normalizeQuestion(q: unknown): Record<string, unknown> {
  if (!q || typeof q !== "object") return { type: "text", id: "", message: "" }
  const raw = q as Record<string, unknown>

  const type = normalizeType(raw.type)
  const message = extractMessage(raw)
  const id = typeof raw.id === "string" ? raw.id : `q-${Math.random().toString(36).slice(2, 9)}`

  const base: Record<string, unknown> = { type, id, message }

  if (type === "select" || type === "multi-select") {
    base.options = normalizeOptions(raw.options)
  }

  if (type === "select") {
    if (typeof raw.defaultValue === "string") base.defaultValue = raw.defaultValue
  }

  if (type === "multi-select") {
    base.defaultValue = normalizeMultiSelectDefault(raw.defaultValue)
    if (typeof raw.min === "number") base.min = raw.min
    if (typeof raw.max === "number") base.max = raw.max
  }

  if (type === "confirm") {
    if (typeof raw.defaultValue === "boolean") base.defaultValue = raw.defaultValue
  }

  if (type === "text") {
    if (typeof raw.placeholder === "string") base.placeholder = raw.placeholder
    if (typeof raw.defaultValue === "string") base.defaultValue = raw.defaultValue
    if (typeof raw.validate === "string") base.validate = raw.validate
  }

  return base
}

/**
 * Normalize the entire questions array
 */
function normalizeQuestions(questions: unknown): unknown[] {
  if (!Array.isArray(questions)) return []
  return questions.map(normalizeQuestion)
}

/**
 * Normalize timeout: accept string containing digits
 */
function normalizeTimeout(timeout: unknown): number | undefined {
  if (typeof timeout === "number") return timeout
  if (typeof timeout === "string") {
    const parsed = parseInt(timeout, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return undefined
}

/**
 * Format validation errors with actionable guidance for models
 */
function formatAskValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join(".")
    return `- ${path}: ${issue.message}`
  })

  return [
    "The ask tool was called with invalid arguments.",
    "",
    "Issues found:",
    ...issues,
    "",
    "Required format:",
    '- questions[].type: "select" | "multi-select" | "confirm" | "text"',
    "- questions[].id: unique string identifier",
    "- questions[].message: the question text (required)",
    "- questions[].options (for select/multi-select): array of {value: string, label: string}",
    "",
    "Example valid call:",
    JSON.stringify(
      {
        questions: [
          {
            type: "select",
            id: "choice",
            message: "Which option do you prefer?",
            options: [
              { value: "a", label: "Option A" },
              { value: "b", label: "Option B" },
            ],
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n")
}

// State for pending questions - uses Instance.state for proper cleanup on disposal
const state = Instance.state(
  () => {
    // Subscribe to question responses when state is initialized
    Bus.subscribe(TuiEvent.QuestionResponse, async (response) => {
      const s = await state()
      const pending = s.pending[response.properties.questionID]
      if (pending) {
        pending.resolve(response.properties)
        delete s.pending[response.properties.questionID]
      }
    })

    return {
      pending: {} as Record<
        string,
        {
          resolve: (response: Question.Response) => void
          reject: (error: Error) => void
        }
      >,
    }
  },
  async (s) => {
    // On instance disposal, reject all pending questions
    for (const [questionID, item] of Object.entries(s.pending)) {
      item.reject(new Permission.RejectedError("", "ask", "", { questionID }, "Instance disposed"))
      delete s.pending[questionID]
    }
  },
)

// Permissive parameters schema with preprocessing
// The JSON schema sent to models remains strict (guiding correct output)
// But at runtime, we normalize common deviations before validation
const AskParameters = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object") return input
    const raw = input as Record<string, unknown>
    return {
      ...raw,
      questions: normalizeQuestions(raw.questions),
      timeout: normalizeTimeout(raw.timeout),
    }
  },
  z.object({
    questions: z
      .array(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("select"),
            id: z.string().describe("Unique identifier for this question"),
            message: z.string().describe("The question to ask"),
            options: z
              .array(
                z.object({
                  value: z.string().describe("The value returned if this option is selected"),
                  label: z.string().describe("The display label for this option"),
                  hint: z.string().optional().describe("Optional hint text"),
                }),
              )
              .describe("The options to choose from"),
            defaultValue: z.string().optional().describe("Default selected value"),
          }),
          z.object({
            type: z.literal("multi-select"),
            id: z.string().describe("Unique identifier for this question"),
            message: z.string().describe("The question to ask"),
            options: z
              .array(
                z.object({
                  value: z.string().describe("The value returned if this option is selected"),
                  label: z.string().describe("The display label for this option"),
                  hint: z.string().optional().describe("Optional hint text"),
                }),
              )
              .describe("The options to choose from"),
            defaultValue: z.array(z.string()).optional().describe("Default selected values"),
            min: z.number().optional().describe("Minimum selections required"),
            max: z.number().optional().describe("Maximum selections allowed"),
          }),
          z.object({
            type: z.literal("confirm"),
            id: z.string().describe("Unique identifier for this question"),
            message: z.string().describe("The yes/no question to ask"),
            defaultValue: z.boolean().optional().describe("Default value"),
          }),
          z.object({
            type: z.literal("text"),
            id: z.string().describe("Unique identifier for this question"),
            message: z.string().describe("The question to ask"),
            placeholder: z.string().optional().describe("Placeholder text"),
            defaultValue: z.string().optional().describe("Default value"),
            validate: z.string().optional().describe("Regex pattern for validation"),
          }),
        ]),
      )
      .describe("Array of questions to ask the user"),
    title: z.string().optional().describe("Optional title for the question dialog"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 5 minutes)"),
  }),
)

export const AskTool = Tool.define("ask", {
  description:
    "Ask the user a question and wait for their response. Supports select (single choice), multi-select (multiple choices), confirm (yes/no), and text (free-form input) question types. Use this when you need clarification or input from the user to proceed.",
  parameters: AskParameters,
  formatValidationError: formatAskValidationError,
  async execute(params, ctx) {
    const questionID = Identifier.ascending("question")
    const s = await state()

    // Create a promise that will be resolved when the user responds
    const responsePromise = new Promise<Question.Response>((resolve, reject) => {
      s.pending[questionID] = { resolve, reject }
    })

    // Create timeout promise
    const timeout = params.timeout ?? DEFAULT_TIMEOUT
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        const pending = s.pending[questionID]
        if (pending) {
          delete s.pending[questionID]
          reject(new Error(`Question timed out after ${timeout}ms`))
        }
      }, timeout)
    })

    // Publish the question request to the TUI
    await Bus.publish(TuiEvent.QuestionRequest, {
      questionID,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID ?? "",
      questions: params.questions as Question.Item[],
      title: params.title,
      timeout,
    })

    // Wait for response or timeout
    const response = await Promise.race([responsePromise, timeoutPromise])

    // Handle response status
    if (response.status === "cancel") {
      return {
        title: "Question cancelled",
        output: "The user cancelled the question dialog.",
        metadata: { status: "cancel" } as Record<string, unknown>,
      }
    }

    if (response.status === "timeout") {
      return {
        title: "Question timed out",
        output: "The question timed out waiting for user response.",
        metadata: { status: "timeout" } as Record<string, unknown>,
      }
    }

    // Format successful response
    const answers = response.answers ?? []
    const lines: string[] = ["User responses:"]

    for (const answer of answers) {
      const question = params.questions.find((q) => q.id === answer.id)
      const message = question?.message ?? answer.id

      switch (answer.type) {
        case "select":
          lines.push(`- ${message}: ${answer.value}`)
          break
        case "multi-select":
          lines.push(`- ${message}: ${answer.values.join(", ")}`)
          break
        case "confirm":
          lines.push(`- ${message}: ${answer.value ? "Yes" : "No"}`)
          break
        case "text":
          lines.push(`- ${message}: ${answer.value}`)
          break
      }
    }

    if (response.comment) {
      lines.push(`\nAdditional comment: ${response.comment}`)
    }

    return {
      title: "User response received",
      output: lines.join("\n"),
      metadata: {
        status: "ok",
        answers: answers as unknown,
        comment: response.comment ?? "",
      } as Record<string, unknown>,
    }
  },
})
