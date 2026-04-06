import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { ProviderID, ModelID } from "@/provider/schema"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { ulid } from "ulid"
import os from "os"
import path from "path"
import fs from "fs/promises"

describe("Session Status Downgrade Guard", () => {
  let sessionID: SessionID
  let messageID: MessageID
  let partID: PartID
  let testDir: string

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), "opencode-test-" + ulid())
    await fs.mkdir(testDir, { recursive: true })
    
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const session = await Session.createNext({
          directory: testDir,
          title: "Test Session",
        })
        sessionID = session.id
        messageID = MessageID.ascending()
        partID = PartID.ascending()

        await Session.updateMessage({
          id: messageID,
          role: "assistant",
          sessionID: sessionID,
          parentID: MessageID.ascending(),
          agent: "build",
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.openai,
          mode: "build",
          path: { cwd: testDir, root: testDir },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        })
      }
    })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("should allow updating a running part", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const part: MessageV2.ToolPart = {
          id: partID,
          messageID: messageID,
          sessionID: sessionID,
          type: "tool",
          tool: "bash",
          callID: ulid(),
          state: {
            status: "running",
            input: { command: "ls" },
            time: { start: Date.now() },
          },
        }

        await Session.updatePart(part)
        
        const updatedPart: MessageV2.ToolPart = {
          ...part,
          state: {
            ...part.state,
            status: "running",
            metadata: { some: "metadata" },
          } as MessageV2.ToolStateRunning,
        }

        const result = await Session.updatePart(updatedPart)
        if (result.type === "tool") {
          expect(result.state.status).toBe("running")
          if (result.state.status === "running") {
            expect(result.state.metadata).toEqual({ some: "metadata" })
          }
        } else {
          throw new Error("Result should be a tool part")
        }
      }
    })
  })

  it("should prevent downgrading completed to running", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const part: MessageV2.ToolPart = {
          id: partID,
          messageID: messageID,
          sessionID: sessionID,
          type: "tool",
          tool: "bash",
          callID: ulid(),
          state: {
            status: "completed",
            input: { command: "ls" },
            output: "file1",
            title: "ls",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        }

        await Session.updatePart(part)

        const downgradedPart: MessageV2.ToolPart = {
          ...part,
          state: {
            status: "running",
            input: { command: "ls" },
            time: { start: Date.now() },
          } as MessageV2.ToolStateRunning,
        }

        const result = await Session.updatePart(downgradedPart)
        if (result.type === "tool") {
          expect(result.state.status).toBe("completed")
        } else {
          throw new Error("Result should be a tool part")
        }
      }
    })
  })
})
