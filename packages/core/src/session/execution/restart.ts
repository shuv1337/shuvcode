export * as SessionRestart from "./restart.js"

import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../../bus.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"
import { SessionEvent } from "../event.js"
import { SessionExecution } from "../execution.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { ShellResult } from "../../shell/result.js"
import { SubagentCompletion } from "../subagent-completion.js"
import { SubagentJob } from "../subagent-job.js"
import { SubagentRecovery } from "../subagent-recovery.js"
import { SubagentTool } from "../../tool/plugin/subagent.js"
import { SessionMessage } from "../message.js"

const CONTINUE_AFTER_SERVER_RESTART =
  "The server restarted while you were working. Continue from where you left off without repeating completed work."

const RESUME_EXHAUSTED = {
  type: "aborted",
  message: "Execution was interrupted repeatedly and will not be resumed automatically.",
} as const

export interface Options {
  /**
   * Times a single turn may be resumed before it is terminalized instead.
   * The counter is durable and only a terminal event resets it, so a turn
   * that keeps dying cannot crash-loop across restarts. Turns that complete
   * never accumulate: the budget is per-turn, not per-session.
   */
  readonly maxAttempts?: number
}

const DEFAULT_MAX_ATTEMPTS = 10

export interface Interface {
  /**
   * Resumes Sessions whose execution claim was never released — turns orphaned
   * by a process that died without teardown, or interrupted by a graceful
   * shutdown (which preserves the claim on purpose). The claim is never
   * cleared here: only a terminal event releases it, so a death anywhere in
   * the resume path leaves the same orphaned claim for the next boot.
   */
  readonly resumeSuspendedSessions: Effect.Effect<void>
}

