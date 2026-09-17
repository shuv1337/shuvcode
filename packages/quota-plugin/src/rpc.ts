export * as QuotaRpc from "./rpc.js"

import { Rpc } from "@opencode/schema/rpc"
import { Schema } from "effect"

/** One rate-limit window. `remaining` is percent left (0-100); `resetsAt` is epoch milliseconds. */
export const Window = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  remaining: Schema.Number,
  resetsAt: Schema.optional(Schema.Number),
}).annotate({ identifier: "Quota.Window" })
export type Window = typeof Window.Type

export const Provider = Schema.Struct({
  /** Stable quota source id: codex | claude | xai | google. */
  id: Schema.String,
  name: Schema.String,
  integrationID: Schema.String,
  status: Schema.Literals(["ok", "error"]),
  plan: Schema.optional(Schema.String),
  account: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  windows: Schema.Array(Window),
  /** Epoch milliseconds when this snapshot was fetched. */
  fetched: Schema.Number,
}).annotate({ identifier: "Quota.Provider" })
export type Provider = typeof Provider.Type

export const ListInput = Schema.Struct({
  /** Bypass the server cache and refetch every provider. */
  refresh: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "Quota.ListInput" })
export type ListInput = typeof ListInput.Type

export const ListOutput = Schema.Struct({
  providers: Schema.Array(Provider),
}).annotate({ identifier: "Quota.ListOutput" })
export type ListOutput = typeof ListOutput.Type

export const ID = "shuvcode.quota"

// Effect schemas double as Standard Schemas so one definition serves the server
// (`Rpc.Definition`) and the promise client used by the TUI (`Rpc.PortableDefinition`).
export const Definition = Rpc.define({
  id: ID,
  methods: {
    list: {
      input: Schema.toStandardSchemaV1(ListInput),
      output: Schema.toStandardSchemaV1(ListOutput),
    },
  },
  events: {},
})
