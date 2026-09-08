export * as Permission from "./permission.js"

import { Schema } from "effect"
import { NonNegativeInt, optional, statics } from "./schema.js"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { SessionID } from "./session-id.js"

export const ID = Schema.String.check(Schema.isStartsWith("per")).pipe(
  Schema.brand("Permission.ID"),
  statics((schema) => ({ create: (id?: string) => schema.make(id ?? "per_" + ascending()) })),
)
export type ID = typeof ID.Type

export const ResponseID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
  identifier: "Permission.ResponseID",
})
export type ResponseID = typeof ResponseID.Type

export const Source = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tool"),
    messageID: Schema.String,
    id: Schema.String,
  }),
]).annotate({ identifier: "Permission.Source" })
export type Source = typeof Source.Type

const RequestFields = {
  sessionID: SessionID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  save: Schema.Array(Schema.String).pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  source: Source.pipe(optional),
  message: Schema.String.pipe(optional),
}

export const Request = Schema.Struct({
  id: ID,
  ...RequestFields,
}).annotate({ identifier: "Permission.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Reply = Schema.Literals(["once", "always", "reject"]).annotate({ identifier: "Permission.Reply" })
export type Reply = typeof Reply.Type

export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("answered"), reply: Reply, message: Schema.String.pipe(optional) }),
  Schema.Struct({ status: Schema.Literal("cancelled") }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Permission.State" })
export type State = typeof State.Type

export const Receipt = Schema.Struct({
  request: Request,
  state: State,
  available: Schema.Boolean,
  responseID: ResponseID.pipe(optional),
  time: Schema.Struct({
    created: NonNegativeInt,
    updated: NonNegativeInt,
  }),
}).annotate({ identifier: "Permission.Receipt" })
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}

const Asked = ephemeral({ type: "permission.asked", schema: Request.fields })
const Replied = ephemeral({
  type: "permission.replied",
  schema: {
    sessionID: SessionID,
    requestID: ID,
    reply: Reply,
  },
})
export const Event = { Asked, Replied, Definitions: inventory(Asked, Replied) }

export const Effect = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "Permission.Effect" })
export type Effect = typeof Effect.Type

export interface Rule extends Schema.Schema.Type<typeof Rule> {}
export const Rule = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
  effect: Effect,
}).annotate({ identifier: "Permission.Rule" })

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "Permission.Ruleset" })
export type Ruleset = typeof Ruleset.Type
