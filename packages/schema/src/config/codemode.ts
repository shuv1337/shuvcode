export * as ConfigCodeMode from "./codemode.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.CodeMode")({
  timeout_ms: PositiveInt.pipe(Schema.optional).annotate({
    description: "Wall-clock milliseconds one Code Mode program may run before it is interrupted. Defaults to 120000.",
  }),
  max_tool_calls: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Maximum tool calls one Code Mode program may admit, including search. Defaults to 100.",
  }),
  max_output_bytes: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Maximum UTF-8 bytes retained from a Code Mode program's result and logs. Defaults to 1048576.",
  }),
}) {}
