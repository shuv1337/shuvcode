import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Instance } from "@opencode/core/instance"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { AbsolutePath } from "@opencode/schema/schema"
import { Context, Effect, Fiber, Layer, Queue, Schema, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { executeTool, toolIdentity } from "../../core/test/lib/tool"
import { createEmbeddedRoutes } from "../src/routes"

it.live("lists and approves search permissions with omitted options without hiding other requests", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() => Bun.write(`${tmp.path}/hello.txt`, "hello\n"))
    const context = yield* Layer.build(
      createEmbeddedRoutes({
        database: { path: ":memory:" },
        config: { directory: tmp.path, project: false },
        fs: { filewatcher: false },
        models: { fetch: false },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const sessions = Context.get(context, Session.Service)
    const instances = Context.get(context, Instance.Service)
    const bus = Context.get(context, Bus.Service)
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (route: string, body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${route}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const session = yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      agent: toolIdentity.agent,
    })
    yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(toolIdentity.agent, (agent) => {
          agent.permissions = [{ action: "*", resource: "*", effect: "ask" }]
        }),
      )
      const permissions = yield* Permission.Service
      const tools = yield* Tool.Service
      const unrelated = yield* permissions.ask({
        sessionID: session.id,
        action: "shell",
        resources: ["echo hello"],
        agent: toolIdentity.agent,
      })
      expect(unrelated.effect).toBe("ask")
      const asked = yield* Queue.unbounded<Permission.Request>()
      yield* bus.subscribe(Permission.Event.Asked).pipe(
        Stream.runForEach((event) => Queue.offer(asked, event.data)),
        Effect.forkScoped({ startImmediately: true }),
      )

      for (const sample of [
        { name: "grep", input: { pattern: "hello" }, metadata: { root: "." } },
        { name: "glob", input: { pattern: "*.txt" }, metadata: { root: "." } },
        {
          name: "grep",
          input: { pattern: "hello", path: ".", include: "*.txt", literal: false, caseSensitive: false, limit: 1 },
          metadata: { root: ".", path: ".", include: "*.txt", literal: false, caseSensitive: false, limit: 1 },
        },
        {
          name: "glob",
          input: { pattern: "*.txt", path: ".", hidden: false, limit: 1 },
          metadata: { root: ".", path: ".", hidden: false, limit: 1 },
        },
      ]) {
        const fiber = yield* executeTool(tools, {
          ...toolIdentity,
          sessionID: session.id,
          call: { type: "tool-call", id: `call-${sample.name}`, name: sample.name, input: sample.input },
        }).pipe(Effect.forkScoped)
        const pending = yield* Queue.take(asked)

        for (const route of [
          `/api/session/${session.id}/permission`,
          `/api/permission/request?${new URLSearchParams({ "location[directory]": tmp.path })}`,
        ]) {
          const response = yield* request(route)
          expect({
            route,
            status: response.status,
            body: yield* Effect.promise(() => response.clone().json()),
          }).toMatchObject({
            status: 200,
          })
          const body = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Permission.Request) }))(
            yield* Effect.promise(() => response.json()),
          )
          expect(body.data).toHaveLength(2)
          expect(body.data).toContainEqual(expect.objectContaining({ id: unrelated.id, action: "shell" }))
          expect(body.data).toContainEqual(
            expect.objectContaining({ id: pending.id, action: sample.name, metadata: sample.metadata }),
          )
        }
        expect(
          (yield* request(`/api/session/${session.id}/permission/${pending.id}/reply`, { decision: "once" })).status,
        ).toBe(204)
        expect(yield* Fiber.join(fiber)).toMatchObject({ status: "completed" })
      }
      expect(
        (yield* request(`/api/session/${session.id}/permission/${unrelated.id}/reply`, { decision: "once" })).status,
      ).toBe(204)
      expect(yield* permissions.list()).toEqual([])
    }).pipe(instances.provide(session))
  }),
)
