export * as Permission from "./permission.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Clock, Context, Deferred, Effect, Layer, Schema } from "effect"
import { and, eq, isNull, lt, ne } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Permission } from "@opencode-ai/schema/permission"
import { Bus } from "./bus.js"
import { Location } from "./location.js"
import { Agent } from "./agent.js"
import { SessionErrors } from "./session/error.js"
import { SessionSchema } from "./session/schema.js"
import { SessionStore } from "./session/store.js"
import { Wildcard } from "./util/wildcard.js"
import { PermissionSaved } from "./permission/saved.js"
import { PluginHooks } from "./plugin/hooks.js"
import { Database } from "./database/database.js"
import { PermissionRequestTable } from "./permission/sql.js"

const RETENTION = 7 * 24 * 60 * 60 * 1000

const PermissionEffect = Permission.Effect
export { PermissionEffect as Effect }
export { Rule, Ruleset } from "@opencode-ai/schema/permission"
const missingAgentPermissions: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]

export const ID = Permission.ID
export type ID = typeof ID.Type

export const Source = Permission.Source
export type Source = typeof Source.Type

const RequestFields = {
  sessionID: Permission.Request.fields.sessionID,
  action: Permission.Request.fields.action,
  resources: Permission.Request.fields.resources,
  save: Permission.Request.fields.save,
  metadata: Permission.Request.fields.metadata,
  source: Permission.Request.fields.source,
}

export const Request = Permission.Request
export type Request = typeof Request.Type

export const Reply = Permission.Reply
export type Reply = typeof Reply.Type

export const State = Permission.State
export type State = typeof State.Type
type TerminalState = Exclude<State, { readonly status: "pending" }>

export const Receipt = Permission.Receipt
export type Receipt = typeof Receipt.Type

export const AssertInput = Schema.Struct({
  id: ID.pipe(Schema.optional),
  ...RequestFields,
  agent: Agent.ID.pipe(Schema.optional),
}).annotate({ identifier: "Permission.AssertInput" })
export type AssertInput = typeof AssertInput.Type

export const ReplyInput = Schema.Struct({
  requestID: ID,
  reply: Reply,
  message: Schema.String.pipe(Schema.optional),
  responseID: Permission.ResponseID.pipe(Schema.optional),
}).annotate({ identifier: "Permission.ReplyInput" })
export type ReplyInput = typeof ReplyInput.Type

export const AskResult = Schema.Struct({
  id: ID,
  effect: Permission.Effect,
}).annotate({ identifier: "Permission.AskResult" })
export type AskResult = typeof AskResult.Type

export { Event } from "@opencode-ai/schema/permission"

export class DeclinedError extends Schema.TaggedError<DeclinedError>()("Permission.DeclinedError", {}) {}

export class CorrectedError extends Schema.TaggedError<CorrectedError>()("Permission.CorrectedError", {
  feedback: Schema.String,
}) {}

export class BlockedError extends Schema.TaggedError<BlockedError>()("Permission.BlockedError", {
  rules: Permission.Ruleset,
  permission: Schema.String,
  resources: Schema.Array(Schema.String),
  reason: Schema.String.pipe(Schema.optional),
}) {
  override get message() {
    return this.reason ?? `Permission denied: ${this.permission}`
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Permission.NotFoundError", {
  requestID: ID,
}) {}

export type Error = BlockedError | CorrectedError

export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

export function merge(...rulesets: Permission.Ruleset[]): Permission.Ruleset {
  return rulesets.flat()
}

export interface Interface {
  readonly ask: (input: AssertInput) => Effect.Effect<AskResult, SessionErrors.NotFoundError>
  readonly assert: (input: AssertInput) => Effect.Effect<void, Error | SessionErrors.NotFoundError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Request | undefined>
  readonly receipt: (id: ID) => Effect.Effect<Receipt | undefined>
  readonly forSession: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Request>>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

interface Pending {
  readonly request: Request
  readonly agent?: Agent.ID
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const agents = yield* Agent.Service
    const sessions = yield* SessionStore.Service
    const saved = yield* PermissionSaved.Service
    const hooks = yield* PluginHooks.Service
    const database = yield* Database.Service
    const db = database.db
    const generation = randomUUID()
    const pending = new Map<ID, Pending>()
    const scope = and(
      eq(PermissionRequestTable.directory, location.directory),
      location.workspaceID === undefined
        ? isNull(PermissionRequestTable.workspace_id)
        : eq(PermissionRequestTable.workspace_id, location.workspaceID),
    )

    const expire = Effect.fnUntraced(function* () {
      const cutoff = (yield* Clock.currentTimeMillis) - RETENTION
      yield* db
        .delete(PermissionRequestTable)
        .where(
          and(scope, ne(PermissionRequestTable.status, "pending"), lt(PermissionRequestTable.time_updated, cutoff)),
        )
        .run()
        .pipe(Effect.orDie)
    })

