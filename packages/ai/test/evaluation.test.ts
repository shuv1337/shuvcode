import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { Evaluation, EvaluationClient } from "../src/experimental.js"
import { SystemOne } from "../src/experimental/system-one.js"
import { Auth } from "../src/route/auth.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json } from "./lib/http.js"

for (const authenticated of [false, true]) {
  it.effect(
    `Evaluation forwards per-call headers with ${authenticated ? "bearer" : "passthrough"} authentication`,
    () =>
      Evaluation.run({
        model: SystemOne.model({
          id: "fixture",
          provider: "fixture",
          providerMetadataKey: "fixture",
          baseURL: "https://evaluation.test/v1",
          auth: authenticated ? Auth.bearer("auth-sentinel") : Auth.none,
          headers: {
            "X-Default": "configuration",
            "X-Override": "configuration",
            Authorization: "configuration",
          },
          http: { query: { deployment: "fixture" }, body: { metadata: { default: true } } },
        }),
        state: "A fixture",
        questions: { relevant: { type: "boolean", instructions: "Is it relevant?" } },
        headers: { "x-request": "request-sentinel", "x-override": "request", authorization: "request" },
        http: { query: { trace: "fixture" }, body: { metadata: { request: true } } },
      }).pipe(
        Effect.tap((response) => Effect.sync(() => expect(response.answers.relevant.probability).toBe(0.75))),
        Effect.provide(
          EvaluationClient.layer.pipe(
            Layer.provide(
              dynamicResponse((input) =>
                Effect.gen(function* () {
                  const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                  expect(request.url).toBe("https://evaluation.test/v1/systemone?deployment=fixture&trace=fixture")
                  expect(request.headers.get("x-default")).toBe("configuration")
                  expect(request.headers.get("x-request")).toBe("request-sentinel")
                  expect(request.headers.get("x-override")).toBe("request")
                  expect(request.headers.get("authorization")).toBe(authenticated ? "Bearer auth-sentinel" : "request")
                  expect(request.headers.get("content-type")).toBe("application/json")
                  expect(JSON.parse(input.text)).toMatchObject({ metadata: { default: true, request: true } })
                  return json(input, { model: "fixture", answers: { relevant: { type: "noul", noul: 0.75 } } })
                }),
              ),
            ),
          ),
        ),
      ),
  )
}
