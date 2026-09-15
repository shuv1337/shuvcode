import type { IntegrationDomain } from "@opencode/plugin/effect/integration"
import type { SessionHttpRequest, SessionHttpResponse } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import { integrationID, isSubscription } from "./oauth.js"
import { decodeBody, headers, restoreStream, shapeRequestBody, toolNames } from "./wire.js"

export function hooks(connection: IntegrationDomain["connection"]) {
  // Core passes the final request object to the response hook. Weak keys need no cleanup on failure/cancellation.
  const matched = new WeakMap<Request, ReadonlyMap<string, string>>()
  return {
    request: (event: SessionHttpRequest) =>
      Effect.gen(function* () {
        const active = yield* connection.active(integrationID)
        const value = active ? yield* connection.resolve(active) : undefined
        if (!isSubscription(value) || !value) return
        const request = event.request
        request.signal.throwIfAborted()
        const body = decodeBody(yield* Effect.tryPromise(() => request.clone().json()))
        const warnings: string[] = []
        const shaped = shapeRequestBody(body, (message) => warnings.push(message))
        for (const warning of warnings) yield* Effect.logWarning(warning)
        const outgoing = new Headers(request.headers)
        Object.entries(headers(Object.fromEntries(outgoing))).forEach(([key, value]) => outgoing.set(key, value))
        outgoing.delete("x-api-key")
        outgoing.delete("content-length")
        outgoing.set("authorization", `Bearer ${value.type === "oauth" ? value.access : value.key}`)
        event.request = new Request(request, { headers: outgoing, body: JSON.stringify(shaped) })
        matched.set(event.request, toolNames(body))
      }).pipe(Effect.orDie),
    response: (event: SessionHttpResponse) =>
      Effect.sync(() => {
        const names = matched.get(event.request)
        matched.delete(event.request)
        if (!names || !event.response.body) return
        if (event.response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "text/event-stream")
          return
        const headers = new Headers(event.response.headers)
        headers.delete("content-length")
        headers.delete("content-encoding")
        event.response = new Response(event.response.body.pipeThrough(restoreStream(names)), {
          status: event.response.status,
          statusText: event.response.statusText,
          headers,
        })
      }),
  }
}
