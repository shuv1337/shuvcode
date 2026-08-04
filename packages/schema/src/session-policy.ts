export * as SessionPolicy from "./session-policy.js"

import { Schema } from "effect"

export const ToolID = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)).annotate({
  identifier: "Session.Policy.ToolID",
  description: "Exact effective tool identifier. Wildcards are not supported.",
})
export type ToolID = typeof ToolID.Type

export const Tools = Schema.Struct({
  allow: Schema.Array(ToolID),
}).annotate({
  identifier: "Session.Policy.Tools",
  description: "Deny-by-default tool policy. Only exact identifiers in allow may execute.",
})
export interface Tools extends Schema.Schema.Type<typeof Tools> {}

export const Info = Schema.Struct({
  tools: Tools,
}).annotate({ identifier: "Session.Policy" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
