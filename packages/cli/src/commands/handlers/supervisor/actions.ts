import { EOL } from "node:os"
import { Effect, Option, Schedule, Schema } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorFormat } from "../../../supervisor/format"
import { SupervisorOperator } from "../../../supervisor/operator"
import { SupervisorClient } from "../../../supervisor/client"
import { SupervisorProtocol } from "../../../supervisor/protocol"

const print = (value: string) => process.stdout.write(value + EOL)

export const up = Runtime.handler(
  Commands.commands.supervisor.commands.up,
  Effect.fn("cli.supervisor.up")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.up({
        home: Option.getOrUndefined(input.home),
        project: Option.getOrUndefined(input.project),
        model: Option.getOrUndefined(input.model),
        auto: input.auto,
        endpoint: Option.getOrUndefined(input.endpoint),
        providerURL: Option.getOrUndefined(input.providerURL),
      }),
    )
    print(`Supervisor running: ${result.project}`)
    if (input.open)
      return yield* Effect.tryPromise(() =>
        SupervisorOperator.attach({ home: result.home, sessionID: result.sessionID }),
      )
    print(`Run: shuvcode supervisor lead${SupervisorFormat.homeFlag(Option.getOrUndefined(input.home))}`)
  }),
)

export const init = Runtime.handler(
  Commands.commands.supervisor.commands.init,
  Effect.fn("cli.supervisor.init")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.init({
        home: Option.getOrUndefined(input.home),
        project: Option.getOrUndefined(input.project),
        model: Option.getOrUndefined(input.model),
        auto: input.auto,
        endpoint: Option.getOrUndefined(input.endpoint),
        providerURL: Option.getOrUndefined(input.providerURL),
      }),
    )
    print(`Supervisor initialized: ${result.home}`)
    print(`Run: shuvcode supervisor start${SupervisorFormat.homeFlag(Option.getOrUndefined(input.home))}`)
  }),
)

export const start = Runtime.handler(
  Commands.commands.supervisor.commands.start,
  Effect.fn("cli.supervisor.start")(function* (input) {
    yield* Effect.tryPromise(() => SupervisorOperator.start({ home: Option.getOrUndefined(input.home) }))
    print("Supervisor running")
    print(`Run: shuvcode supervisor lead${SupervisorFormat.homeFlag(Option.getOrUndefined(input.home))}`)
  }),
)

export const stop = Runtime.handler(
  Commands.commands.supervisor.commands.stop,
  Effect.fn("cli.supervisor.stop")(function* (input) {
    yield* Effect.tryPromise(() => SupervisorOperator.stop({ home: Option.getOrUndefined(input.home) }))
    print("Supervisor stopped")
  }),
)

export const lead = Runtime.handler(
  Commands.commands.supervisor.commands.lead,
  Effect.fn("cli.supervisor.lead")(function* (input) {
    const session = Option.getOrUndefined(input.session)
    if (session && input.new) return yield* Effect.fail(new Error("Choose --session or --new"))
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.lead({ home: Option.getOrUndefined(input.home), session, fresh: input.new }),
    )
    if (input.noOpen) {
      print(`Lead ready. Run: shuvcode supervisor lead${SupervisorFormat.homeFlag(Option.getOrUndefined(input.home))}`)
      return
    }
    yield* Effect.tryPromise(() => SupervisorOperator.attach({ home: result.home, sessionID: result.sessionID }))
  }),
)

export const send = Runtime.handler(
  Commands.commands.supervisor.commands.send,
  Effect.fn("cli.supervisor.send")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.send({ home: Option.getOrUndefined(input.home), text: input.message }),
    )
    print("Message sent to lead")
  }),
)

export const read = Runtime.handler(
  Commands.commands.supervisor.commands.read,
  Effect.fn("cli.supervisor.read")(function* (input) {
    const result = yield* Effect.tryPromise(() => SupervisorOperator.read({ home: Option.getOrUndefined(input.home) }))
    print(`Lead: ${result.state}`)
    if (result.text) print(result.text)
    if (!result.text && !result.permissions.length) print("No reply yet")
    SupervisorFormat.leadPermissions(result.permissions, Option.getOrUndefined(input.home)).forEach(print)
  }),
)

