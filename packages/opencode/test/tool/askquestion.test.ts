import { describe, expect, test } from "bun:test"
import { AskQuestion } from "../../src/askquestion"

describe("AskQuestion Core", () => {
  test("register and respond", async () => {
    const callID = "test-call-id"
    const sessionID = "test-session-id"
    const messageID = "test-message-id"
    const questions: AskQuestion.Question[] = [
      {
        id: "q1",
        label: "Q1",
        question: "How are you?",
        options: [
          { value: "good", label: "Good" },
          { value: "bad", label: "Bad" },
        ],
      },
    ]

    const promise = AskQuestion.register(callID, sessionID, messageID, questions)
    
    const pending = AskQuestion.get(callID)
    expect(pending).toBeDefined()
    expect(pending?.questions).toEqual(questions)

    const answers: AskQuestion.Answer[] = [
      { questionId: "q1", values: ["good"] },
    ]

    AskQuestion.respond(callID, answers)
    
    const result = await promise
    expect(result).toEqual(answers)
    expect(AskQuestion.get(callID)).toBeUndefined()
  })

  test("register and cancel", async () => {
    const callID = "test-call-id-2"
    const sessionID = "test-session-id"
    const messageID = "test-message-id"
    const questions: AskQuestion.Question[] = [
      {
        id: "q1",
        label: "Q1",
        question: "How are you?",
        options: [
          { value: "good", label: "Good" },
          { value: "bad", label: "Bad" },
        ],
      },
    ]

    const promise = AskQuestion.register(callID, sessionID, messageID, questions)
    
    AskQuestion.cancel(callID)
    
    expect(promise).rejects.toThrow("User cancelled the question wizard")
    expect(AskQuestion.get(callID)).toBeUndefined()
  })
})

describe("AskQuestion Detection Logic", () => {
  // Mock detection logic similar to TUI/Web implementation
  function detectPending(messages: any[], partsMap: Record<string, any[]>) {
    for (const message of [...messages].reverse()) {
      const parts = partsMap[message.id] ?? []
      for (const part of [...parts].reverse()) {
        if (part.type !== "tool") continue
        if (part.tool !== "askquestion") continue
        if (part.state.status !== "running") continue
        
        const metadata = part.state.metadata
        if (metadata?.status !== "waiting") continue

        return {
          callID: part.callID,
          messageId: message.id,
          questions: metadata.questions ?? [],
        }
      }
    }
    return null
  }

  test("detects pending askquestion", () => {
    const messages = [{ id: "m1" }, { id: "m2" }]
    const partsMap = {
      m1: [],
      m2: [
        {
          type: "tool",
          tool: "askquestion",
          callID: "c1",
          state: {
            status: "running",
            metadata: {
              status: "waiting",
              questions: [{ id: "q1", label: "Q1" }],
            },
          },
        },
      ],
    }

    const result = detectPending(messages, partsMap)
    expect(result).not.toBeNull()
    expect(result?.callID).toBe("c1")
    expect(result?.questions[0].id).toBe("q1")
  })

  test("ignores completed askquestion", () => {
    const messages = [{ id: "m1" }]
    const partsMap = {
      m1: [
        {
          type: "tool",
          tool: "askquestion",
          callID: "c1",
          state: {
            status: "completed",
            metadata: {
              status: "completed",
            },
          },
        },
      ],
    }

    const result = detectPending(messages, partsMap)
    expect(result).toBeNull()
  })

  test("ignores askquestion in different state", () => {
    const messages = [{ id: "m1" }]
    const partsMap = {
      m1: [
        {
          type: "tool",
          tool: "askquestion",
          callID: "c1",
          state: {
            status: "running",
            metadata: {
              status: "something-else",
            },
          },
        },
      ],
    }

    const result = detectPending(messages, partsMap)
    expect(result).toBeNull()
  })
})
