export * as Auth from "./auth.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"
import { optional } from "./schema.js"

export const Reason = Schema.Literals(["configured", "expired", "empty", "malformed"])
export type Reason = typeof Reason.Type

export const Profile = Schema.Struct({
  providerID: Integration.ID,
  profileID: optional(Credential.ID),
  source: Schema.Literals(["stored", "environment"]),
  type: Schema.Literals(["key", "oauth", "unknown"]),
  usable: Schema.Boolean,
  reason: Reason,
}).annotate({ identifier: "Auth.Profile" })
export type Profile = typeof Profile.Type

export const Status = Schema.Struct({
  ready: Schema.Boolean,
  storage: Schema.Literals(["available", "unavailable"]),
  verification: Schema.Literal("not_performed"),
  profiles: Schema.Array(Profile),
}).annotate({ identifier: "Auth.Status" })
export type Status = typeof Status.Type