export const status = Runtime.handler(
  Commands.commands.supervisor.commands.status,
  Effect.fn("cli.supervisor.status")(function* (input) {
    const task = Option.getOrUndefined(input.task)
    const show = Effect.tryPromise(() =>
      SupervisorOperator.status({ home: Option.getOrUndefined(input.home), task }),
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (input.watch && process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H")
          print(
            input.json
              ? JSON.stringify(result)
              : SupervisorFormat.status(result, task, Option.getOrUndefined(input.home)),
          )
        }),
      ),
    )
    if (input.watch) return yield* show.pipe(Effect.repeat(Schedule.spaced("2 seconds")))
    yield* show
  }),
)

export const task = Runtime.handler(
  Commands.commands.supervisor.commands.task,
  Effect.fn("cli.supervisor.task")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.task({
        home: Option.getOrUndefined(input.home),
        brief: input.brief,
        name: Option.getOrUndefined(input.name),
        kind: input.kind,
        project: Option.getOrUndefined(input.project),
        base: Option.getOrUndefined(input.base),
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        dependsOn: input.dependsOn,
        afterLanded: input.afterLanded,
        hold: Option.getOrUndefined(input.hold),
        until: Option.getOrUndefined(input.until),
        notBefore: Option.getOrUndefined(input.notBefore),
        resources: input.resource,
        priority: Option.getOrUndefined(input.priority),
        mode: Option.getOrUndefined(input.mode),
        mergePolicy: Option.getOrUndefined(input.merge),
        classification: Option.getOrUndefined(input.classification),
      }),
    )
    print(`Work ${result.id}: ${result.state}`)
    print(
      `Run: shuvcode supervisor status --task ${result.id}${SupervisorFormat.homeFlag(Option.getOrUndefined(input.home))}`,
    )
  }),
)

export const projects = Runtime.handler(
  Commands.commands.supervisor.commands.projects,
  Effect.fn("cli.supervisor.projects")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projects({
        home: Option.getOrUndefined(input.home),
        includeArchived: input.all,
      }),
    )
    print(SupervisorFormat.projects(result))
  }),
)

