export * as SessionDynamicTool from "./session-dynamic-tool.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { SessionID } from "./session-id.js"

/**
 * A client-registered tool scoped to one session. The model sees it like any
 * other tool; invocations dispatch to the registering client, which returns
 * the result over the reply endpoint.
 */
export interface Definition extends Schema.Schema.Type<typeof Definition> {}
export const Definition = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** JSON Schema describing the tool input. Defaults to an empty object schema. */
  parameters: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "SessionDynamicTool.Definition" })

/** An in-flight dynamic tool invocation awaiting the owning client's reply. */
export interface Call extends Schema.Schema.Type<typeof Call> {}
export const Call = Schema.Struct({
  callID: Schema.String,
  sessionID: SessionID,
  tool: Schema.String,
  input: Schema.Json,
  time: Schema.Struct({ requested: Schema.Finite }),
}).annotate({ identifier: "SessionDynamicTool.Call" })

export const Reply = Schema.Union([
  Schema.Struct({ status: Schema.Literal("completed"), content: Schema.String }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
]).annotate({ identifier: "SessionDynamicTool.Reply" })
export type Reply = typeof Reply.Type
