import { expect, test } from "bun:test"
import type { SessionHttpRequest, SessionHttpResponse } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/schema/agent"
import { Credential } from "@opencode/schema/credential"
import { Model } from "@opencode/schema/model"
import { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { hooks } from "../src/hooks.js"
import { methodID } from "../src/oauth.js"

const scope = {
  sessionID: Session.ID.make("ses_fixture"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.parse("anthropic/claude-sonnet-4"),
  kind: "primary" as const,
}
function request(signal?: AbortSignal): SessionHttpRequest {
  return {
    ...scope,
    request: new Request("https://fixture.invalid/custom/v1/messages?keep=yes", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": "stale",
        "anthropic-beta": "custom",
        "x-custom": "kept",
        "content-type": "application/json",
      },
      body: JSON.stringify({ tools: [{ name: "bAsH" }], system: "Keep my instructions" }),
    }),
  }
}
function response(req: Request): SessionHttpResponse {
  return {
    ...scope,
    request: req,
    response: new Response(
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"Bash"}}\r\n\r\n',
      {
        status: 202,
        statusText: "Accepted",
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-request-id": "fixture",
          "content-length": "999",
          "content-encoding": "gzip",
        },
      },
    ),
  }
}
const oauth = Credential.OAuth.make({
  type: "oauth",
  methodID,
  access: "fresh",
  refresh: "native",
  expires: 9999999999999,
})

test("fresh request resolution, preserved custom URL and headers, response uses matched request not current account", async () => {
  let current: Credential.Value = oauth
  let resolutions = 0
  const http = hooks({
    active: () => Effect.succeed({ type: "env", name: "CLAUDE_CODE_OAUTH_TOKEN" }),
    resolve: () =>
      Effect.sync(() => {
        resolutions++
        return current
      }),
  })
  const first = request()
  await Effect.runPromise(http.request(first))
  expect(first.request.url).toBe("https://fixture.invalid/custom/v1/messages?keep=yes")
  expect(first.request.headers.get("authorization")).toBe("Bearer fresh")
  expect(first.request.headers.has("x-api-key")).toBe(false)
  expect(first.request.headers.get("x-custom")).toBe("kept")
  expect(first.request.headers.get("anthropic-beta")).toContain("custom")
  current = { ...oauth, access: "newer" }
  const second = request()
  await Effect.runPromise(http.request(second))
  expect(second.request.headers.get("authorization")).toBe("Bearer newer")
  current = { type: "key", key: "sk-ant-api03-normal" }
  const received = response(first.request)
  await Effect.runPromise(http.response(received))
  expect(resolutions).toBe(2)
  expect(received.response.status).toBe(202)
  expect(received.response.statusText).toBe("Accepted")
  expect(received.response.headers.get("x-request-id")).toBe("fixture")
  expect(received.response.headers.has("content-length")).toBe(false)
  expect(received.response.headers.has("content-encoding")).toBe(false)
  expect(await received.response.text()).toContain('"name":"bAsH"')
  const ordinary = request()
  const original = ordinary.request
  await Effect.runPromise(http.request(ordinary))
  expect(ordinary.request).toBe(original)
  const untouched = response(original)
  const before = untouched.response
  await Effect.runPromise(http.response(untouched))
  expect(untouched.response).toBe(before)
})

test("setup token path, non-SSE error/status/header pass-through", async () => {
  const http = hooks({
    active: () => Effect.succeed({ type: "env", name: "ANTHROPIC_API_KEY" }),
    resolve: () => Effect.succeed({ type: "key", key: "sk-ant-oat01-fixture" }),
  })
  const req = request()
  await Effect.runPromise(http.request(req))
  expect(req.request.headers.get("authorization")).toBe("Bearer sk-ant-oat01-fixture")
  const error = new Response('{"error":"denied"}', {
    status: 401,
    headers: { "content-type": "application/json", "retry-after": "10" },
  })
  const received = { ...scope, request: req.request, response: error }
  await Effect.runPromise(http.response(received))
  expect(received.response).toBe(error)
})

test("request cancellation signal survives shaping", async () => {
  const http = hooks({
    active: () => Effect.succeed({ type: "env", name: "CLAUDE_CODE_OAUTH_TOKEN" }),
    resolve: () => Effect.succeed(oauth),
  })
  const abort = new AbortController()
  const req = request(abort.signal)
  await Effect.runPromise(http.request(req))
  abort.abort("stop")
  expect(req.request.signal.aborted).toBe(true)
  expect(req.request.signal.reason).toBe("stop")
})

test("resolution failure stops the request locally instead of using the stale key", async () => {
  const http = hooks({
    active: () => Effect.succeed({ type: "env", name: "CLAUDE_CODE_OAUTH_TOKEN" }),
    resolve: () => Effect.fail(new Error("access-only import expired")),
  })
  await expect(Effect.runPromise(http.request(request()))).rejects.toThrow("access-only import expired")
})
