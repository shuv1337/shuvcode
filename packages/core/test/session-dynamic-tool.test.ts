import { describe, expect } from "bun:test"
import { DateTime, Effect, Fiber, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Agent } from "@opencode-ai/core/agent"
import { SessionDynamicTool } from "@opencode-ai/core/session/dynamic-tool"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { InstructionEntry } from "@opencode-ai/core/session/instruction-entry"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionDynamicToolTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTransfer } from "@opencode-ai/core/session/transfer"
import { Tool } from "@opencode-ai/schema/tool"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionTransfer.node,
      InstructionEntry.node,
      SessionDynamicTool.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const lookup: SessionDynamicTool.Definition = {
  name: "lookup",
  description: "Look up a record",
  parameters: { type: "object", properties: { id: { type: "string" } } },
}

const report: SessionDynamicTool.Definition = {
  name: "report",
  description: "Report progress",
}

const context = (sessionID: Session.ID, id: string): Tool.Context => ({
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_dynamic"),
  id: Tool.CallID.make(id),
  progress: () => Effect.void,
})

describe("SessionDynamicTool", () => {
  it.effect("registers, lists, and durably persists the session tool set", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tools = yield* SessionDynamicTool.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      yield* tools.set({ sessionID: created.id, tools: [report, lookup] })

      expect(yield* tools.list(created.id)).toEqual([
        { name: "lookup", description: lookup.description, parameters: lookup.parameters },
        { name: "report", description: report.description },
      ])
      const rows = yield* db
        .select({ name: SessionDynamicToolTable.name })
        .from(SessionDynamicToolTable)
        .where(eq(SessionDynamicToolTable.session_id, created.id))
        .all()
      expect(rows).toHaveLength(2)

      yield* tools.set({ sessionID: created.id, tools: [] })
      expect(yield* tools.list(created.id)).toEqual([])
    }),
  )

  it.effect("scopes tools to the registering session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tools = yield* SessionDynamicTool.Service
      const owner = yield* session.create({ location })
      const other = yield* session.create({ location })

      yield* tools.set({ sessionID: owner.id, tools: [lookup] })

      expect((yield* tools.tools(owner.id)).map((tool) => tool.name)).toEqual(["lookup"])
      expect(yield* tools.tools(other.id)).toEqual([])
      expect(yield* tools.list(other.id)).toEqual([])
    }),
  )

  it.effect("rejects unknown sessions and invalid or duplicate names", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tools = yield* SessionDynamicTool.Service
      const missing = Session.ID.create()

      expect(yield* Effect.flip(tools.set({ sessionID: missing, tools: [lookup] }))).toEqual(
        new Session.NotFoundError({ sessionID: missing }),
      )
      const created = yield* session.create({ location })
      expect(
        (yield* Effect.flip(tools.set({ sessionID: created.id, tools: [{ ...lookup, name: "bad name" }] })))._tag,
      ).toBe("SessionDynamicTool.InvalidToolError")
      expect((yield* Effect.flip(tools.set({ sessionID: created.id, tools: [lookup, lookup] })))._tag).toBe(
        "SessionDynamicTool.InvalidToolError",
      )
      expect(
        (yield* Effect.flip(tools.set({ sessionID: created.id, tools: [{ ...lookup, name: "execute" }] })))._tag,
      ).toBe("SessionDynamicTool.InvalidToolError")
      expect(
        (yield* Effect.flip(
          tools.set({
            sessionID: created.id,
            tools: [{ ...lookup, parameters: { type: "object", fn: () => 1 } as never }],
          }),
        ))._tag,
      ).toBe("SessionDynamicTool.InvalidToolError")
    }),
  )

  it.effect("rolls back session creation when initial dynamic tools fail to insert", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      expect(
        (yield* Effect.flip(
          session.create({
            location,
            tools: [{ name: "execute", description: "reserved" }],
          }),
        ))._tag,
      ).toBe("SessionDynamicTool.InvalidToolError")
      expect((yield* session.list({ directory: location.directory })).data).toEqual([])
    }),
  )

  it.effect("dispatches invocations to the owning client and returns the reply to the caller", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tools = yield* SessionDynamicTool.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      yield* tools.set({ sessionID: created.id, tools: [lookup] })

      const requested = yield* bus
        .subscribe(SessionEvent.DynamicTool.Requested)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const tool = (yield* tools.tools(created.id))[0]
      const running = yield* tool.execute({ id: "rec_1" }, context(created.id, "call_1")).pipe(Effect.forkScoped)

      const [event] = Array.from(yield* Fiber.join(requested))
      expect(event.data).toMatchObject({ sessionID: created.id, callID: "call_1", tool: "lookup" })
      expect(yield* tools.calls(created.id)).toMatchObject([{ callID: "call_1", tool: "lookup" }])

      yield* tools.reply({
        sessionID: created.id,
        callID: "call_1",
        reply: { status: "completed", content: "found it" },
      })

      expect(yield* Fiber.join(running)).toEqual({ content: "found it" })
      expect(yield* tools.calls(created.id)).toEqual([])
    }),
  )

  it.effect("surfaces a failed reply as a tool error", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tools = yield* SessionDynamicTool.Service
      const created = yield* session.create({ location })
      yield* tools.set({ sessionID: created.id, tools: [lookup] })

      const bus = yield* Bus.Service
      const requested = yield* bus
        .subscribe(SessionEvent.DynamicTool.Requested)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const tool = (yield* tools.tools(created.id))[0]
      const running = yield* tool.execute({}, context(created.id, "call_2")).pipe(Effect.flip, Effect.forkScoped)
      yield* Fiber.join(requested)
      yield* tools.reply({ sessionID: created.id, callID: "call_2", reply: { status: "failed", message: "nope" } })

      const error = yield* Fiber.join(running)
      expect(error).toBeInstanceOf(Tool.Error)
      expect(error.message).toBe("nope")
      expect(
        (yield* Effect.flip(
          tools.reply({ sessionID: created.id, callID: "call_2", reply: { status: "failed", message: "again" } }),
        ))._tag,
      ).toBe("SessionDynamicTool.CallNotFoundError")
    }),
  )

  it.effect("forks inherit the parent's dynamic tools until replaced", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const tools = yield* SessionDynamicTool.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      yield* tools.set({ sessionID: parent.id, tools: [lookup, report] })
      const messageID = SessionMessage.ID.create()
      const {
        id: _id,
        type,
        ...data
      } = Schema.encodeSync(SessionMessage.Info)(
        SessionMessage.User.make({
          id: messageID,
          type: "user",
          text: "First",
          time: { created: DateTime.makeUnsafe(0) },
        }),
      )
      yield* db
        .insert(SessionMessageTable)
        .values({ id: messageID, session_id: parent.id, type, seq: 0, time_created: 0, data })
        .run()
        .pipe(Effect.orDie)

      const forked = yield* session.fork({ sessionID: parent.id, boundary: { type: "through" } })

      expect((yield* tools.list(forked.id)).map((tool) => tool.name)).toEqual(["lookup", "report"])

      yield* tools.set({ sessionID: forked.id, tools: [report] })
      expect((yield* tools.list(forked.id)).map((tool) => tool.name)).toEqual(["report"])
      expect((yield* tools.list(parent.id)).map((tool) => tool.name)).toEqual(["lookup", "report"])
    }),
  )
})
