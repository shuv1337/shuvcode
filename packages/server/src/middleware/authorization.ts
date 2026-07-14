import { ServerAuth } from "../auth"
import { Pairing } from "@opencode-ai/core/pairing"
import { ForbiddenError, UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Authorization, Principal } from "@opencode-ai/protocol/middleware/authorization"
export { Authorization, Principal } from "@opencode-ai/protocol/middleware/authorization"
import { hasPtyConnectTicketURL } from "@opencode-ai/protocol/groups/pty"
import { Capabilities } from "@opencode-ai/protocol/capabilities"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area", Bearer realm="Shuvcode Device"'

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
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

function bearerFromRequest(request: HttpServerRequest.HttpServerRequest) {
  return /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1]
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const pairing = yield* Pairing.Service
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        // Browsers cannot set headers on WebSocket upgrades, so a ticketed PTY connect skips
        // credential checks here; the connect handler consumes and validates the ticket.
        if (hasPtyConnectTicketURL(url))
          return yield* effect.pipe(Effect.provideService(Principal, { type: "unauthenticated", reason: "pty-ticket" }))
        if (Capabilities.isPairingRedemption(request.method, url.pathname))
          return yield* effect.pipe(
            Effect.provideService(Principal, { type: "unauthenticated", reason: "pairing-redemption" }),
          )
        const credential = yield* credentialFromRequest(request)
        if (ServerAuth.authorized(credential, config))
          return yield* effect.pipe(Effect.provideService(Principal, { type: "administrator" }))
        const bearer = bearerFromRequest(request)
        const principal = bearer ? yield* pairing.authenticate(bearer) : undefined
        if (principal?.type === "device") {
          if (
            Capabilities.requiresAdministrator(url.pathname) ||
            !Capabilities.allowsMobile(request.method, url.pathname)
          )
            return yield* new ForbiddenError({ message: "Administrator access required" })
          return yield* effect.pipe(Effect.provideService(Principal, principal))
        }
        if (!ServerAuth.required(config) && !Capabilities.requiresAdministrator(url.pathname))
          return yield* effect.pipe(Effect.provideService(Principal, { type: "unauthenticated", reason: "embedded" }))
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
        )
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }),
    )
  }),
)
