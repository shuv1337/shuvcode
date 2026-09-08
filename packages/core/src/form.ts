export * as Form from "./form.js"

import { Form } from "@opencode-ai/schema/form"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { and, eq, isNull, lt, ne } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus.js"
import { Database } from "./database/database.js"
import { Location } from "./location.js"
import { FormRequestTable } from "./form/sql.js"

const RETENTION = 7 * 24 * 60 * 60 * 1000

export const ID = Form.ID
export type ID = typeof ID.Type

export const Info = Form.Info
export type Info = typeof Info.Type

export const Field = Form.Field
export type Field = Form.Field

export const Fields = Form.Fields
export type Fields = Form.Fields

export const When = Form.When
export type When = Form.When

export const State = Form.State
export type State = typeof State.Type
export type TerminalState = Exclude<State, { readonly status: "pending" }>

export const Answer = Form.Answer
export type Answer = typeof Answer.Type

export const Reply = Form.Reply
export type Reply = typeof Reply.Type

export { Event } from "@opencode-ai/schema/form"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Form.NotFoundError", {
  id: ID,
}) {
  override get message() {
    return `Form not found: ${this.id}`
  }
}

export class AlreadySettledError extends Schema.TaggedError<AlreadySettledError>()("Form.AlreadySettledError", {
  id: ID,
}) {
  override get message() {
    return `Form already settled: ${this.id}`
  }
}

export class AlreadyExistsError extends Schema.TaggedError<AlreadyExistsError>()("Form.AlreadyExistsError", {
  id: ID,
}) {
  override get message() {
    return `Form already exists: ${this.id}`
  }
}

export class InvalidAnswerError extends Schema.TaggedError<InvalidAnswerError>()("Form.InvalidAnswerError", {
  id: ID,
  message: Schema.String,
}) {}

export class InvalidFormError extends Schema.TaggedError<InvalidFormError>()("Form.InvalidFormError", {
  message: Schema.String,
}) {}

export type CreateInput = Omit<Form.Info, "id"> & { readonly id?: ID }

export interface ReplyInput {
  readonly id: ID
  readonly answer: Answer
  readonly responseID?: string
}