export const projectAdd = Runtime.handler(
  Commands.commands.supervisor.commands.project.commands.add,
  Effect.fn("cli.supervisor.project.add")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projectAdd({
        home: Option.getOrUndefined(input.home),
        path: input.path,
        id: Option.getOrUndefined(input.name),
      }),
    )
    print(`Project ${result.id}: ${result.path}`)
  }),
)
export const projectClone = Runtime.handler(
  Commands.commands.supervisor.commands.project.commands.clone,
  Effect.fn("cli.supervisor.project.clone")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projectAdd({
        home: Option.getOrUndefined(input.home),
        url: input.url,
        id: input.name,
      }),
    )
    print(`Project ${result.id}: ${result.path}`)
  }),
)
export const projectNew = Runtime.handler(
  Commands.commands.supervisor.commands.project.commands.new,
  Effect.fn("cli.supervisor.project.new")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projectAdd({
        home: Option.getOrUndefined(input.home),
        initialize: true,
        id: input.name,
      }),
    )
    print(`Project ${result.id}: ${result.path}`)
  }),
)
export const projectSet = Runtime.handler(
  Commands.commands.supervisor.commands.project.commands.set,
  Effect.fn("cli.supervisor.project.set")(function* (input) {
    if (input.yolo && input.noYolo) return yield* Effect.fail(new Error("Choose --yolo or --no-yolo"))
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projectSet({
        home: Option.getOrUndefined(input.home),
        id: input.name,
        description: Option.getOrUndefined(input.description),
        baseRef: Option.getOrUndefined(input.base),
        mode: Option.getOrUndefined(input.mode),
        yolo: input.yolo ? true : input.noYolo ? false : undefined,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
      }),
    )
    print(`Project ${result.id} updated`)
  }),
)
export const projectDefault = Runtime.handler(
  Commands.commands.supervisor.commands.project.commands.default,
  Effect.fn("cli.supervisor.project.default")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projectDefault({ home: Option.getOrUndefined(input.home), id: input.name }),
    )
    print(`Default project: ${result.id}`)
  }),
)
export const projectArchive = Runtime.handler(
  Commands.commands.supervisor.commands.project.commands.archive,
  Effect.fn("cli.supervisor.project.archive")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projectArchive({ home: Option.getOrUndefined(input.home), id: input.name }),
    )
    print(`Project archived: ${result.id}`)
  }),
)
export const projectRestore = Runtime.handler(
  Commands.commands.supervisor.commands.project.commands.restore,
  Effect.fn("cli.supervisor.project.restore")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.projectRestore({ home: Option.getOrUndefined(input.home), id: input.name }),
    )
    print(`Project restored: ${result.id}`)
  }),
)
export const backlog = Runtime.handler(
  Commands.commands.supervisor.commands.backlog,
  Effect.fn("cli.supervisor.backlog")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.backlog({
        home: Option.getOrUndefined(input.home),
        project: Option.getOrUndefined(input.project),
        state: Option.getOrUndefined(input.status),
      }),
    )
    print(SupervisorFormat.backlog(result))
  }),
)
export const bearings = Runtime.handler(
  Commands.commands.supervisor.commands.bearings,
  Effect.fn("cli.supervisor.bearings")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.status({ home: Option.getOrUndefined(input.home) }),
    )
    print(SupervisorFormat.bearings(result))
  }),
)
export const hold = Runtime.handler(
  Commands.commands.supervisor.commands.hold,
  Effect.fn("cli.supervisor.hold")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.hold({
        home: Option.getOrUndefined(input.home),
        id: input.id,
        reason: input.reason,
        until: Option.getOrUndefined(input.until),
      }),
    )
    print(`Work ${result.id} held`)
  }),
)
export const release = Runtime.handler(
  Commands.commands.supervisor.commands.release,
  Effect.fn("cli.supervisor.release")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.release({ home: Option.getOrUndefined(input.home), id: input.id }),
    )
    print(`Work ${result.id} released`)
  }),
)
export const retry = Runtime.handler(
  Commands.commands.supervisor.commands.retry,
  Effect.fn("cli.supervisor.retry")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.retry({ home: Option.getOrUndefined(input.home), id: input.id }),
    )
    print(`Work ${result.id}: ${result.state}`)
  }),
)
export const dispatch = Runtime.handler(
  Commands.commands.supervisor.commands.dispatch,
  Effect.fn("cli.supervisor.dispatch")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.dispatch({ home: Option.getOrUndefined(input.home), id: input.id }),
    )
    print(`Dispatch requested: ${input.id}`)
  }),
)
export const interrupt = Runtime.handler(
  Commands.commands.supervisor.commands.interrupt,
  Effect.fn("cli.supervisor.interrupt")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.interrupt({ home: Option.getOrUndefined(input.home), task: input.id }),
    )
    print(`Interrupt requested: ${input.id}`)
  }),
)
export const resume = Runtime.handler(
  Commands.commands.supervisor.commands.resume,
  Effect.fn("cli.supervisor.resume")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.resume({
        home: Option.getOrUndefined(input.home),
        task: input.id,
        text: Option.getOrUndefined(input.message),
      }),
    )
    print(`Resume requested: ${input.id}`)
  }),
)