    const stored = Effect.fnUntraced(function* (id: ID) {
      yield* expire()
      return yield* db
        .select()
        .from(PermissionRequestTable)
        .where(and(scope, eq(PermissionRequestTable.id, id)))
        .get()
        .pipe(Effect.orDie)
    })

    const notify = Effect.fn("Permission.notify")(function* (request: Request, reply?: Reply) {
      const publication =
        reply === undefined
          ? bus.publish(Permission.Event.Asked, request).pipe(Effect.asVoid)
          : bus
              .publish(Permission.Event.Replied, {
                sessionID: request.sessionID,
                requestID: request.id,
                reply,
              })
              .pipe(Effect.asVoid)
      yield* publication.pipe(
        Effect.catchCause(() => Effect.logWarning("Permission notification failed after durable commit")),
      )
    })

    // The conditional write decides the winner before callbacks or observers run.
    // A saved grant and its acceptance receipt must survive or roll back together.
    const settle = Effect.fn("Permission.settle")(
      (item: Pending, state: TerminalState, responseID?: string, remember: boolean = false) =>
        db
          .transaction(
            () =>
              Effect.gen(function* () {
                const changed = yield* db
                  .update(PermissionRequestTable)
                  .set({
                    status: state.status,
                    state,
                    response_id: responseID ?? null,
                    time_updated: yield* Clock.currentTimeMillis,
                  })
                  .where(
                    and(
                      scope,
                      eq(PermissionRequestTable.id, item.request.id),
                      eq(PermissionRequestTable.generation, generation),
                      eq(PermissionRequestTable.status, "pending"),
                    ),
                  )
                  .returning({ id: PermissionRequestTable.id })
                  .get()
                if (!changed) return false
                if (remember && item.request.save?.length) {
                  yield* saved.add({
                    projectID: location.project.id,
                    action: item.request.action,
                    resources: item.request.save,
                  })
                }
                return true
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie),
    )

    const complete = Effect.fnUntraced(function* (item: Pending, state: TerminalState) {
      pending.delete(item.request.id)
      if (state.status === "cancelled" || state.reply === "reject") {
        yield* Deferred.fail(
          item.deferred,
          state.status === "answered" && state.message
            ? new CorrectedError({ feedback: state.message })
            : new DeclinedError(),
        )
      } else {
        yield* Deferred.succeed(item.deferred, undefined)
      }
      if (state.status === "answered") yield* notify(item.request, state.reply)
    })

    const cancel = Effect.fn("Permission.cancel")((item: Pending) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (pending.get(item.request.id) !== item) return
          const state = { status: "cancelled" } as const
          if (yield* settle(item, state)) yield* complete(item, state)
        }),
      ),
    )

    yield* Effect.addFinalizer(() => Effect.forEach(Array.from(pending.values()), cancel, { discard: true }))

    const savedRules = Effect.fnUntraced(function* () {
      return (yield* saved.list({ projectID: location.project.id })).map(
        (item): Permission.Rule => ({
          action: item.action,
          resource: item.resource,
          effect: "allow",
        }),
      )
    })

