import { ForbiddenError, UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Capabilities } from "@opencode-ai/protocol/capabilities"
import { Authorization, Principal } from "@opencode-ai/protocol/middleware/authorization"
export { Authorization, Principal } from "@opencode-ai/protocol/middleware/authorization"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { Authentication } from "./authentication"

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const authentication = yield* Authentication.make
    return Authorization.of((effect) =>
      authentication.withPrincipal(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const principal = yield* Principal
          const url = new URL(request.url, "http://localhost")
          if (principal.type === "administrator") return yield* effect
          if (principal.type === "device") {
            if (!Capabilities.allowsMobile(request.method, url.pathname))
              return yield* new ForbiddenError({ message: "Administrator access required" })
            return yield* effect
          }
          if (principal.reason !== "embedded") return yield* effect
          if (!Capabilities.requiresAdministrator(request.method, url.pathname)) return yield* effect
          yield* Authentication.challenge
          return yield* new UnauthorizedError({ message: "Authentication required" })
        }),
      ),
    )
  }),
)
