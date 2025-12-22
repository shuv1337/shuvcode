import { Tool } from "./tool"
import DESCRIPTION from "./askquestion.txt"
import z from "zod"
import { AskQuestion } from "../askquestion"
import { defer } from "@/util/defer"

export const AskQuestionTool = Tool.define(
  "askquestion",
  {
    description: DESCRIPTION,
    parameters: z.object({
      questions: z
        .array(AskQuestion.QuestionSchema)
        .min(1)
        .max(6)
        .describe("1-6 questions to ask in wizard flow"),
    }),

    async execute(params, ctx) {
      // Update the tool metadata to show what we're waiting for
      // IMPORTANT: Must await to ensure Part is synced before we block waiting for response
      await ctx.metadata({
        title: `Asking ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
        metadata: {
          questions: params.questions,
          status: "waiting",
        },
      })

      // Register the pending request and wait for response
      const answerPromise = AskQuestion.register(
        ctx.callID!,
        ctx.sessionID,
        ctx.messageID,
        params.questions,
      )

      // Handle abort signal
      const abortHandler = () => {
        AskQuestion.cancel(ctx.callID!)
      }
      ctx.abort.addEventListener("abort", abortHandler)
      using _ = defer(() => ctx.abort.removeEventListener("abort", abortHandler))

      // Wait for user response
      const answers = await answerPromise

      // Format the answers for the LLM
      const formattedAnswers = answers
        .map((answer) => {
          const question = params.questions.find((q) => q.id === answer.questionId)
          const questionLabel = question?.label ?? answer.questionId

          if (answer.customText) {
            return `**${questionLabel}**: ${answer.customText} (custom response)`
          }

          const selectedLabels = answer.values
            .map((v) => {
              const option = question?.options.find((o) => o.value === v)
              return option?.label ?? v
            })
            .join(", ")

          return `**${questionLabel}**: ${selectedLabels}`
        })
        .join("\n")

      return {
        title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
        metadata: {
          questions: params.questions.map((q) => q.label),
          answers: answers,
          status: "completed",
        },
        output: `User responses:\n\n${formattedAnswers}`,
      }
    },
  },
)