export interface ListInput {
  readonly sessionID?: Form.Info["sessionID"]
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, AlreadyExistsError | InvalidFormError>
  readonly ask: (input: CreateInput) => Effect.Effect<TerminalState, AlreadyExistsError | InvalidFormError>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  readonly state: (id: ID) => Effect.Effect<State, NotFoundError>
  readonly receipt: (id: ID) => Effect.Effect<Form.Receipt, NotFoundError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, AlreadySettledError | InvalidAnswerError | NotFoundError>
  readonly cancel: (id: ID) => Effect.Effect<void, AlreadySettledError | NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Form") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const database = yield* Database.Service
    const location = yield* Location.Service
    const generation = crypto.randomUUID()
    const pending = new Map<ID, Deferred.Deferred<TerminalState>>()
    const scope = and(
      eq(FormRequestTable.directory, location.directory),
      location.workspaceID === undefined
        ? isNull(FormRequestTable.workspace_id)
        : eq(FormRequestTable.workspace_id, location.workspaceID),
    )
    const prune = () =>
      database.db
        .delete(FormRequestTable)
        .where(and(ne(FormRequestTable.status, "pending"), lt(FormRequestTable.time_updated, Date.now() - RETENTION)))
        .pipe(Effect.orDie)
    const requireRow = Effect.fn("Form.requireRow")(function* (id: ID) {
      yield* prune()
      const row = yield* database.db
        .select()
        .from(FormRequestTable)
        .where(and(eq(FormRequestTable.id, id), scope))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ id })
      return row
    })
    // A notification failure cannot undo an admitted request or an accepted answer.
    const notify = <A>(effect: Effect.Effect<A>) =>
      effect.pipe(Effect.catchCause(() => Effect.logWarning("Form notification failed after durable commit")))

    const create = Effect.fn("Form.create")((input: CreateInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const id = input.id ?? ID.create()
          const invalid = validateFields(input.fields)
          if (invalid) return yield* new InvalidFormError({ message: invalid })
          const form: Info = {
            id,
            sessionID: input.sessionID,
            title: input.title,
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
            fields: input.fields,
          }
          const deferred = yield* Deferred.make<TerminalState>()
          yield* prune()
          const stored = yield* database.db
            .insert(FormRequestTable)
            .values({
              id,
              session_id: form.sessionID,
              directory: location.directory,
              workspace_id: location.workspaceID ?? null,
              owner_generation: generation,
              request: form,
              status: "pending",
              state: { status: "pending" },
            })
            .onConflictDoNothing()
            .returning({ id: FormRequestTable.id })
            .get()
            .pipe(Effect.orDie)
          if (!stored) return yield* new AlreadyExistsError({ id })
          pending.set(id, deferred)
          yield* notify(bus.publish(Form.Event.Created, { form }))
          return form
        }),
      ),
    )

    const ask = Effect.fn("Form.ask")((input: CreateInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const form = yield* create(input)
          // A Created listener can answer immediately, before create returns.
          const row = yield* requireRow(form.id).pipe(Effect.orDie)
          if (row.state.status !== "pending") return row.state
          const deferred = pending.get(form.id)
          if (!deferred) return yield* Effect.die(new NotFoundError({ id: form.id }))
          return yield* restore(Deferred.await(deferred)).pipe(Effect.onInterrupt(() => Effect.ignore(cancel(form.id))))
        }),
      ),
    )

    const get = Effect.fn("Form.get")(function* (id: ID) {
      return (yield* requireRow(id)).request
    })

    const list = Effect.fn("Form.list")(function* (input?: ListInput) {
      const rows = yield* database.db
        .select()
        .from(FormRequestTable)
        .where(
          and(
            scope,
            eq(FormRequestTable.status, "pending"),
            eq(FormRequestTable.owner_generation, generation),
            input?.sessionID === undefined ? undefined : eq(FormRequestTable.session_id, input.sessionID),
          ),
        )
        .pipe(Effect.orDie)
      return rows.filter((row) => pending.has(row.id)).map((row) => row.request)
    })

    const state = Effect.fn("Form.state")(function* (id: ID) {
      return (yield* requireRow(id)).state
    })

    const receipt = Effect.fn("Form.receipt")(function* (id: ID): Effect.fn.Return<Form.Receipt, NotFoundError> {
      const row = yield* requireRow(id)
      return {
        request: row.request,
        state: row.state,
        available: row.status === "pending" && row.owner_generation === generation && pending.has(id),
        ...(row.response_id === null ? {} : { responseID: row.response_id }),
        time: { created: row.time_created, updated: row.time_updated },
      }
    })

    const reply = Effect.fn("Form.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (input.responseID !== undefined && !Schema.is(Form.ResponseID)(input.responseID)) {
            return yield* new InvalidAnswerError({ id: input.id, message: "Invalid response ID" })
          }
          const row = yield* requireRow(input.id)
          if (row.state.status !== "pending") {
            if (
              input.responseID !== undefined &&
              row.response_id === input.responseID &&
              row.state.status === "answered" &&
              isDeepStrictEqual(row.state.answer, input.answer)
            )
              return
            return yield* new AlreadySettledError({ id: input.id })
          }
          const deferred = pending.get(input.id)
          if (row.owner_generation !== generation || !deferred) return yield* new NotFoundError({ id: input.id })
          const invalid = validateAnswer(row.request.fields, input.answer)
          if (invalid) return yield* new InvalidAnswerError({ id: input.id, message: invalid })
          const next: TerminalState = { status: "answered", answer: input.answer }
          const settled = yield* database.db
            .update(FormRequestTable)
            .set({
              state: next,
              status: next.status,
              response_id: input.responseID ?? null,
            })
            .where(
              and(
                scope,
                eq(FormRequestTable.id, input.id),
                eq(FormRequestTable.status, "pending"),
                eq(FormRequestTable.owner_generation, generation),
              ),
            )
            .returning({ id: FormRequestTable.id })
            .get()
            .pipe(Effect.orDie)
          if (!settled) {
            const current = yield* requireRow(input.id)
            if (
              input.responseID !== undefined &&
              current.response_id === input.responseID &&
              current.state.status === "answered" &&
              isDeepStrictEqual(current.state.answer, input.answer)
            )
              return
            return yield* new AlreadySettledError({ id: input.id })
          }
          pending.delete(input.id)
          yield* Deferred.succeed(deferred, next)
          yield* notify(
            bus.publish(Form.Event.Replied, { id: input.id, sessionID: row.session_id, answer: input.answer }),
          )
        }),
      ),
    )

    const cancel = Effect.fn("Form.cancel")((id: ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const row = yield* requireRow(id)
          if (row.state.status !== "pending") return yield* new AlreadySettledError({ id })
          const deferred = pending.get(id)
          if (row.owner_generation !== generation || !deferred) return yield* new NotFoundError({ id })
          const next: TerminalState = { status: "cancelled" }
          const settled = yield* database.db
            .update(FormRequestTable)
            .set({ state: next, status: next.status })
            .where(
              and(
                scope,
                eq(FormRequestTable.id, id),
                eq(FormRequestTable.status, "pending"),
                eq(FormRequestTable.owner_generation, generation),
              ),
            )
            .returning({ id: FormRequestTable.id })
            .get()
            .pipe(Effect.orDie)
          if (!settled) return yield* new AlreadySettledError({ id })
          pending.delete(id)
          yield* Deferred.succeed(deferred, next)
          yield* notify(bus.publish(Form.Event.Cancelled, { id, sessionID: row.session_id }))
        }),
      ),
    )

    yield* Effect.addFinalizer(() =>
      Effect.forEach(Array.from(pending.keys()), (id) => cancel(id).pipe(Effect.ignore), { discard: true }),
    )

    return Service.of({ create, ask, get, list, state, receipt, reply, cancel })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Database.node, Location.node] })