/**
 * Recovery for orphaned executions. Claims are written at turn start by
 * SessionExecution, so this sweep needs no cooperation from the previous
 * process: crash, SIGKILL, isolate eviction, and graceful restart all leave
 * the same durable signature.
 *
 * Recovery is at-least-once: local coordination prevents concurrent drains,
 * not repeated external side effects after a crash.
 *
 * The sweep assumes every orphaned claim's owner is dead. The managed-server
 * protocol guarantees this: a successor is only spawned after the previous
 * process is confirmed dead (client service `kill`/`evict` poll the PID), the
 * registration lock admits one managed server at a time, and unregistered
 * servers sharing the database never sweep. The service is inert until called
 * — the managed server invokes it at boot; embedders may call it from their
 * own start-up.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRestart") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const execution = yield* SessionExecution.Service
      const bus = yield* Bus.Service
      const jobs = yield* Job.Service
      const sessions = yield* Session.Service
      const subagents = yield* SubagentJob.make
      const scope = yield* Effect.scope
      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      const preparedInFlight = new Set<SessionSchema.ID>()

      const prepareResume = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        // Durable before the resume runs, so a crash inside the resumed turn is
        // counted by the next sweep and the budget cannot be dodged.
        const attempts = yield* store.countResume(sessionID)
        if (attempts === undefined) return false
        if (attempts > maxAttempts) {
          // Terminalize instead: the release hook clears the claim and resets the
          // counter atomically with the terminal event.
          yield* bus.publish(
            SessionEvent.Execution.Failed,
            { sessionID, error: RESUME_EXHAUSTED },
            { commit: () => store.release(sessionID) },
          )
          return false
        }
        yield* bus.publish(SessionEvent.Synthetic, {
          sessionID,
          text: CONTINUE_AFTER_SERVER_RESTART,
          description: "Continuing after restart",
          metadata: { notice: "restart" },
        })
        return true
      })

      const recoverShell = Effect.fnUntraced(function* (
        background: Job.Background,
        recovery: Extract<Job.Recovery, { kind: "shell" }>,
      ) {
        const state = background.status === "running" ? "cancelled" : background.status
        const text =
          background.status === "running"
            ? "Command cancelled because the server restarted"
            : state === "completed"
              ? (background.output ?? "Command completed")
              : state === "error"
                ? (background.error ?? "Command failed")
                : "Command cancelled"

        yield* sessions
          .synthetic({
            id: background.notificationID,
            sessionID: recovery.sessionID,
            description: recovery.command,
            ...ShellResult.notification({
              jobID: background.id,
              shellID: recovery.shellID,
              command: recovery.command,
              state,
              text,
            }),
            // Restart notices must not revive idle owners of long-lived shells.
            // Interrupted executions resume separately after their notices are admitted.
            resume: false,
          })
          .pipe(
            Effect.catchTag("Session.NotFoundError", () => Effect.void),
            Effect.orDie,
          )
        yield* jobs.completeBackground(background.notificationID)
      })

      const recoverSubagent = Effect.fnUntraced(function* (
        background: Job.Background,
        recovery: Extract<Job.Recovery, { kind: "subagent" }>,
        suspended: ReadonlySet<SessionSchema.ID>,
        ambiguous: ReadonlySet<SessionSchema.ID>,
      ) {
        const child = yield* store.get(recovery.childSessionID)
        if (!child || child.parentID !== recovery.parentSessionID || !(yield* store.get(recovery.parentSessionID))) {
          yield* jobs.completeBackground(background.notificationID)
          return
        }

        const notify = Effect.fnUntraced(function* (result: Pick<Job.Background, "status" | "output" | "error">) {
          yield* SubagentCompletion.deliver(sessions, jobs, {
            ...result,
            recovery,
            notificationID: background.notificationID,
            resume: suspended.has(recovery.parentSessionID) ? false : undefined,
          }).pipe(Effect.orDie)
        })

        if (background.status !== "running") {
          yield* notify(background)
          return
        }
        if (ambiguous.has(recovery.childSessionID)) {
          yield* notify({ status: "error", error: "Child tool outcome is ambiguous after restart" })
          return
        }
        if (yield* execution.isActive(recovery.childSessionID)) return
        if (!(yield* prepareResume(recovery.childSessionID))) {
          yield* notify({ status: "error", error: RESUME_EXHAUSTED.message })
          return
        }

        yield* jobs.start({
          id: background.id,
          type: "subagent",
          title: recovery.description,
          notificationID: background.notificationID,
          recovery,
          run: execution.resume(recovery.childSessionID).pipe(
            Effect.andThen(store.context(recovery.childSessionID)),
            Effect.map((messages) => {
              const assistant = messages.findLast(
                (message) =>
                  message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
              )
              return SubagentCompletion.text(assistant)
            }),
          ),
        })
        yield* jobs.background(background.id)
        yield* jobs.wait({ id: background.id }).pipe(
          Effect.flatMap((result) => (result.info ? notify(result.info) : Effect.void)),
          Effect.forkIn(scope),
        )
      })

      const recoverPreparedCall = Effect.fn("SessionRestart.recoverPreparedCall")(function* (
        sessionID: SessionSchema.ID,
        assistantMessageID: SessionMessage.ID,
        tool: SessionMessage.AssistantTool,
      ) {
        const operation = SubagentRecovery.prepared(tool)
        if (!operation) return
        const decoded = Schema.decodeUnknownOption(SubagentTool.Input)(tool.state.input)
        if (Option.isNone(decoded)) return yield* Effect.die(new Error(`Invalid prepared subagent input: ${tool.id}`))
        const input = decoded.value
        const previous = yield* store.get(operation.childSessionID)
        if (previous && previous.parentID !== sessionID)
          return yield* Effect.die(new Error(`Subagent child ownership mismatch: ${operation.childSessionID}`))
        if (!previous && input.sessionID)
          return yield* Effect.die(new Error(`Continued subagent child disappeared: ${input.sessionID}`))
        const child =
          previous ??
          (yield* sessions.create({
            id: operation.childSessionID,
            parentID: sessionID,
            title: input.description,
            agent: operation.agent,
            model: operation.model,
          }))
        const pending = previous && (yield* sessions.inbox(child.id)).find((item) => item.id === operation.inboxID)
        if (
          pending &&
          previous.outcome === "interrupted" &&
          (input.sessionID === undefined ||
            (previous.time.idle &&
              DateTime.toEpochMillis(previous.time.idle) >= DateTime.toEpochMillis(pending.time.created)))
        ) {
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID,
            id: tool.id,
            error: { type: "aborted", message: `Subagent cancelled before admission (sessionID: ${child.id})` },
            metadata: { sessionID: child.id },
            executed: false,
          })
          return false
        }
        yield* sessions.prompt({
          id: operation.inboxID,
          sessionID: child.id,
          text: input.sessionID
            ? input.prompt
            : ["You are a subagent spawned by another session.", input.prompt].join("\n"),
          resume: false,
        })
        const settled = yield* SubagentRecovery.settled(sessions, child.id, operation.inboxID)
        const recovery = {
          kind: "subagent" as const,
          parentSessionID: sessionID,
          childSessionID: child.id,
          agent: String(operation.agent),
          description: input.description,
        }
        if (
          !settled &&
          (yield* store.listSuspended()).includes(child.id) &&
          !(yield* execution.isActive(child.id)) &&
          (yield* jobs.get(child.id))?.status !== "running" &&
          !(yield* prepareResume(child.id))
        ) {
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID,
            id: tool.id,
            error: { type: "aborted", message: `Subagent restart limit reached (sessionID: ${child.id})` },
            metadata: { sessionID: child.id },
            executed: false,
          })
          return false
        }
        if (!settled && (yield* jobs.get(child.id))?.status !== "completed")
          yield* subagents.start(
            recovery,
            input.background === true ? SubagentRecovery.notificationID(operation) : undefined,
          )
        if (input.background === true) {
          if (settled)
            yield* SubagentCompletion.deliver(sessions, jobs, {
              status: settled.status === "succeeded" ? "completed" : settled.status === "interrupted" ? "cancelled" : "error",
              output: settled.output,
              error: settled.status,
              notificationID: SubagentRecovery.notificationID(operation),
              recovery,
              resume: false,
            })
          const output = SubagentTool.backgroundResult(child.id)
          yield* bus.publish(SessionEvent.Tool.Success, {
            sessionID,
            assistantMessageID,
            id: tool.id,
            content: [{ type: "text", text: output.output }],
            metadata: { sessionID: child.id, status: output.status },
            executed: false,
          })
          yield* subagents.background(recovery)
          return true
        }
        const result = settled ? undefined : yield* jobs.block({ id: child.id, sessionID })
        if (result?.type === "backgrounded") {
          yield* subagents.notify(recovery, result.info.started_at)
          const output = SubagentTool.backgroundResult(child.id)
          yield* bus.publish(SessionEvent.Tool.Success, {
            sessionID,
            assistantMessageID,
            id: tool.id,
            content: [{ type: "text", text: output.output }],
            metadata: { sessionID: child.id, status: output.status },
            executed: false,
          })
          return true
        }
        if (settled?.status === "succeeded" || result?.info.status === "completed") {
          const text = settled?.output ?? result?.info.output ?? SubagentCompletion.NO_TEXT
          yield* bus.publish(SessionEvent.Tool.Success, {
            sessionID,
            assistantMessageID,
            id: tool.id,
            content: [
              { type: "text", text: `<subagent sessionID="${child.id}" state="completed">\n${text}\n</subagent>` },
            ],
            metadata: { sessionID: child.id, status: "completed" },
            executed: false,
          })
          return true
        }
        yield* bus.publish(SessionEvent.Tool.Failed, {
          sessionID,
          assistantMessageID,
          id: tool.id,
          error: {
            type: "aborted",
            message: `Subagent ${settled?.status ?? result?.info.status ?? "missing"} (sessionID: ${child.id})`,
          },
          metadata: { sessionID: child.id },
          executed: false,
        })
        return settled?.status !== "interrupted" && settled?.status !== "failed" && result?.info.status !== "cancelled"
      })

      return Service.of({
        resumeSuspendedSessions: Effect.gen(function* () {
          const active = yield* execution.active
          const pending = yield* jobs.pendingBackground
          const children = pending.flatMap((background) =>
            background.status === "running" && background.recovery.kind === "subagent"
              ? [background.recovery.childSessionID]
              : [],
          )
          // Early notices wait for recovery's accounting, including Sessions that exhaust their budget.
          const suspended = new Set(
            [...(yield* store.listSuspended()), ...children].filter((sessionID) => !active.has(sessionID)),
          )
          const ambiguous = new Set<SessionSchema.ID>()
          const preparedChildren = new Set<SessionSchema.ID>()
          for (const sessionID of suspended) {
            const calls = (yield* store.context(sessionID).pipe(Effect.orDie)).flatMap((message) =>
              message.type === "assistant"
                ? message.content.flatMap((tool) =>
                    tool.type === "tool" && tool.state.status === "running" && tool.executed !== true
                      ? [{ messageID: message.id, tool }]
                      : [],
                  )
                : [],
            )
            if (!calls.some((call) => !SubagentRecovery.prepared(call.tool))) {
              for (const call of calls) {
                const operation = SubagentRecovery.prepared(call.tool)
                if (operation) preparedChildren.add(operation.childSessionID)
              }
              continue
            }
            ambiguous.add(sessionID)
            for (const call of calls) {
              const operation = SubagentRecovery.prepared(call.tool)
              yield* bus.publish(SessionEvent.Tool.Failed, {
                sessionID,
                assistantMessageID: call.messageID,
                id: call.tool.id,
                error: {
                  type: "aborted",
                  message: operation
                    ? `Subagent recovery stopped with an ambiguous sibling (sessionID: ${operation.childSessionID})`
                    : `Tool outcome is ambiguous after restart: ${call.tool.name}`,
                },
                metadata: operation
                  ? { sessionID: operation.childSessionID }
                  : call.tool.state.status === "running"
                    ? call.tool.state.metadata
                    : {},
                executed: call.tool.executed === true,
              })
            }
            yield* bus.publish(
              SessionEvent.Execution.Failed,
              {
                sessionID,
                error: { type: "aborted", message: "Execution stopped: a tool outcome is ambiguous after restart." },
              },
              { commit: () => store.release(sessionID) },
            )
          }
          yield* store.releaseChildClaims([...children, ...preparedChildren])
          yield* Effect.forEach(
            // Admit shell outcomes before a recovered child can start its first model request.
            pending.toSorted((a, b) => Number(a.recovery.kind === "subagent") - Number(b.recovery.kind === "subagent")),
            Effect.fnUntraced(function* (background) {
              if ((yield* jobs.get(background.id))?.status === "running") return
              const recovery = background.recovery
              yield* recovery.kind === "shell"
                ? recoverShell(background, recovery)
                : recoverSubagent(background, recovery, suspended, ambiguous)
            }),
            { discard: true },
          )

          const recovering = new Set<SessionSchema.ID>()
          for (const sessionID of yield* store.listSuspended()) {
            const calls = (yield* store.context(sessionID).pipe(Effect.orDie)).flatMap((message) =>
              message.type === "assistant"
                ? message.content.flatMap((tool) =>
                    tool.type === "tool" && SubagentRecovery.prepared(tool) ? [{ messageID: message.id, tool }] : [],
                  )
                : [],
            )
            if (calls.length === 0) continue
            if (preparedInFlight.has(sessionID)) continue
            preparedInFlight.add(sessionID)
            recovering.add(sessionID)
            for (const call of calls) {
              const operation = SubagentRecovery.prepared(call.tool)
              if (operation) recovering.add(operation.childSessionID)
            }
            yield* Effect.gen(function* () {
              if (!(yield* prepareResume(sessionID))) {
                for (const call of calls) {
                  const operation = SubagentRecovery.prepared(call.tool)
                  if (!operation) continue
                  yield* bus.publish(SessionEvent.Tool.Failed, {
                    sessionID,
                    assistantMessageID: call.messageID,
                    id: call.tool.id,
                    error: { type: "aborted", message: "Subagent recovery limit reached" },
                    metadata: { sessionID: operation.childSessionID },
                    executed: false,
                  })
                }
                return
              }
              for (const call of calls) {
                if (yield* recoverPreparedCall(sessionID, call.messageID, call.tool)) continue
                yield* bus.publish(
                  SessionEvent.Execution.Failed,
                  {
                    sessionID,
                    error: {
                      type: "aborted",
                      message: "Subagent recovery stopped; inspect the child before continuing.",
                    },
                  },
                  { commit: () => store.release(sessionID) },
                )
                return
              }
              yield* execution.resume(sessionID)
            }).pipe(
              Effect.catchCause((cause) => Effect.logError("Prepared subagent recovery stopped", { sessionID, cause })),
              Effect.ensuring(Effect.sync(() => preparedInFlight.delete(sessionID))),
              Effect.forkIn(scope),
            )
          }

          // Background completion can wake a parent, so inspect local ownership only after recovery.
          const resumed = yield* execution.active
          yield* Effect.forEach(
            (yield* store.listSuspended()).filter(
              (sessionID) => !resumed.has(sessionID) && !recovering.has(sessionID) && !preparedInFlight.has(sessionID),
            ),
            (sessionID) =>
              execution
                .resume(sessionID)
                .pipe(Effect.ignore, Effect.forkIn(scope), Effect.when(prepareResume(sessionID))),
            { concurrency: "unbounded", discard: true },
          )
          // Async observers consult this set at delivery; later completions wake parents normally.
          suspended.clear()
        }),
      })
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [SessionStore.node, SessionExecution.node, Bus.node, Job.node, Session.node],
})
