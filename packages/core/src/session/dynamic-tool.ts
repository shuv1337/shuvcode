export * as SessionDynamicTool from "./dynamic-tool.js"

import { asc, eq } from "drizzle-orm"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { SessionDynamicTool } from "@opencode-ai/schema/session-dynamic-tool"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { Tool } from "@opencode-ai/schema/tool"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { NotFoundError } from "./error.js"
import { SessionSchema } from "./schema.js"
import { SessionDynamicToolTable, SessionTable } from "./sql.js"

export const Definition = SessionDynamicTool.Definition
export type Definition = typeof Definition.Type

export const Call = SessionDynamicTool.Call
export type Call = typeof Call.Type

export const Reply = SessionDynamicTool.Reply
export type Reply = typeof Reply.Type

export class InvalidToolError extends Schema.TaggedError<InvalidToolError>()("SessionDynamicTool.InvalidToolError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export class CallNotFoundError extends Schema.TaggedError<CallNotFoundError>()("SessionDynamicTool.CallNotFoundError", {
  sessionID: SessionSchema.ID,
  callID: Schema.String,
}) {
  override get message() {
    return `Dynamic tool call not found: ${this.callID}`
  }
}

export interface Interface {
  /** Replace the session's dynamic tool set. An empty array clears it. */
  readonly set: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tools: ReadonlyArray<Definition>
  }) => Effect.Effect<void, NotFoundError | InvalidToolError>
  /** The session's registered dynamic tool definitions, ordered by name. */
  readonly list: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Definition>>
  /** In-flight invocations awaiting the owning client's reply, ordered by request time. */
  readonly calls: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Call>>
  /** Settle one in-flight invocation with the owning client's result. */
  readonly reply: (input: {
    readonly sessionID: SessionSchema.ID
    readonly callID: string
    readonly reply: Reply
  }) => Effect.Effect<void, CallNotFoundError>
  /** Executable session-scoped tools for the runner's tool snapshot. */
  readonly tools: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Tool.Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionDynamicTool") {}

const NamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

interface Pending {
  readonly call: Call
  readonly deferred: Deferred.Deferred<Tool.Result, Tool.Error>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const db = (yield* Database.Service).db
    const pending = new Map<string, Pending>()

    const rows = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      return yield* db
        .select({
          name: SessionDynamicToolTable.name,
          description: SessionDynamicToolTable.description,
          parameters: SessionDynamicToolTable.parameters,
        })
        .from(SessionDynamicToolTable)
        .where(eq(SessionDynamicToolTable.session_id, sessionID))
        .orderBy(asc(SessionDynamicToolTable.name))
        .all()
        .pipe(Effect.orDie)
    })

    const toDefinition = (row: { name: string; description: string; parameters: Record<string, unknown> | null }) =>
      Definition.make({
        name: row.name,
        description: row.description,
        ...(row.parameters === null ? {} : { parameters: row.parameters }),
      })

    const settle = Effect.fnUntraced(function* (callID: string, outcome: "replied" | "cancelled") {
      const entry = pending.get(callID)
      if (!entry) return undefined
      pending.delete(callID)
      yield* bus.publish(
        outcome === "replied" ? SessionEvent.DynamicTool.Replied : SessionEvent.DynamicTool.Cancelled,
        { sessionID: entry.call.sessionID, callID },
      )
      return entry
    })

    const execute =
      (sessionID: SessionSchema.ID, tool: string) =>
      (input: unknown, context: Tool.Context): Effect.Effect<Tool.Result, Tool.Error> =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const deferred = yield* Deferred.make<Tool.Result, Tool.Error>()
            const call = Call.make({
              callID: context.id,
              sessionID,
              tool,
              input,
              time: { requested: Date.now() },
            })
            pending.set(call.callID, { call, deferred })
            yield* bus
              .publish(SessionEvent.DynamicTool.Requested, { sessionID, callID: call.callID, tool, input })
              .pipe(Effect.onError(() => Effect.sync(() => pending.delete(call.callID))))
            return yield* restore(Deferred.await(deferred)).pipe(
              Effect.onInterrupt(() => settle(call.callID, "cancelled").pipe(Effect.ignore)),
            )
          }),
        )

    const service = Service.of({
      set: Effect.fn("SessionDynamicTool.set")(function* (input) {
        const invalid = input.tools.find((tool) => !NamePattern.test(tool.name))
        if (invalid)
          return yield* new InvalidToolError({ name: invalid.name, message: `Invalid tool name: ${invalid.name}` })
        const duplicate = input.tools.find(
          (tool, index) => input.tools.findIndex((candidate) => candidate.name === tool.name) !== index,
        )
        if (duplicate)
          return yield* new InvalidToolError({
            name: duplicate.name,
            message: `Duplicate tool name: ${duplicate.name}`,
          })
        const reserved = input.tools.find((tool) => tool.name === "execute")
        if (reserved)
          return yield* new InvalidToolError({
            name: reserved.name,
            message: 'Tool name "execute" is reserved for CodeMode',
          })
        const session = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!session) return yield* new NotFoundError({ sessionID: input.sessionID })
        const now = Date.now()
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(SessionDynamicToolTable)
                .where(eq(SessionDynamicToolTable.session_id, input.sessionID))
                .run()
              if (input.tools.length === 0) return
              yield* tx
                .insert(SessionDynamicToolTable)
                .values(
                  input.tools.map((tool) => ({
                    session_id: input.sessionID,
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    time_created: now,
                    time_updated: now,
                  })),
                )
                .run()
            }),
          )
          .pipe(Effect.orDie)
        yield* bus.publish(SessionEvent.DynamicTool.Updated, { sessionID: input.sessionID, tools: input.tools })
      }),
      list: Effect.fn("SessionDynamicTool.list")(function* (sessionID) {
        return (yield* rows(sessionID)).map(toDefinition)
      }),
      calls: Effect.fn("SessionDynamicTool.calls")(function* (sessionID) {
        return Array.from(pending.values())
          .filter((entry) => entry.call.sessionID === sessionID)
          .map((entry) => entry.call)
          .sort((left, right) => left.time.requested - right.time.requested)
      }),
      reply: Effect.fn("SessionDynamicTool.reply")(function* (input) {
        const entry = pending.get(input.callID)
        if (!entry || entry.call.sessionID !== input.sessionID)
          return yield* new CallNotFoundError({ sessionID: input.sessionID, callID: input.callID })
        yield* settle(input.callID, "replied")
        if (input.reply.status === "completed")
          return yield* Deferred.succeed(entry.deferred, {
            content: input.reply.content,
          })
        yield* Deferred.fail(entry.deferred, new Tool.Error({ message: input.reply.message }))
      }),
      tools: Effect.fn("SessionDynamicTool.tools")(function* (sessionID) {
        return (yield* rows(sessionID)).map(
          (row): Tool.Info => ({
            name: row.name,
            description: row.description,
            input: (row.parameters ?? { type: "object", properties: {} }) as Tool.ValueSchema,
            execute: execute(sessionID, row.name),
            options: { codemode: false },
          }),
        )
      }),
    })

    // A restart cannot deliver replies for calls dispatched before it; fail
    // them so the runner settles instead of hanging.
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        Array.from(pending.values()),
        (entry) =>
          settle(entry.call.callID, "cancelled").pipe(
            Effect.ignore,
            Effect.andThen(
              Deferred.fail(entry.deferred, new Tool.Error({ message: "Dynamic tool call cancelled: shutting down" })),
            ),
          ),
        { discard: true },
      ),
    )

    return service
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Database.node] })
