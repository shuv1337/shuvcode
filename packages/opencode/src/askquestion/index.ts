import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export namespace AskQuestion {
  /**
   * Schema for a single question option
   */
  export const OptionSchema = z.object({
    value: z.string().describe("Short identifier for the option"),
    label: z.string().describe("Display label for the option"),
    description: z.string().optional().describe("Additional context for the option"),
  })
  export type Option = z.infer<typeof OptionSchema>

  /**
   * Schema for a single question in the wizard
   */
  export const QuestionSchema = z.object({
    id: z.string().describe("Unique identifier for the question"),
    label: z.string().describe("Short tab label, e.g. 'UI Framework'"),
    question: z.string().describe("The full question to ask the user"),
    options: z.array(OptionSchema).min(2).max(8).describe("2-8 suggested answer options"),
    multiSelect: z.boolean().optional().describe("Allow selecting multiple options"),
  })
  export type Question = z.infer<typeof QuestionSchema>

  /**
   * Schema for a single answer from the user
   */
  export const AnswerSchema = z.object({
    questionId: z.string().describe("ID of the question being answered"),
    values: z.array(z.string()).describe("Selected option value(s)"),
    customText: z.string().optional().describe("Custom text if user typed their own response"),
  })
  export type Answer = z.infer<typeof AnswerSchema>

  /**
   * Bus events for askquestion flow
   */
  export const Event = {
    /**
     * Published by the askquestion tool when it needs user input
     */
    Requested: BusEvent.define(
      "askquestion.requested",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        callID: z.string(),
        questions: z.array(QuestionSchema),
      }),
    ),

    /**
     * Published by the TUI when user submits answers
     */
    Answered: BusEvent.define(
      "askquestion.answered",
      z.object({
        sessionID: z.string(),
        callID: z.string(),
        answers: z.array(AnswerSchema),
      }),
    ),

    /**
     * Published when user cancels the question wizard
     */
    Cancelled: BusEvent.define(
      "askquestion.cancelled",
      z.object({
        sessionID: z.string(),
        callID: z.string(),
      }),
    ),
  }

  /**
   * Pending askquestion requests waiting for user response
   */
  interface PendingRequest {
    sessionID: string
    messageID: string
    callID: string
    questions: Question[]
    resolve: (answers: Answer[]) => void
    reject: (error: Error) => void
  }

  // Global map of pending requests by callID
  const pendingRequests = new Map<string, PendingRequest>()

  /**
   * Register a pending askquestion request
   */
  export function register(
    callID: string,
    sessionID: string,
    messageID: string,
    questions: Question[],
  ): Promise<Answer[]> {
    return new Promise((resolve, reject) => {
      pendingRequests.set(callID, {
        sessionID,
        messageID,
        callID,
        questions,
        resolve,
        reject,
      })
    })
  }

  /**
   * Get a pending request
   */
  export function get(callID: string): PendingRequest | undefined {
    return pendingRequests.get(callID)
  }

  /**
   * Get all pending requests for a session
   */
  export function getForSession(sessionID: string): PendingRequest[] {
    return Array.from(pendingRequests.values()).filter((r) => r.sessionID === sessionID)
  }

  /**
   * Respond to a pending askquestion request
   */
  export function respond(callID: string, answers: Answer[]): boolean {
    const pending = pendingRequests.get(callID)
    if (!pending) return false
    pending.resolve(answers)
    pendingRequests.delete(callID)
    return true
  }

  /**
   * Cancel a pending askquestion request
   */
  export function cancel(callID: string): boolean {
    const pending = pendingRequests.get(callID)
    if (!pending) return false
    pending.reject(new Error("User cancelled the question wizard"))
    pendingRequests.delete(callID)
    return true
  }

  /**
   * Clean up pending requests for a session (e.g., on abort)
   */
  export function cleanup(sessionID: string): void {
    for (const [callID, request] of pendingRequests) {
      if (request.sessionID === sessionID) {
        request.reject(new Error("Session aborted"))
        pendingRequests.delete(callID)
      }
    }
  }
}
