export * as Authentication from "./authentication"

import { Pairing } from "@opencode-ai/core/pairing"
import { UnauthorizedError } from "@opencode-ai/protocol/errors"
import { hasPtyConnectTicketURL } from "@opencode-ai/protocol/groups/pty"
import { Capabilities } from "@opencode-ai/protocol/capabilities"
import { Principal, type PrincipalInfo } from "@opencode-ai/protocol/middleware/authorization"
import { Context, Effect, Encoding, Layer, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { ServerAuth } from "../auth"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area", Bearer realm="Shuvcode Device"'

export interface Interface {
  readonly withPrincipal: <A, E, R>(
    effect: Effect.Effect<A, E, R | Principal>,
  ) => Effect.Effect<A, E | UnauthorizedError, R | HttpServerRequest.HttpServerRequest>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerAuthentication") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const pairing = yield* Pairing.Service
    return Service.of({
      withPrincipal: (effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(request.url, "http://localhost")
          if (hasPtyConnectTicketURL(url))
            return yield* provide(effect, { type: "unauthenticated", reason: "pty-ticket" })
          if (Capabilities.isPairingRedemption(request.method, url.pathname))
            return yield* provide(effect, { type: "unauthenticated", reason: "pairing-redemption" })
          if (ServerAuth.authorized(yield* credentialFromRequest(request), config))
            return yield* provide(effect, { type: "administrator" })
          const bearer = bearerFromRequest(request)
          const principal = bearer ? yield* pairing.authenticate(bearer) : undefined
          if (principal) return yield* provide(effect, principal)
          if (!ServerAuth.required(config))
            return yield* provide(effect, { type: "unauthenticated", reason: "embedded" })
          yield* challenge
          return yield* new UnauthorizedError({ message: "Authentication required" })
        }),
    })
  }),
)

export const challenge = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
)

function provide<A, E, R>(effect: Effect.Effect<A, E, R | Principal>, principal: PrincipalInfo) {
  return effect.pipe(Effect.provideService(Principal, principal))
}

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
  const token = new URL(request.url, "http://localhost").searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

function bearerFromRequest(request: HttpServerRequest.HttpServerRequest) {
  return /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1]
}