    const configured = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, agentID?: Agent.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionErrors.NotFoundError({ sessionID })
      const agent = yield* agents.resolve(agentID ?? session.agent)
      return agent?.permissions ?? missingAgentPermissions
    })

    function denied(input: Pick<Request, "action" | "resources">, rules: Permission.Ruleset) {
      return input.resources.some((resource) => evaluate(input.action, resource, rules).effect === "deny")
    }

    function relevant(input: AssertInput, rules: Permission.Ruleset) {
      return rules.filter((rule) => Wildcard.match(input.action, rule.action))
    }

    const evaluateInput = Effect.fnUntraced(function* (input: AssertInput) {
      const rules = yield* configured(input.sessionID, input.agent)
      if (denied(input, rules)) return { effect: "deny" as const, rules }
      const all = [...rules, ...(yield* savedRules())]
      const effects = input.resources.map((resource) => evaluate(input.action, resource, all).effect)
      const effect: Permission.Effect = effects.includes("ask") ? "ask" : "allow"
      const event = yield* hooks.trigger("permission", "evaluate", {
        sessionID: input.sessionID,
        agent: input.agent,
        action: input.action,
        resources: input.resources,
        metadata: input.metadata,
        source: input.source,
        effect,
      })
      return { effect: event.effect, message: event.message, rules: all }
    })

    function request(input: AssertInput, message?: string): Request {
      return {
        id: input.id ?? ID.create(),
        sessionID: input.sessionID,
        action: input.action,
        resources: input.resources,
        save: input.save,
        metadata: input.metadata,
        source: input.source,
        message,
      }
    }

    const create = (request: Request, agent?: Agent.ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<void, DeclinedError | CorrectedError>()
          const item = { request, agent, deferred }
          yield* expire()
          const created = yield* db
            .insert(PermissionRequestTable)
            .values({
              id: request.id,
              directory: location.directory,
              workspace_id: location.workspaceID ?? null,
              generation,
              request,
              agent: agent ?? null,
              status: "pending",
              state: { status: "pending" },
              time_created: yield* Clock.currentTimeMillis,
              time_updated: yield* Clock.currentTimeMillis,
            })
            .onConflictDoNothing()
            .returning({ id: PermissionRequestTable.id })
            .get()
            .pipe(Effect.orDie)
          if (!created) return yield* Effect.die(new Error(`Duplicate permission ID: ${request.id}`))
          pending.set(request.id, item)
          yield* notify(request)
          return item
        }),
      )

    const ask = Effect.fn("Permission.ask")(function* (input: AssertInput) {
      const result = yield* evaluateInput(input)
      const value = request(input, result.message)
      if (result.effect === "ask") yield* create(value, input.agent)
      return { id: value.id, effect: result.effect }
    })

    const assert = Effect.fn("Permission.assert")((input: AssertInput) =>
      Effect.gen(function* () {
        const result = yield* evaluateInput(input)
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (result.effect === "deny") {
              return yield* new BlockedError({
                rules: relevant(input, result.rules),
                permission: input.action,
                resources: input.resources,
                reason: result.message,
              })
            }
            if (result.effect === "allow") return
            const item = yield* create(request(input, result.message), input.agent)
            return yield* restore(Deferred.await(item.deferred)).pipe(
              // Deliberate defect tunnel: leaves wrap execution in blanket `mapError`, which
              // must not convert a user's decline into model-facing tool output. The decline
              // resurfaces as a typed failure at SessionModelRequest.executeTool. A decline
              // WITH feedback (CorrectedError) intentionally stays typed so the leaf can turn
              // it into ToolFailure and the model continues.
              Effect.catchTag("Permission.DeclinedError", (error) => Effect.die(error)),
              Effect.onInterrupt(() => cancel(item)),
            )
          }),
        )
      }),
    )

    const receipt = Effect.fn("Permission.receipt")(function* (id: ID): Effect.fn.Return<Receipt | undefined> {
      const row = yield* stored(id)
      if (!row) return
      return {
        request: row.request,
        state: row.state,
        available: row.status === "pending" && row.generation === generation && pending.has(id),
        ...(row.response_id === null ? {} : { responseID: row.response_id }),
        time: { created: row.time_created, updated: row.time_updated },
      }
    })

    const reply = Effect.fn("Permission.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const matches = (row: typeof PermissionRequestTable.$inferSelect | undefined) =>
            input.responseID !== undefined &&
            row?.response_id === input.responseID &&
            row.state.status === "answered" &&
            row.state.reply === input.reply &&
            row.state.message === input.message
          if (input.responseID !== undefined && !Schema.is(Permission.ResponseID)(input.responseID)) {
            return yield* new NotFoundError({ requestID: input.requestID })
          }
          const row = yield* stored(input.requestID)
          if (matches(row)) return
          const existing = pending.get(input.requestID)
          if (!existing || row?.status !== "pending" || row.generation !== generation) {
            return yield* new NotFoundError({ requestID: input.requestID })
          }
          const state: TerminalState = {
            status: "answered",
            reply: input.reply,
            ...(input.message === undefined ? {} : { message: input.message }),
          }
          if (!(yield* settle(existing, state, input.responseID, input.reply === "always"))) {
            if (matches(yield* stored(input.requestID))) return
            return yield* new NotFoundError({ requestID: input.requestID })
          }
          yield* complete(existing, state)
          if (input.reply === "reject") {
            for (const item of Array.from(pending.values())) {
              if (item.request.sessionID !== existing.request.sessionID) continue
              const rejected = { status: "answered", reply: "reject" } as const
              if (yield* settle(item, rejected)) yield* complete(item, rejected)
            }
            return
          }
          if (input.reply !== "always" || !existing.request.save?.length) return
          for (const item of Array.from(pending.values())) {
            const result = yield* evaluateInput({ ...item.request, agent: item.agent }).pipe(
              Effect.catchTag("Session.NotFoundError", () => Effect.undefined),
            )
            if (result?.effect !== "allow") continue
            const allowed = { status: "answered", reply: "always" } as const
            // Policy hooks may yield while another reply settles this request.
            if (yield* settle(item, allowed)) yield* complete(item, allowed)
          }
        }),
      ),
    )

    const list = Effect.fn("Permission.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    const get = Effect.fn("Permission.get")(function* (id: ID) {
      return pending.get(id)?.request
    })

    const forSession = Effect.fn("Permission.forSession")(function* (sessionID: SessionSchema.ID) {
      return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID)
    })

    return Service.of({ ask, assert, reply, get, receipt, forSession, list })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Location.node, Agent.node, SessionStore.node, PermissionSaved.node, PluginHooks.node, Database.node],
})
