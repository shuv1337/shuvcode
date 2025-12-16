import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Permission } from "../permission"

const DEFAULT_TIMEOUT = 5 * 60 * 1000 // 5 minutes

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

export const AskTool = Tool.define("ask", {
  description:
    "Ask the user a question and wait for their response. Supports select (single choice), multi-select (multiple choices), confirm (yes/no), and text (free-form input) question types. Use this when you need clarification or input from the user to proceed.",
  parameters: z.object({
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
