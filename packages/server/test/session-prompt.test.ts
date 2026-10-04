import { expect } from "bun:test"
import { SessionExecution } from "@opencode/core/session/execution"
import { Bus } from "@opencode/core/bus"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const idle = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    isActive: () => Effect.succeed(false),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.succeed(false),
    awaitIdle: () => Effect.void,
  }),
)

it.live("rejects unknown prompt body keys instead of dropping them", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-session-prompt-")))
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test-version" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [
          SessionExecution.node.replace(
            makeGlobalNode({ service: SessionExecution.Service, layer: idle, deps: [Bus.node] }),
          ),
        ],
      },
    )
    const request = (path: string, body: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        )
        return { status: response.status, body: (await response.json()) as Record<string, unknown> }
      })
    const created = yield* request("/api/session", { location: { directory: tmp.path } })
    const sessionID = (created.body.data as { id: string }).id
    const prompt = (body: unknown) => request(`/api/session/${sessionID}/prompt`, body)

    expect(yield* prompt({ text: "ok", model: { providerID: "anthropic", modelID: "claude-sonnet-5" } })).toEqual({
      status: 400,
      body: {
        _tag: "InvalidRequestError",
        message:
          'Unknown key at ["model"]: prompts do not select a model; use session.switchModel or pass model when creating the session',
        kind: "Payload",
        field: "model",
      },
    })
    expect(yield* prompt({ text: "ok", agent: "build", extra: 1 })).toEqual({
      status: 400,
      body: {
        _tag: "InvalidRequestError",
        message: 'Unknown key at ["agent"]\nUnknown key at ["extra"]',
        kind: "Payload",
        field: "agent",
      },
    })
    expect(yield* prompt({ model: {} })).toMatchObject({
      status: 400,
      body: { _tag: "InvalidRequestError", message: expect.stringContaining('Missing key\n  at ["text"]') },
    })

    // shuvbro dispatches workers with this exact body, repeating the path's sessionID.
    expect(yield* prompt({ sessionID, text: "dispatch", delivery: "queue" })).toMatchObject({ status: 200 })
    expect(
      yield* prompt({
        text: "@build hello",
        agents: [{ name: "build", mention: { start: 0, end: 6, text: "@build" }, stale: true }],
        metadata: { source: "test", nested: { anything: true } },
        delivery: "steer",
        resume: false,
      }),
    ).toMatchObject({ status: 200 })
  }),
)
