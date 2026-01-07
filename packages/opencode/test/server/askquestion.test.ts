import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { AskQuestion } from "../../src/askquestion"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("AskQuestion server endpoints", () => {
  test("POST /askquestion/respond should resolve pending request", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const callID = "call_123"
        
        // Register a pending request
        const answerPromise = AskQuestion.register(callID, session.id, "msg_123", [])
        
        const app = Server.App()
        const response = await app.request("/askquestion/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionID: session.id,
            callID,
            answers: []
          }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        
        const answers = await answerPromise
        expect(answers).toEqual([])

        await Session.remove(session.id)
      },
    })
  })

  test("POST /askquestion/cancel should reject pending request", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const callID = "call_456"
        
        const answerPromise = AskQuestion.register(callID, session.id, "msg_456", [])
        
        const app = Server.App()
        const response = await app.request("/askquestion/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionID: session.id,
            callID
          }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        
        try {
          await answerPromise
          expect(false).toBe(true) // Should not reach here
        } catch (e: any) {
          expect(e.message).toBe("User cancelled the question wizard")
        }

        await Session.remove(session.id)
      },
    })
  })

  test("POST /askquestion/respond should return 500 for unknown callID", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        
        const app = Server.App()
        const response = await app.request("/askquestion/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionID: session.id,
            callID: "unknown_call",
            answers: []
          }),
        })

        expect(response.status).toBe(500)
        const body = await response.json()
        expect(body.data.message).toContain("No pending askquestion found with this ID")

        await Session.remove(session.id)
      },
    })
  })

  test("AskQuestion.cleanup should reject all pending requests for session", async () => {
     const sessionID = "ses_cleanup"
     const callID = "call_cleanup"
     const promise = AskQuestion.register(callID, sessionID, "msg_cleanup", [])
     
     AskQuestion.cleanup(sessionID)
     
     try {
       await promise
       expect(false).toBe(true)
     } catch (e: any) {
       expect(e.message).toBe("Session aborted")
     }
  })
})
