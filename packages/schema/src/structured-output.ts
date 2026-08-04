export * as StructuredOutput from "./structured-output.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const JsonSchema = Schema.Record(Schema.String, Schema.Json).annotate({
  identifier: "StructuredOutput.JsonSchema",
})
export type JsonSchema = typeof JsonSchema.Type

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  schema: JsonSchema,
  name: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "StructuredOutput.Request" })

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  value: Schema.Json,
}).annotate({ identifier: "StructuredOutput.Result" })
