import { ServerAuth } from "../auth"
import { Capabilities } from "@opencode-ai/protocol/capabilities"
import { ForbiddenError, UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Authorization, Principal } from "@opencode-ai/protocol/middleware/authorization"
export { Authorization, Principal } from "@opencode-ai/protocol/middleware/authorization"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { Authentication } from "./authentication"

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Encoding.decodeBase64String(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
      },
    }),
  )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const token = new URL(request.url, "http://localhost").searchParams.get("auth_token")
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

export function authorizedRequest(request: HttpServerRequest.HttpServerRequest, config: ServerAuth.Info) {
  return credentialFromRequest(request).pipe(Effect.map((credential) => ServerAuth.authorized(credential, config)))
}

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
