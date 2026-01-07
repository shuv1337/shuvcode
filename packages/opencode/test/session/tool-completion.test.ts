import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { LLM } from "@/session/llm"
import { SessionProcessor } from "@/session/processor"
import { Agent } from "@/agent/agent"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import os from "os"
import path from "path"
import fs from "fs/promises"

Log.init({ print: true })

describe("Session Tool Completion", () => {
  let sessionID: string
  let messageID: string
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
        messageID = Identifier.ascending("message")

        await Session.updateMessage({
          id: messageID,
          role: "assistant",
          sessionID: sessionID,
          parentID: Identifier.ascending("message"),
          agent: "build",
          modelID: "gpt-4",
          providerID: "openai",
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

  it("should transition tool part status to completed on tool-result", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const userID = Identifier.ascending("message")
        const user: MessageV2.User = {
          id: userID,
          role: "user",
          sessionID,
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        }
        await Session.updateMessage(user)

        const assistantMessage: MessageV2.Assistant = {
          id: messageID,
          role: "assistant",
          sessionID: sessionID,
          parentID: userID,
          agent: "build",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "build",
          path: { cwd: testDir, root: testDir },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistantMessage)

        const toolCallId = "call_" + ulid()
        const agent = await Agent.get("build")
        
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID,
          model: { id: "gpt-4", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        // Mock LLM stream that emits tool-input-start, tool-call, and tool-result
        const streamInput: LLM.StreamInput = {
          user,
          agent,
          system: [],
          tools: {},
          messages: [],
          model: { id: "gpt-4", providerID: "openai" } as any,
          abort: new AbortController().signal,
          sessionID,
        }

        const events: any[] = [
          { type: "start" },
          { type: "tool-input-start", id: toolCallId, toolName: "bash" },
          { type: "tool-call", toolCallId, toolName: "bash", input: { command: "ls" } },
          { 
            type: "tool-result", 
            toolCallId, 
            input: { command: "ls" }, 
            output: { output: "file1", title: "ls", metadata: {} } 
          },
          { type: "finish-step", usage: { input: 0, output: 0 }, finishReason: "stop" },
          { type: "finish" }
        ]

        // We need to mock LLM.stream to return our events
        const originalStream = LLM.stream
        LLM.stream = async () => ({
          fullStream: (async function* () {
            for (const event of events) {
              yield event
            }
          })()
        } as any)

        try {
          await processor.process(streamInput)
          
          const parts = await MessageV2.parts(messageID)
          console.log("Parts in storage:", JSON.stringify(parts, null, 2))
          const toolPart = parts.find(p => p.type === "tool") as MessageV2.ToolPart
          
          expect(toolPart).toBeDefined()
          if (toolPart.state.status === "error") {
            console.log("Tool Part Error:", toolPart.state.error)
          }
          expect(toolPart.state.status).toBe("completed")
          if (toolPart.state.status === "completed") {
            expect(toolPart.state.output).toBe("file1")
          }
        } finally {
          LLM.stream = originalStream
        }
      }
    })
  })

  it("should transition tool part status to error on tool-error", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const userID = Identifier.ascending("message")
        const user: MessageV2.User = {
          id: userID,
          role: "user",
          sessionID,
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        }
        await Session.updateMessage(user)

        const assistantMessage: MessageV2.Assistant = {
          id: messageID,
          role: "assistant",
          sessionID: sessionID,
          parentID: userID,
          agent: "build",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "build",
          path: { cwd: testDir, root: testDir },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistantMessage)

        const toolCallId = "call_" + ulid()
        const agent = await Agent.get("build")
        
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID,
          model: { id: "gpt-4", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const streamInput: LLM.StreamInput = {
          user,
          agent,
          system: [],
          tools: {},
          messages: [],
          model: { id: "gpt-4", providerID: "openai" } as any,
          abort: new AbortController().signal,
          sessionID,
        }

        const events: any[] = [
          { type: "start" },
          { type: "tool-input-start", id: toolCallId, toolName: "bash" },
          { type: "tool-call", toolCallId, toolName: "bash", input: { command: "false" } },
          { 
            type: "tool-error", 
            toolCallId, 
            input: { command: "false" }, 
            error: "Exit code 1"
          },
          { type: "finish-step", usage: { input: 0, output: 0 }, finishReason: "stop" },
          { type: "finish" }
        ]

        const originalStream = LLM.stream
        LLM.stream = async () => ({
          fullStream: (async function* () {
            for (const event of events) {
              yield event
            }
          })()
        } as any)

        try {
          await processor.process(streamInput)
          
          const parts = await MessageV2.parts(messageID)
          const toolPart = parts.find(p => p.type === "tool") as MessageV2.ToolPart
          
          expect(toolPart).toBeDefined()
          expect(toolPart.state.status).toBe("error")
          if (toolPart.state.status === "error") {
            expect(toolPart.state.error).toBe("Exit code 1")
          }
        } finally {
          LLM.stream = originalStream
        }
      }
    })
  })

  it("should transition tool part status to completed for write tool", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const userID = Identifier.ascending("message")
        const user: MessageV2.User = {
          id: userID,
          role: "user",
          sessionID,
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        }
        await Session.updateMessage(user)

        const assistantMessage: MessageV2.Assistant = {
          id: messageID,
          role: "assistant",
          sessionID: sessionID,
          parentID: userID,
          agent: "build",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "build",
          path: { cwd: testDir, root: testDir },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistantMessage)

        const toolCallId = "call_" + ulid()
        const agent = await Agent.get("build")
        
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID,
          model: { id: "gpt-4", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const streamInput: LLM.StreamInput = {
          user,
          agent,
          system: [],
          tools: {},
          messages: [],
          model: { id: "gpt-4", providerID: "openai" } as any,
          abort: new AbortController().signal,
          sessionID,
        }

        const events: any[] = [
          { type: "start" },
          { type: "tool-input-start", id: toolCallId, toolName: "write" },
          { type: "tool-call", toolCallId, toolName: "write", input: { filePath: "test.txt", content: "hello" } },
          { 
            type: "tool-result", 
            toolCallId, 
            input: { filePath: "test.txt", content: "hello" }, 
            output: { output: "File written", title: "write test.txt", metadata: {} } 
          },
          { type: "finish-step", usage: { input: 0, output: 0 }, finishReason: "stop" },
          { type: "finish" }
        ]

        const originalStream = LLM.stream
        LLM.stream = async () => ({
          fullStream: (async function* () {
            for (const event of events) {
              yield event
            }
          })()
        } as any)

        try {
          await processor.process(streamInput)
          
          const parts = await MessageV2.parts(messageID)
          const toolPart = parts.find(p => p.type === "tool" && p.tool === "write") as MessageV2.ToolPart
          
          expect(toolPart).toBeDefined()
          expect(toolPart.state.status).toBe("completed")
          if (toolPart.state.status === "completed") {
            expect(toolPart.state.output).toBe("File written")
          }
        } finally {
          LLM.stream = originalStream
        }
      }
    })
  })
})
