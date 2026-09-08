import { expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Agent } from "@opencode-ai/core/agent"
import { Permission } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PermissionRequestTable } from "@opencode-ai/core/permission/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Session } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
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
  return AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Location.node,
      Form.node,
      Permission.node,
      PermissionSaved.node,
      Agent.node,
    ]),
    [
      Database.node.replace(Database.configured({ path: `${path}/requests.db` })),
      Global.node.replace(Layer.succeed(Global.Service, Global.make({ data: path }))),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ),
    ],
  )
}

function permissionInput() {
  return {
    id: Permission.ID.create(),
    sessionID: Session.ID.create(),
    action: "read",
    resources: ["src/index.ts"],
    save: ["src/*"],
  } satisfies Permission.AssertInput
}

function setupPermission(input: Permission.AssertInput) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const current = yield* Location.Service
    const agents = yield* Agent.Service
    yield* database.db
      .insert(ProjectTable)
      .values({
        id: Project.ID.global,
        worktree: current.directory,
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values({
        id: input.sessionID,
        project_id: Project.ID.global,
        slug: "recovery",
        directory: current.directory,
        title: "Recovery",
        version: "test",
        agent: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        agent.permissions = [{ action: "*", resource: "*", effect: "ask" }]
      }),
    )
  })
}

const question = {
  sessionID: "global",
  title: "Synthetic recovery question",
  fields: [{ key: "choice", type: "string", required: true }],
} satisfies Form.CreateInput