export const bridge = Runtime.handler(
  Commands.commands.supervisor.commands.bridge,
  Effect.fn("cli.supervisor.bridge")(function* (input) {
    const response = yield* Effect.promise(async () => {
      try {
        const request = Schema.decodeUnknownSync(Schema.Struct({ operation: SupervisorProtocol.Operation }))(
          JSON.parse(await Bun.stdin.text()),
        )
        return { result: await SupervisorClient.request(input.home, request.operation) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    print(JSON.stringify(response))
  }),
)

export const show = Runtime.handler(
  Commands.commands.supervisor.commands.show,
  Effect.fn("cli.supervisor.show")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.show({ home: Option.getOrUndefined(input.home), task: input.task }),
    )
    print(
      result.task
        ? SupervisorFormat.taskLine(result.task)
        : `${result.work!.id}  ${result.work!.state}  ${result.work!.kind}`,
    )
    if (result.delegation)
      print(`Delegate: ${result.delegation.delegateID} · handoff ${result.delegation.id} ${result.delegation.state}`)
    print(result.report ?? "No report yet")
  }),
)

export const steer = Runtime.handler(
  Commands.commands.supervisor.commands.steer,
  Effect.fn("cli.supervisor.steer")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.steer({
        home: Option.getOrUndefined(input.home),
        task: input.task,
        text: input.message,
        queue: input.queue,
      }),
    )
    print(`${input.queue ? "Queued" : "Sent"} guidance to ${input.task}`)
  }),
)

export const cancel = Runtime.handler(
  Commands.commands.supervisor.commands.cancel,
  Effect.fn("cli.supervisor.cancel")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.cancel({ home: Option.getOrUndefined(input.home), task: input.task }),
    )
    print(`Cancellation requested: ${input.task}`)
  }),
)

export const recover = Runtime.handler(
  Commands.commands.supervisor.commands.recover,
  Effect.fn("cli.supervisor.recover")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.recover({ home: Option.getOrUndefined(input.home), task: input.task }),
    )
    print(`Recovery requested: ${input.task}`)
    print(
      `Run: shuvcode supervisor status --task ${input.task}${SupervisorFormat.homeFlag(Option.getOrUndefined(input.home))}`,
    )
  }),
)

export const complete = Runtime.handler(
  Commands.commands.supervisor.commands.complete,
  Effect.fn("cli.supervisor.complete")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.complete({ home: Option.getOrUndefined(input.home), task: input.task }),
    )
    print(`Task complete: ${input.task}`)
  }),
)

export const cleanup = Runtime.handler(
  Commands.commands.supervisor.commands.cleanup,
  Effect.fn("cli.supervisor.cleanup")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.cleanup({ home: Option.getOrUndefined(input.home), task: input.task, landed: input.landed }),
    )
    print(`Task cleaned up: ${input.task}`)
  }),
)

export const decisions = Runtime.handler(
  Commands.commands.supervisor.commands.decisions,
  Effect.fn("cli.supervisor.decisions")(function* (input) {
    const task = Option.getOrUndefined(input.task)
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.status({ home: Option.getOrUndefined(input.home), task }),
    )
    if (task && !result.tasks.length) return yield* Effect.fail(new Error(`Unknown supervisor task: ${task}`))
    const lines = result.tasks.flatMap((task) =>
      task.decisions
        .filter((item) => item.resolution === undefined)
        .map((item) => SupervisorFormat.decision(task.id, item)),
    )
    print(lines.length ? lines.join(EOL) : "No open decisions")
  }),
)

export const answer = Runtime.handler(
  Commands.commands.supervisor.commands.answer,
  Effect.fn("cli.supervisor.answer")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.answer({
        home: Option.getOrUndefined(input.home),
        task: input.task,
        decision: input.decision,
        text: input.text,
      }),
    )
    print(`Decision answered: ${input.task}/${input.decision}`)
  }),
)

export const approve = Runtime.handler(
  Commands.commands.supervisor.commands.approve,
  Effect.fn("cli.supervisor.approve")(function* (input) {
    yield* Effect.tryPromise(() =>
      SupervisorOperator.approve({
        home: Option.getOrUndefined(input.home),
        task: input.task,
        request: input.request,
        deny: input.deny,
      }),
    )
    print(`${input.deny ? "Denied" : "Approved"} permission for ${input.task}`)
  }),
)

export const doctor = Runtime.handler(
  Commands.commands.supervisor.commands.doctor,
  Effect.fn("cli.supervisor.doctor")(function* (input) {
    const result = yield* Effect.tryPromise(() =>
      SupervisorOperator.doctor({ home: Option.getOrUndefined(input.home) }),
    )
    print(result.checks.map((item) => `${item.status}  ${item.name}${item.detail ? `: ${item.detail}` : ""}`).join(EOL))
  }),
)
