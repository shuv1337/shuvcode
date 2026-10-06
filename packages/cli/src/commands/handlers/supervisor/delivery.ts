import { EOL } from "node:os"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorBoard } from "../../../supervisor/board"
import { SupervisorOperator } from "../../../supervisor/operator"
import { SupervisorProtocol } from "../../../supervisor/protocol"
import { SupervisorSettings } from "../../../supervisor/settings"

const print = (text: string) => process.stdout.write(text + EOL)

function act(home: string | undefined, operation: SupervisorProtocol.Operation) {
  return Effect.tryPromise(() => SupervisorOperator.operate({ home }, operation)).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        const record = Schema.decodeUnknownSync(
          Schema.Struct({
            taskID: Schema.optional(Schema.String),
            status: Schema.optional(Schema.String),
            state: Schema.optional(Schema.String),
            blocker: Schema.optional(Schema.String),
            error: Schema.optional(Schema.String),
            pr: Schema.optional(Schema.Union([Schema.String, Schema.Struct({ url: Schema.String })])),
            archive: Schema.optional(Schema.String),
            worktree: Schema.optional(Schema.String),
            runID: Schema.optional(Schema.String),
          }),
        )(result)
        print(
          `${record.taskID ?? ("taskID" in operation ? operation.taskID : "Task")}: ${record.status ?? record.state ?? "recorded"}`,
        )
        if (record.pr) print(typeof record.pr === "string" ? record.pr : record.pr.url)
        if (record.runID) print(`Validation: ${record.runID}`)
        if (record.blocker || record.error) print(record.blocker ?? record.error!)
        if (record.archive) print(`Archive: ${record.archive}`)
      }),
    ),
  )
}

export const prepare = Runtime.handler(
  Commands.commands.supervisor.commands.delivery.commands.prepare,
  Effect.fn("cli.supervisor.delivery.prepare")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), { type: "delivery.prepare", taskID: input.task, generation: 0 })
  }),
)
export const publish = Runtime.handler(
  Commands.commands.supervisor.commands.delivery.commands.publish,
  Effect.fn("cli.supervisor.delivery.publish")(function* (input) {
    const body = yield* Effect.tryPromise(() => Bun.file(input.bodyFile).text())
    yield* act(Option.getOrUndefined(input.home), {
      type: "delivery.publish",
      taskID: input.task,
      generation: 0,
      title: input.title,
      body,
    })
  }),
)
export const approve = Runtime.handler(
  Commands.commands.supervisor.commands.delivery.commands.approve,
  Effect.fn("cli.supervisor.delivery.approve")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), {
      type: "delivery.approve",
      taskID: input.task,
      generation: 0,
      reference: input.reference,
    })
  }),
)
export const land = Runtime.handler(
  Commands.commands.supervisor.commands.delivery.commands.land,
  Effect.fn("cli.supervisor.delivery.land")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), { type: "delivery.land", taskID: input.task, generation: 0 })
  }),
)
export const cancel = Runtime.handler(
  Commands.commands.supervisor.commands.delivery.commands.cancel,
  Effect.fn("cli.supervisor.delivery.cancel")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), { type: "delivery.cancel", taskID: input.task, generation: 0 })
  }),
)
export const reconcile = Runtime.handler(
  Commands.commands.supervisor.commands.delivery.commands.reconcile,
  Effect.fn("cli.supervisor.delivery.reconcile")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), {
      type: "delivery.reconcile",
      taskID: input.task,
      generation: 0,
      prURL: Option.getOrUndefined(input.pr),
    })
  }),
)
export const cleanup = Runtime.handler(
  Commands.commands.supervisor.commands.delivery.commands.cleanup,
  Effect.fn("cli.supervisor.delivery.cleanup")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), { type: "delivery.cleanup", taskID: input.task, generation: 0 })
  }),
)
export const discard = Runtime.handler(
  Commands.commands.supervisor.commands.discard,
  Effect.fn("cli.supervisor.discard")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), {
      type: "task.discard",
      taskID: input.task,
      generation: 0,
      reference: input.reference,
    })
  }),
)
export const validateStart = Runtime.handler(
  Commands.commands.supervisor.commands.validate.commands.start,
  Effect.fn("cli.supervisor.validate.start")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), {
      type: "validation.start",
      taskID: input.task,
      generation: 0,
      intent: input.intent,
      validationGeneration: Option.getOrUndefined(input.generation),
    })
  }),
)
export const validateStatus = Runtime.handler(
  Commands.commands.supervisor.commands.validate.commands.status,
  Effect.fn("cli.supervisor.validate.status")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), {
      type: "validation.status",
      taskID: input.task,
      validationGeneration: Option.getOrUndefined(input.generation),
    })
  }),
)
export const validateAbort = Runtime.handler(
  Commands.commands.supervisor.commands.validate.commands.abort,
  Effect.fn("cli.supervisor.validate.abort")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), {
      type: "validation.abort",
      taskID: input.task,
      generation: 0,
      validationGeneration: Option.getOrUndefined(input.generation),
    })
  }),
)
export const validateRespond = Runtime.handler(
  Commands.commands.supervisor.commands.validate.commands.respond,
  Effect.fn("cli.supervisor.validate.respond")(function* (input) {
    yield* act(Option.getOrUndefined(input.home), {
      type: "validation.respond",
      taskID: input.task,
      generation: 0,
      action: input.action,
      findingIDs: input.finding.length ? input.finding : undefined,
      instructions: Option.getOrUndefined(input.instructions),
      userDecisionReference: Option.getOrUndefined(input.reference),
      validationGeneration: Option.getOrUndefined(input.generation),
    })
  }),
)

export const board = Runtime.handler(
  Commands.commands.supervisor.commands.board,
  Effect.fn("cli.supervisor.board")(function* (input) {
    const settings = yield* Effect.tryPromise(() => SupervisorSettings.read(Option.getOrUndefined(input.home)))
    const surface = SupervisorBoard.serve({ home: settings.home, port: input.port })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        surface.close()
      }),
    )
    print(surface.url)
    if (!input.noOpen && process.env.WAYLAND_DISPLAY) {
      const environment = { ...process.env }
      delete environment.DISPLAY
      Bun.spawn(["xdg-open", surface.url], { env: environment, stdout: "ignore", stderr: "ignore" })
    }
    return yield* Effect.never
  }),
)