test("retains an answered form and acknowledges only its exact response after reopen", async () => {
  await using tmp = await tmpdir()
  const id = Form.ID.create()
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
  const id = Form.ID.create()
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

test("permission exact replay after reopen preserves outcome without repeated grants or notifications", async () => {
  await using tmp = await tmpdir()
  const input = permissionInput()
  const response = {
    requestID: input.id,
    reply: "always",
    message: "approved",
    responseID: "recovery-response",
  } as const
  const grants = await Effect.gen(function* () {
    yield* setupPermission(input)
    const permissions = yield* Permission.Service
    const saved = yield* PermissionSaved.Service
    const bus = yield* Bus.Service
    const replies: unknown[] = []
    yield* bus.listen((event) =>
      Effect.sync(() => {
        if (event.type === Permission.Event.Replied.type) replies.push(event.data)
      }),
    )
    expect(yield* permissions.ask(input)).toEqual({ id: input.id, effect: "ask" })
    yield* permissions.reply(response)
    expect(replies).toHaveLength(1)
    const grants = yield* saved.list()
    expect(grants).toHaveLength(1)
    return grants
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)

  await Effect.gen(function* () {
    const permissions = yield* Permission.Service
    const saved = yield* PermissionSaved.Service
    const bus = yield* Bus.Service
    const replies: unknown[] = []
    yield* bus.listen((event) =>
      Effect.sync(() => {
        if (event.type === Permission.Event.Replied.type) replies.push(event.data)
      }),
    )
    expect(yield* saved.list()).toEqual(grants)
    // Removing the grant makes an accidental repeated save observable even if add is idempotent.
    yield* saved.remove(grants[0].id)
    const receipt = yield* permissions.receipt(input.id)
    expect(receipt).toMatchObject({
      available: false,
      responseID: response.responseID,
      state: { status: "answered", reply: "always", message: "approved" },
    })
    yield* permissions.reply(response)
    for (const changed of [
      { ...response, reply: "once" as const },
      { ...response, message: "changed" },
      { ...response, message: undefined },
      { ...response, responseID: "different-response" },
      { ...response, responseID: undefined },
    ]) {
      expect(yield* permissions.reply(changed).pipe(Effect.flip)).toBeInstanceOf(Permission.NotFoundError)
    }
    expect(yield* permissions.receipt(input.id)).toEqual(receipt)
    expect(yield* saved.list()).toEqual([])
    expect(replies).toEqual([])
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
})

for (const status of ["settled", "pending"] as const) {
  test(`reopened ${status} permission rejects duplicate IDs and retains foreign pending rows`, async () => {
    await using tmp = await tmpdir()
    const input = permissionInput()
    await Effect.gen(function* () {
      yield* setupPermission(input)
      const permissions = yield* Permission.Service
      expect(yield* permissions.ask(input)).toEqual({ id: input.id, effect: "ask" })
      if (status === "settled") yield* permissions.reply({ requestID: input.id, reply: "once" })
    }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)

    await Effect.gen(function* () {
      yield* setupPermission(input)
      const permissions = yield* Permission.Service
      const database = yield* Database.Service
      if (status === "pending") {
        // Model a persisted request from a different generation, not a proven-dead owner.
        yield* database.db
          .update(PermissionRequestTable)
          .set({
            status: "pending",
            state: { status: "pending" },
            generation: "foreign-generation",
            time_updated: 1,
          })
          .where(eq(PermissionRequestTable.id, input.id))
          .run()
          .pipe(Effect.orDie)
      }
      const receipt = yield* permissions.receipt(input.id)
      expect(receipt).toMatchObject({
        available: false,
        state: { status: status === "pending" ? "pending" : "answered" },
      })
      expect(yield* permissions.list()).toEqual([])
      expect(yield* permissions.get(input.id)).toBeUndefined()
      expect(yield* permissions.reply({ requestID: input.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
        Permission.NotFoundError,
      )
      expect(yield* permissions.ask(input).pipe(Effect.flip)).toBeInstanceOf(Permission.AlreadyExistsError)
      expect(yield* permissions.receipt(input.id)).toEqual(receipt)
    }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)

    await Effect.gen(function* () {
      const permissions = yield* Permission.Service
      expect(yield* permissions.receipt(input.id)).toMatchObject({
        available: false,
        state: { status: status === "pending" ? "pending" : "answered" },
      })
    }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
  })
}

test("graceful shutdown retains permission cancellation", async () => {
  await using tmp = await tmpdir()
  const input = permissionInput()
  await Effect.gen(function* () {
    yield* setupPermission(input)
    const permissions = yield* Permission.Service
    yield* permissions.ask(input)
    expect(yield* permissions.receipt(input.id)).toMatchObject({ available: true, state: { status: "pending" } })
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
  await Effect.gen(function* () {
    const permissions = yield* Permission.Service
    expect(yield* permissions.receipt(input.id)).toMatchObject({ available: false, state: { status: "cancelled" } })
    expect(yield* permissions.reply({ requestID: input.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
      Permission.NotFoundError,
    )
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
})

test("form and permission IDs conflict globally while receipts remain Location-private", async () => {
  await using tmp = await tmpdir()
  const input = permissionInput()
  const id = Form.ID.create()
  await Effect.gen(function* () {
    yield* setupPermission(input)
    const forms = yield* Form.Service
    const permissions = yield* Permission.Service
    yield* forms.create({ ...question, id })
    yield* permissions.ask(input)
    yield* Effect.gen(function* () {
      yield* setupPermission(input)
      const foreignForms = yield* Form.Service
      const foreignPermissions = yield* Permission.Service
      expect(yield* foreignForms.receipt(id).pipe(Effect.flip)).toBeInstanceOf(Form.NotFoundError)
      expect(yield* foreignPermissions.receipt(input.id)).toBeUndefined()
      expect(yield* foreignForms.create({ ...question, id }).pipe(Effect.flip)).toBeInstanceOf(Form.AlreadyExistsError)
      expect(yield* foreignPermissions.ask(input).pipe(Effect.flip)).toBeInstanceOf(Permission.AlreadyExistsError)
      expect(yield* foreignForms.receipt(id).pipe(Effect.flip)).toBeInstanceOf(Form.NotFoundError)
      expect(yield* foreignPermissions.receipt(input.id)).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(Layer.fresh(runtime(tmp.path, `${tmp.path}/other`))))
    expect(yield* forms.receipt(id)).toMatchObject({ available: true, state: { status: "pending" } })
    expect(yield* permissions.receipt(input.id)).toMatchObject({ available: true, state: { status: "pending" } })
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
})

test("old foreign-generation forms remain pending and unavailable across reopen", async () => {
  await using tmp = await tmpdir()
  const id = Form.ID.create()
  await Effect.gen(function* () {
    const forms = yield* Form.Service
    yield* forms.create({ ...question, id })
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
  await Effect.gen(function* () {
    const database = yield* Database.Service
    const forms = yield* Form.Service
    yield* database.db
      .update(FormRequestTable)
      .set({
        status: "pending",
        state: { status: "pending" },
        owner_generation: "foreign-generation",
        time_updated: 1,
      })
      .where(eq(FormRequestTable.id, id))
      .run()
      .pipe(Effect.orDie)
    expect(yield* forms.receipt(id)).toMatchObject({ available: false, state: { status: "pending" } })
    expect(yield* forms.reply({ id, answer: { choice: "continue" } }).pipe(Effect.flip)).toBeInstanceOf(
      Form.NotFoundError,
    )
    expect(yield* forms.cancel(id).pipe(Effect.flip)).toBeInstanceOf(Form.NotFoundError)
    expect(yield* forms.list()).toEqual([])
  }).pipe(Effect.scoped, Effect.provide(runtime(tmp.path)), Effect.runPromise)
  await Effect.gen(function* () {
    const forms = yield* Form.Service
    expect(yield* forms.receipt(id)).toMatchObject({ available: false, state: { status: "pending" } })
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
