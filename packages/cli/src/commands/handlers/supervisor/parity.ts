import { EOL } from "node:os"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorClient } from "../../../supervisor/client"
import { SupervisorKnowledge } from "../../../supervisor/knowledge"
import { SupervisorOperator } from "../../../supervisor/operator"
import { SupervisorProtocol } from "../../../supervisor/protocol"
import { SupervisorSettings } from "../../../supervisor/settings"

function required(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required for this action`)
  return value
}

async function request(home: string | undefined, input: Record<string, unknown>, needsLead = false) {
  const settings = await SupervisorSettings.read(home)
  const generation = needsLead ? (await SupervisorOperator.status({ home: settings.home })).lead?.generation : undefined
  if (needsLead && generation === undefined) throw new Error("No active lead. Run: shuvcode supervisor lead --no-open")
  return SupervisorClient.request(settings.home, SupervisorProtocol.decode({ ...input, generation }))
}

function print(value: unknown) {
  if (Array.isArray(value)) {
    if (!value.length) return process.stdout.write(`No entries${EOL}`)
    return value.forEach(print)
  }
  if (value && typeof value === "object") {
    const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(value)
    return process.stdout.write(
      Object.entries(record)
        .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
        .join(EOL) +
        EOL +
        EOL,
    )
  }
  process.stdout.write(`${String(value ?? "Done")}${EOL}`)
}

export const channel = Runtime.handler(
  Commands.commands.supervisor.commands.channel,
  Effect.fn("cli.supervisor.channel")(function* (input) {
    const home = Option.getOrUndefined(input.home)
    const id = Option.getOrUndefined(input.id)
    const result = yield* Effect.tryPromise(() =>
      request(
        home,
        input.action === "configure"
          ? {
              type: "channel.configure",
              id: required(id, "Channel ID"),
              kind: required(Option.getOrUndefined(input.kind), "Channel kind"),
              endpoint: Option.getOrUndefined(input.endpoint),
              directory: Option.getOrUndefined(input.directory),
              automaticReplies: input.automaticReplies,
              enabled: required(Option.getOrUndefined(input.enabled), "--enabled") === "on",
            }
          : { type: `channel.${input.action}` },
      ),
    )
    print(result)
  }),
)

export const inbox = Runtime.handler(
  Commands.commands.supervisor.commands.inbox,
  Effect.fn("cli.supervisor.inbox")(function* (input) {
    const home = Option.getOrUndefined(input.home)
    const id = Option.getOrUndefined(input.id)
    const result = yield* Effect.tryPromise(() =>
      request(
        home,
        input.action === "list"
          ? { type: "inbox.list", state: Option.getOrUndefined(input.state) }
          : input.action === "ack"
            ? { type: "inbox.ack", id: required(id, "Inbox ID") }
            : input.action === "dismiss"
              ? { type: "inbox.dismiss", id: required(id, "Inbox ID") }
              : input.action === "reconcile-dismiss"
                ? {
                    type: "inbox.dismiss.reconcile",
                    id: required(id, "Inbox ID"),
                    outcome: required(Option.getOrUndefined(input.outcome), "--outcome"),
                  }
                : {
                    type: "inbox.note",
                    id: required(id, "Inbox ID"),
                    text: required(Option.getOrUndefined(input.text), "--text"),
                    source: Option.getOrUndefined(input.source) ?? "operator",
                    origin: Option.isSome(input.origin)
                      ? {
                          channel: input.origin.value,
                          threadID: Option.getOrUndefined(input.requestID),
                          replyMaxChars: Option.getOrUndefined(input.replyMaxChars),
                        }
                      : undefined,
                  },
      ),
    )
    print(result)
  }),
)

export const reply = Runtime.handler(
  Commands.commands.supervisor.commands.reply,
  Effect.fn("cli.supervisor.reply")(function* (input) {
    const home = Option.getOrUndefined(input.home)
    const result = yield* Effect.tryPromise(() =>
      request(
        home,
        input.action === "list"
          ? {
              type: "reply.list",
              sourceID: Option.getOrUndefined(input.sourceID),
              workID: Option.getOrUndefined(input.workID),
            }
          : input.action === "show"
            ? { type: "reply.get", id: required(Option.getOrUndefined(input.id), "reply ID") }
            : input.action === "promise"
              ? {
                  type: "reply.promise",
                  id: required(Option.getOrUndefined(input.id), "reply ID"),
                  sourceID: required(Option.getOrUndefined(input.sourceID), "--source"),
                  workID: Option.getOrUndefined(input.workID),
                  taskID: Option.getOrUndefined(input.taskID),
                  handoffID: Option.getOrUndefined(input.handoffID),
                  dueAt: Option.getOrUndefined(input.dueAt),
                }
              : input.action === "send"
                ? {
                    type: "reply.send",
                    id: required(Option.getOrUndefined(input.id), "reply ID"),
                    text: required(Option.getOrUndefined(input.text), "--text"),
                    imagePath: Option.getOrUndefined(input.imagePath),
                  }
                : input.action === "reconcile"
                  ? {
                      type: "reply.reconcile",
                      id: required(Option.getOrUndefined(input.id), "reply ID"),
                      outcome: required(Option.getOrUndefined(input.outcome), "--outcome"),
                    }
                  : input.action === "retire"
                    ? {
                        type: "reply.retire",
                        id: required(Option.getOrUndefined(input.id), "reply ID"),
                        reason: required(Option.getOrUndefined(input.reason), "--reason"),
                      }
                    : input.action === "rechain"
                      ? {
                          type: "reply.rechain",
                          id: required(Option.getOrUndefined(input.id), "reply ID"),
                          newID: required(Option.getOrUndefined(input.newID), "--new-id"),
                          workID: required(Option.getOrUndefined(input.workID), "--work-id"),
                          taskID: Option.getOrUndefined(input.taskID),
                          handoffID: Option.getOrUndefined(input.handoffID),
                        }
                      : { type: "reply.ack", id: required(Option.getOrUndefined(input.id), "reply ID") },
      ),
    )
    print(result)
  }),
)

export const away = Runtime.handler(
  Commands.commands.supervisor.commands.away,
  Effect.fn("cli.supervisor.away")(function* (input) {
    const home = Option.getOrUndefined(input.home)
    if (input.action === "enter" && (Option.isSome(input.words) || input.clauseActions.length))
      return yield* Effect.fail(new Error("Use away propose for instructions, then confirm its readback"))
    const id = Option.getOrUndefined(input.id) ?? `away-${crypto.randomUUID()}`
    const result = yield* Effect.tryPromise(async () => {
      if (input.action === "propose" || input.action === "enter") {
        const proposal = await request(home, {
          type: "away.propose",
          id,
          words: Option.getOrUndefined(input.words) ?? "",
          clauses: Array.from(
            {
              length: Math.max(
                input.clauseActions.length,
                input.objects.length,
                input.conditions.length,
                input.stops.length,
              ),
            },
            (_, i) => ({
              action: input.clauseActions[i],
              object: input.objects[i],
              when: input.conditions[i],
              stop: input.stops[i],
            }),
          ),
          expectedReturn: Option.getOrUndefined(input.expectedReturn),
          spend: Option.getOrUndefined(input.spend),
        })
        if (input.action === "enter") return request(home, { type: "away.confirm", proposalID: id })
        return proposal
      }
      if (input.action === "confirm")
        return request(home, {
          type: "away.confirm",
          proposalID: required(Option.getOrUndefined(input.id), "Proposal ID"),
        })
      if (input.action === "reclassify")
        return request(home, {
          type: "away.blocker.reclassify",
          blockerID: required(Option.getOrUndefined(input.id), "Blocker ID"),
          expectedReason: required(Option.getOrUndefined(input.expectedReason), "--expected-reason"),
          kind: required(Option.getOrUndefined(input.kind), "--kind"),
          reason: required(Option.getOrUndefined(input.reason), "--reason"),
          reference: required(Option.getOrUndefined(input.reference), "--reference"),
        })
      return request(home, {
        type:
          input.action === "get" ? "away.get" : input.action === "return" ? "away.return.begin" : "away.return.check",
      })
    })
    const state = Schema.decodeUnknownSync(
      Schema.Struct({
        readback: Schema.optional(Schema.String),
        enabled: Schema.optional(Schema.Boolean),
        pendingCatchup: Schema.optional(Schema.Boolean),
        contract: Schema.optional(Schema.Struct({ readback: Schema.String })),
        catchup: Schema.optional(Schema.Struct({ brief: Schema.String, complete: Schema.Boolean })),
      }),
    )(result)
    process.stdout.write((state.readback ?? state.catchup?.brief ?? state.contract?.readback ?? "Present") + EOL)
    if (input.action === "propose")
      process.stdout.write(
        `Confirm: shuvcode supervisor away confirm ${id}${home ? ` --home '${home.replaceAll("'", "'\\''")}'` : ""}${EOL}`,
      )
    if (state.pendingCatchup) process.stdout.write(`Catch-up pending${EOL}`)
    if (state.catchup?.complete) process.stdout.write(`Catch-up complete${EOL}`)
  }),
)

export const knowledge = Runtime.handler(
  Commands.commands.supervisor.commands.knowledge,
  Effect.fn("cli.supervisor.knowledge")(function* (input) {
    const id = Option.getOrUndefined(input.id)
    const action = input.action
    const changes =
      action === "stow"
        ? yield* Effect.tryPromise(async () =>
            Schema.decodeUnknownSync(Schema.Array(SupervisorKnowledge.Change))(
              await Bun.file(required(Option.getOrUndefined(input.plan), "--plan")).json(),
            ),
          )
        : undefined
    const result = yield* Effect.tryPromise(() =>
      request(
        Option.getOrUndefined(input.home),
        action === "list"
          ? {
              type: "knowledge.list",
              scope: Option.getOrUndefined(input.scope),
              scopeID: Option.getOrUndefined(input.scopeID),
            }
          : action === "get"
            ? { type: "knowledge.get", id: required(id, "Knowledge ID") }
            : action === "put"
              ? {
                  type: "knowledge.put",
                  id: required(id, "Knowledge ID"),
                  scope: required(Option.getOrUndefined(input.scope), "--scope"),
                  scopeID: Option.getOrUndefined(input.scopeID),
                  title: required(Option.getOrUndefined(input.title), "--title"),
                  content: required(Option.getOrUndefined(input.content), "--content"),
                  tier: Option.getOrUndefined(input.tier),
                  evidence: Option.getOrUndefined(input.evidence),
                  expiresAt: Option.getOrUndefined(input.expiresAt),
                  expiryCondition: Option.getOrUndefined(input.expiryCondition),
                }
              : action === "stow"
                ? {
                    type: "knowledge.stow",
                    changes: changes!,
                  }
                : action === "archive"
                  ? { type: "knowledge.archive.list", id }
                  : action === "shared-status"
                    ? { type: "knowledge.shared.status" }
                    : action === "cascade"
                      ? { type: "knowledge.cascade" }
                      : action === "budget"
                        ? {
                            type: "knowledge.budget.set",
                            budgetTokens: Number(
                              required(Option.getOrUndefined(input.budgetTokens)?.toString(), "--budget-tokens"),
                            ),
                          }
                        : { type: "knowledge.startup" },
      ),
    )
    print(result)
  }),
)

export const delegate = Runtime.handler(
  Commands.commands.supervisor.commands.delegate,
  Effect.fn("cli.supervisor.delegate")(function* (input) {
    const id = Option.getOrUndefined(input.id)
    const action = input.action
    const result = yield* Effect.tryPromise(() =>
      request(
        Option.getOrUndefined(input.home),
        {
          type: `delegate.${action}`,
          id: action === "list" ? undefined : id,
          includeArchived: action === "list" ? true : undefined,
          home: action === "add" ? required(Option.getOrUndefined(input.delegateHome), "--delegate-home") : undefined,
          host: Option.getOrUndefined(input.host),
          scope:
            action === "add"
              ? required(Option.getOrUndefined(input.scope), "--scope")
              : Option.getOrUndefined(input.scope),
          projectID: Option.getOrUndefined(input.projectID),
          sourceProjectID: Option.getOrUndefined(input.sourceProjectID),
          project: action === "provision" ? required(Option.getOrUndefined(input.project), "--project") : undefined,
          enabled: Option.isSome(input.enabled) ? input.enabled.value === "on" : undefined,
          model:
            action === "add" || action === "update"
              ? Option.isSome(input.model)
                ? SupervisorSettings.model(input.model.value)
                : undefined
              : Option.getOrUndefined(input.model),
          providerURL: Option.getOrUndefined(input.providerURL),
          text: action === "send" ? required(Option.getOrUndefined(input.text), "--text") : undefined,
          delivery: action === "send" ? (Option.getOrUndefined(input.delivery) ?? "steer") : undefined,
          operationID: action === "send" ? `msg_${crypto.randomUUID()}` : undefined,
        },
        !["list", "status"].includes(action),
      ),
    )
    print(result)
  }),
)

export const handoff = Runtime.handler(
  Commands.commands.supervisor.commands.handoff,
  Effect.fn("cli.supervisor.handoff")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      request(
        Option.getOrUndefined(input.home),
        {
          type: `handoff.${input.action}`,
          id: input.id,
          delegateID:
            input.action === "create" ? required(Option.getOrUndefined(input.delegateID), "--delegate") : undefined,
          workIDs: input.action === "create" ? input.workIDs : undefined,
        },
        input.action !== "status",
      ),
    )
    print(result)
  }),
)