export function validateAnswer(form: ReadonlyArray<Form.Field>, answer: Answer) {
  const fields = new Map(form.map((field) => [field.key, field] as const))
  for (const key of Object.keys(answer)) {
    if (!fields.has(key)) return `Unknown form field: ${key}`
  }
  for (const field of form) {
    const value = answer[field.key]
    if (field.type === "external") {
      if (value !== true) return `External form field must be acknowledged: ${field.key}`
      continue
    }
    const active = isActive(field, answer)
    if (value === undefined) {
      if (field.required && active) return `Missing required form field: ${field.key}`
      continue
    }
    if (!active) return `Form field is not active: ${field.key}`
    const invalid = validateField(field, value)
    if (invalid) return invalid
  }
}

type InputField = Exclude<Form.Field, Form.ExternalField>

function isActive(field: InputField, answer: Answer) {
  if (!field.when) return true
  return field.when.every((when) => matches(when, answer[when.key]))
}

// An unanswered referenced field makes the condition false for both ops. Combined with inactive
// fields being unanswerable, this cascades: hiding a field falsifies every condition referencing it.
function matches(when: Form.When, value: Form.Value | undefined) {
  if (value === undefined) return false
  const hit = Array.isArray(value) ? value.some((item) => item === when.value) : value === when.value
  return when.op === "eq" ? hit : !hit
}

// Create-time validation of `when` references: each condition must point at an earlier field,
// carry a value matching that field's type, and use a declared option when the field's options
// are closed. Rejecting these at creation surfaces authoring mistakes to the caller instead of
// silently never matching.
export function validateFields(fields: ReadonlyArray<Form.Field>) {
  if (fields.length === 0) return "Form must have at least one field"
  const earlier = new Map<string, InputField>()
  const keys = new Set<string>()
  for (const field of fields) {
    if (keys.has(field.key)) return `Duplicate form field key: ${field.key}`
    keys.add(field.key)
    if (field.type === "external") continue
    for (const when of field.when ?? []) {
      const target = earlier.get(when.key)
      if (!target) return `Form field condition must reference an earlier field: ${field.key} -> ${when.key}`
      const invalid = validateWhen(when, target)
      if (invalid) return `${invalid}: ${field.key} -> ${when.key}`
    }
    earlier.set(field.key, field)
  }
}

function validateWhen(when: Form.When, target: InputField) {
  if (target.type === "boolean") {
    if (typeof when.value !== "boolean") return "Form field condition value must be a boolean"
    return
  }
  if (target.type === "number" || target.type === "integer") {
    if (typeof when.value !== "number") return "Form field condition value must be a number"
    return
  }
  // string and multiselect targets both compare against string values
  if (typeof when.value !== "string") return "Form field condition value must be a string"
  const closed = target.type === "multiselect" ? !target.custom : target.options !== undefined && !target.custom
  if (closed && !target.options?.some((option) => option.value === when.value)) {
    return "Form field condition value must be one of the field's options"
  }
}

function validateField(field: InputField, value: Form.Value): string | undefined {
  if (field.type === "string") {
    if (typeof value !== "string") return `Expected string for form field: ${field.key}`
    if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
    if (field.minLength !== undefined && value.length < field.minLength) return `Form field is too short: ${field.key}`
    if (field.maxLength !== undefined && value.length > field.maxLength) return `Form field is too long: ${field.key}`
    if (field.pattern !== undefined) {
      try {
        if (!new RegExp(field.pattern).test(value)) return `Form field does not match pattern: ${field.key}`
      } catch {
        return `Form field has invalid pattern: ${field.key}`
      }
    }
    if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return `Expected email for form field: ${field.key}`
    if (field.format === "uri" && !URL.canParse(value)) return `Expected URI for form field: ${field.key}`
    if (field.format === "date" && !isDate(value)) return `Expected date for form field: ${field.key}`
    if (field.format === "date-time" && !isDateTime(value)) return `Expected date-time for form field: ${field.key}`
    if (field.options && !field.custom && !field.options.some((option) => option.value === value)) {
      return `Invalid option for form field: ${field.key}`
    }
    return
  }
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `Expected number for form field: ${field.key}`
    if (field.type === "integer" && !Number.isInteger(value)) return `Expected integer for form field: ${field.key}`
    if (field.minimum !== undefined && value < field.minimum) return `Form field is too small: ${field.key}`
    if (field.maximum !== undefined && value > field.maximum) return `Form field is too large: ${field.key}`
    return
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") return `Expected boolean for form field: ${field.key}`
    return
  }
  if (field.type === "multiselect") {
    if (!isStringArray(value)) return `Expected string array for form field: ${field.key}`
    if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
    if (field.minItems !== undefined && value.length < field.minItems)
      return `Too few selections for form field: ${field.key}`
    if (field.maxItems !== undefined && value.length > field.maxItems)
      return `Too many selections for form field: ${field.key}`
    if (!field.custom && value.some((item) => !field.options.some((option) => option.value === item))) {
      return `Invalid option for form field: ${field.key}`
    }
  }
}

function isStringArray(value: Form.Value): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isDateTime(value: string) {
  return !Number.isNaN(new Date(value).getTime())
}
