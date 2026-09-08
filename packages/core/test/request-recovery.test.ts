import { expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { Form } from "@opencode-ai/core/form"
import { FormRequestTable } from "@opencode-ai/core/form/sql"
import { Location } from "@opencode-ai/core/location"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"

function runtime(path: string, directory = path) {
  return AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Location.node, Form.node]), [
    [Database.node, Database.configured({ path: `${path}/requests.db` })],
    [Global.node, Layer.succeed(Global.Service, Global.make({ data: path }))],
    [
      Location.node,
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ],
  ])
}

const question = {
  sessionID: "global",
  title: "Synthetic recovery question",
  fields: [{ key: "choice", type: "string", required: true }],
} satisfies Form.CreateInput

test("retains an answered form and acknowledges only its exact response after reopen", async () => {
  await using tmp = await tmpdir()
  const id = Form.ID.create("frm_recovery_answered")
  await Effect.gen(function* () {
    const forms = yield* Form.Service
    yield* forms.create({ ...question, id })
    yield* forms.reply({ id, answer: { choice: "continue" }, responseID: "synthetic-response" })
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)

  await Effect.gen(function* () {
    const forms = yield* Form.Service
    expect(yield* forms.state(id)).toEqual({ status: "answered", answer: { choice: "continue" } })
    expect(yield* forms.receipt(id)).toMatchObject({ available: false, responseID: "synthetic-response" })
    yield* forms.reply({ id, answer: { choice: "continue" }, responseID: "synthetic-response" })
    for (const input of [
      { answer: { choice: "changed" }, responseID: "synthetic-response" },
      { answer: { choice: "continue" }, responseID: "different-response" },
      { answer: { choice: "continue" } },
    ]) {
      expect(yield* forms.reply({ id, ...input }).pipe(Effect.flip)).toBeInstanceOf(Form.AlreadySettledError)
    }
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)

  await Effect.gen(function* () {
    const forms = yield* Form.Service
    expect(yield* forms.receipt(id).pipe(Effect.flip)).toBeInstanceOf(Form.NotFoundError)
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path, `${tmp.path}/other`)), Effect.runPromise)
})

test("a foreign runtime cannot answer or cancel the live owner's pending form", async () => {
  await using tmp = await tmpdir()
  await Effect.gen(function* () {
    const owner = yield* Form.Service
    const form = yield* owner.create(question)
    expect((yield* owner.receipt(form.id)).available).toBe(true)
    yield* Effect.gen(function* () {
      const other = yield* Form.Service
      expect(yield* other.receipt(form.id)).toMatchObject({ state: { status: "pending" }, available: false })
      expect(yield* other.list()).toEqual([])
      expect(yield* other.reply({ id: form.id, answer: { choice: "wrong" } }).pipe(Effect.flip)).toBeInstanceOf(
        Form.NotFoundError,
      )
      expect(yield* other.cancel(form.id).pipe(Effect.flip)).toBeInstanceOf(Form.NotFoundError)
    }).pipe(Effect.scoped, Effect.provide(Layer.fresh(runtime(tmp.path))))
    expect((yield* owner.receipt(form.id)).available).toBe(true)
    yield* owner.reply({ id: form.id, answer: { choice: "owner" } })
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
})

test("graceful shutdown retains cancellation and terminal retention never expires pending requests", async () => {
  await using tmp = await tmpdir()
  const id = Form.ID.create("frm_graceful")
  await Effect.gen(function* () {
    const forms = yield* Form.Service
    yield* forms.create({ ...question, id })
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
  await Effect.gen(function* () {
    const forms = yield* Form.Service
    const database = yield* Database.Service
    expect((yield* forms.receipt(id)).state).toEqual({ status: "cancelled" })
    const pending = yield* forms.create(question)
    yield* database.db
      .update(FormRequestTable)
      .set({ time_updated: 1 })
      .where(eq(FormRequestTable.id, id))
      .pipe(Effect.orDie)
    yield* database.db
      .update(FormRequestTable)
      .set({ time_updated: 1 })
      .where(eq(FormRequestTable.id, pending.id))
      .pipe(Effect.orDie)
    expect(yield* forms.receipt(id).pipe(Effect.flip)).toBeInstanceOf(Form.NotFoundError)
    expect((yield* forms.receipt(pending.id)).available).toBe(true)
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
})

test("question waiter resolves even when the answer event listener fails", async () => {
  await using tmp = await tmpdir()
  await Effect.gen(function* () {
    const forms = yield* Form.Service
    const bus = yield* Bus.Service
    yield* bus.listen((event) => {
      if (event.type === Form.Event.Replied.type) return Effect.die("synthetic observer failure")
      if (event.type !== Form.Event.Created.type) return Effect.void
      const form = (event.data as { form: Form.Info }).form
      return forms.reply({ id: form.id, answer: { choice: "immediate" } }).pipe(Effect.orDie)
    })
    const result = yield* forms.ask(question).pipe(Effect.exit)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) expect(result.value).toEqual({ status: "answered", answer: { choice: "immediate" } })
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
})
