import { Database } from "@opencode-ai/core/database/database"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Observability } from "@opencode-ai/core/observability"
import { Schema } from "effect"

export const ServerOptions = Schema.Struct({
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535)),
  ),
  password: Schema.optional(Schema.String),
  database: Schema.optional(Database.Options),
  models: Schema.optional(ModelsDev.Options),
  observability: Schema.optional(Observability.Options),
  config: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      project: Schema.optional(Schema.Boolean),
    }),
  ),
  fs: Schema.optional(
    Schema.Struct({
      filewatcher: Schema.optional(Schema.Boolean),
      fff: Schema.optional(Schema.Boolean),
    }),
  ),
})
export type ServerOptions = typeof ServerOptions.Type
