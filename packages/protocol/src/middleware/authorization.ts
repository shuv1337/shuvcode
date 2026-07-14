import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { Context } from "effect"
import { Pairing } from "@opencode-ai/schema/pairing"
import { ForbiddenError, UnauthorizedError } from "../errors.js"

export type PrincipalInfo =
  | { readonly type: "administrator" }
  | { readonly type: "device"; readonly deviceID: Pairing.DeviceID }
  | { readonly type: "unauthenticated"; readonly reason: "embedded" | "pairing-redemption" | "pty-ticket" }

export class Principal extends Context.Service<Principal, PrincipalInfo>()("@opencode/HttpPrincipal") {}

export class Authorization extends HttpApiMiddleware.Service<Authorization, { provides: Principal }>()(
  "@opencode/HttpApiAuthorization",
  { error: [UnauthorizedError, ForbiddenError] },
) {}
