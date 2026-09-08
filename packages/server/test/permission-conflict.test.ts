import { expect } from "bun:test"
import { Permission } from "@opencode-ai/schema/permission"
import { Session } from "@opencode-ai/schema/session"
import { Agent } from "@opencode-ai/core/agent"
import { Context, Effect, Layer, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("returns HTTP 409 for pending and settled duplicate permission IDs", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test-version" },
        database: { path: ":memory:" },
        config: { project: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      },
      {
        overrides: [
          Agent.node.replace(
            Agent.node.mapLayer((layer) =>
              layer.pipe(
                Layer.tap((context) =>
                  Context.get(context, Agent.Service).transform((editor) =>
                    editor.update(Agent.defaultID, (agent) => {
                      agent.permissions = [{ action: "duplicate-test", resource: "*", effect: "ask" }]
                    }),
                  ),
                ),
              ),
            ),
          ),
        ],
      },
    )
    const post = (path: string, body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )
    const created = yield* post("/api/session", {})
    expect(created.status).toBe(200)
    const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
      yield* Effect.promise(() => created.json()),
    )
    const path = `/api/session/${session.data.id}/permission`
    const input = { id: Permission.ID.create(), action: "duplicate-test", resources: ["*"] }
    const first = yield* post(path, input)
    expect(first.status).toBe(200)
    expect(yield* Effect.promise(() => first.json())).toEqual({ data: { id: input.id, effect: "ask" } })
    for (const state of ["pending", "settled"] as const) {
      if (state === "settled") {
        expect((yield* post(`${path}/${input.id}/reply`, { reply: "once" })).status).toBe(204)
      }
      const duplicate = yield* post(path, { ...input, resources: ["different"] })
      expect(duplicate.status).toBe(409)
      expect(yield* Effect.promise(() => duplicate.json())).toEqual({
        _tag: "ConflictError",
        resource: input.id,
        message: `Duplicate permission ID: ${input.id}`,
      })
      const receipt = yield* Effect.promise(() =>
        handler(new Request(`http://opencode.local${path}/${input.id}/receipt`)),
      )
      expect(receipt.status).toBe(200)
      expect(yield* Effect.promise(() => receipt.json())).toMatchObject({
        data: {
          request: input,
          state: state === "pending" ? { status: "pending" } : { status: "answered", reply: "once" },
        },
      })
    }
  }),
)
