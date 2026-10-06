import { Schema } from "effect"
import { SupervisorDelivery } from "./delivery"
import type { SupervisorStore } from "./store"

export namespace SupervisorDeliveryRuntime {
  const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/))
  const Generation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  const Task = { taskID: ID }
  const Lead = { generation: Generation }
  export const Operation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("delivery.prepare"), ...Task, ...Lead }),
    Schema.Struct({
      type: Schema.Literal("delivery.publish"),
      ...Task,
      ...Lead,
      title: Schema.String,
      body: Schema.String,
    }),
    Schema.Struct({ type: Schema.Literal("delivery.approve"), ...Task, ...Lead, reference: Schema.String }),
    Schema.Struct({ type: Schema.Literal("delivery.land"), ...Task, ...Lead }),
    Schema.Struct({ type: Schema.Literal("delivery.cancel"), ...Task, ...Lead }),
    Schema.Struct({
      type: Schema.Literal("delivery.reconcile"),
      ...Task,
      ...Lead,
      prURL: Schema.optional(Schema.String),
    }),
    Schema.Struct({ type: Schema.Literal("delivery.cleanup"), ...Task, ...Lead }),
    Schema.Struct({
      type: Schema.Literal("validation.start"),
      ...Task,
      ...Lead,
      intent: Schema.String,
      validationGeneration: Schema.optional(Generation),
    }),
    Schema.Struct({
      type: Schema.Literal("validation.status"),
      ...Task,
      validationGeneration: Schema.optional(Generation),
    }),
    Schema.Struct({
      type: Schema.Literal("validation.abort"),
      ...Task,
      ...Lead,
      validationGeneration: Schema.optional(Generation),
    }),
    Schema.Struct({
      type: Schema.Literal("validation.respond"),
      ...Task,
      ...Lead,
      action: Schema.Literals(["approve", "fix", "skip"]),
      findingIDs: Schema.optional(Schema.Array(ID)),
      instructions: Schema.optional(Schema.String),
      userDecisionReference: Schema.optional(Schema.String),
      validationGeneration: Schema.optional(Generation),
    }),
  ])
  export type Operation = typeof Operation.Type
  export type Actor = { operator: true } | { sessionID: string }
  export type Store = ReturnType<typeof SupervisorStore.open>
  export type Input = {
    store: Store
    authorize: (actor: Actor, generation: number) => SupervisorStore.Authority
    quiet: (task: SupervisorStore.Task) => Promise<{ outcome: "succeeded" | "failed" | "interrupted" | undefined }>
    complete: (task: SupervisorStore.Task, authority: SupervisorStore.Authority) => void | Promise<void>
    cleanup: (
      task: SupervisorStore.Task,
      landing: SupervisorDelivery.Landing,
      beforeMutate?: () => void,
    ) => unknown | Promise<unknown>
    runGh?: SupervisorDelivery.GhRunner
  }

  export function open(input: Input) {
    function requireTask(id: string) {
      const task = input.store.task(id)
      if (!task || task.kind !== "ship") throw new Error(`Unknown ship task: ${id}`)
      return task
    }

    function requireRecord(id: string) {
      const record = input.store.deliveries.get(id)
      if (!record) throw new Error(`Delivery has not been prepared: ${id}`)
      return record
    }

    function requireNotCancelledWork(id: string) {
      if (input.store.backlog.list().some((item) => item.taskID === id && item.state === "cancelled"))
        throw new Error(`Cancelled work cannot proceed with delivery: ${id}`)
    }

    async function prepare(id: string, authority: SupervisorStore.Authority, beforeMutate: () => void) {
      const task = requireTask(id)
      requireNotCancelledWork(id)
      const existing = input.store.deliveries.get(id)
      if (existing) return existing
      if (task.admissionUncertain) throw new Error("Native admission is uncertain")
      const quiet = await input.quiet(task)
      if (quiet.outcome !== "succeeded") throw new Error("Native task has not succeeded and quiesced")
      beforeMutate()
      await input.complete(task, authority)
      const completed = requireTask(id)
      if (
        completed.status !== "completed" ||
        completed.admissionUncertain ||
        !input.store.receipts(id).some((receipt) => receipt.kind === "ship")
      )
        throw new Error("Delivery requires a completed task and accepted ship receipt")
      const work = input.store.backlog.list().find((item) => item.taskID === id)
      if (!work) throw new Error(`No intake policy is bound to task ${id}`)
      const targetRef = `refs/heads/${completed.baseRef.replace(/^origin\//, "").replace(/^refs\/heads\//, "")}`
      const state = await SupervisorDelivery.inspect({ task: completed, targetRef })
      beforeMutate()
      const record: SupervisorDelivery.Record = {
        taskID: id,
        mode: work.deliveryMode,
        mergePolicy: work.mergePolicy,
        policyProvenance: work.policyProvenance ?? {
          source: "registry",
          reference: `work:${work.id}:legacy-intake`,
          capturedAt: new Date(work.createdAt).toISOString(),
        },
        status: "pending",
        targetRef,
        sourceHead: state.sourceHead,
        targetHead: state.targetHead,
      }
      if (
        record.mode !== work.deliveryMode ||
        record.mergePolicy !== work.mergePolicy ||
        record.targetRef !== targetRef
      )
        throw new Error("Delivery policy differs from immutable work intake")
      return input.store.deliveries.record(record)
    }

    async function refresh(id: string) {
      const task = requireTask(id)
      const record = requireRecord(id)
      if (record.status === "landed" || record.status === "cancelled") return record
      const state = await SupervisorDelivery.inspect({ task, targetRef: record.targetRef })
      if (record.blocker === "landing_outcome_unknown")
        throw new Error("Landing outcome requires operator reconciliation")
      const validation = record.mode === "no-mistakes" ? await input.store.validations.status(id) : undefined
      if (validation && validation.state === "unknown")
        throw new Error("Validation outcome is unknown; operator inspection required")
      if (validation?.head && validation.head !== state.sourceHead)
        throw new Error("Validated source differs from current task HEAD")
      if (
        record.sourceHead !== state.sourceHead &&
        !(validation?.state === "passed" && validation.headChain.includes(state.sourceHead))
      )
        throw new Error("Source HEAD changed outside a trusted validation chain")
      const sourceHead = state.sourceHead
      const prURL = record.mode === "no-mistakes" ? validation?.pr : record.pr?.url
      const pr = prURL
        ? await SupervisorDelivery.readPR({ project: task.project, url: prURL, runGh: input.runGh })
        : undefined
      const checks =
        pr?.state === "OPEN"
          ? await SupervisorDelivery.readChecks({ project: task.project, pr, runGh: input.runGh })
          : undefined
      const next: SupervisorDelivery.Record = {
        ...record,
        sourceHead,
        targetHead: state.targetHead,
        pr,
        checks,
        validation: record.mode === "no-mistakes" ? input.store.validations.validation(id) : undefined,
        approval:
          record.approval?.sourceHead === sourceHead && record.approval.targetHead === state.targetHead
            ? record.approval
            : undefined,
        blocker:
          (record.blocker === "publish_outcome_unknown" && !pr) ||
          ["cancellation_outcome_unknown", "close_outcome_unknown"].includes(record.blocker ?? "")
            ? record.blocker
            : undefined,
        status:
          (record.blocker === "publish_outcome_unknown" && !pr) ||
          ["cancellation_outcome_unknown", "close_outcome_unknown"].includes(record.blocker ?? "")
            ? "blocked"
            : "pending",
      }
      if (pr && (pr.head !== sourceHead || pr.base !== record.targetRef.slice(11)))
        throw new Error("PR identity or source differs from prepared delivery")
      if (pr && pr.baseHead !== state.targetHead) next.blocker = "pr_base_changed"
      const gate = SupervisorDelivery.assess(next)
      return input.store.deliveries.record({
        ...next,
        status: gate.ready ? "ready" : next.blocker ? "blocked" : "pending",
      })
    }

    async function request(actor: Actor, operation: Operation) {
      const op = Schema.decodeUnknownSync(Operation)(operation)
      if (op.type === "validation.status") {
        if (!("operator" in actor)) input.authorize(actor, input.store.lead()?.generation ?? -1)
        return input.store.validations.status(op.taskID, op.validationGeneration)
      }
      if (op.type !== "delivery.cancel") requireNotCancelledWork(op.taskID)
      const authority = input.authorize(actor, op.generation)
      const beforeMutate = () => {
        input.authorize(actor, op.generation)
        if (op.type !== "delivery.cancel") requireNotCancelledWork(op.taskID)
      }
      if (op.type === "delivery.prepare") return prepare(op.taskID, authority, beforeMutate)
      if (op.type === "validation.start") {
        const task = requireTask(op.taskID)
        const record = requireRecord(op.taskID)
        if (
          record.mode !== "no-mistakes" ||
          ["landed", "cancelled"].includes(record.status) ||
          ["cancellation_outcome_unknown", "close_outcome_unknown"].includes(record.blocker ?? "")
        )
          throw new Error("Wrong validation mode")
        const origin = await git(task.project, ["remote", "get-url", "origin"])
        return input.store.validations.start({
          taskID: task.id,
          generation: op.validationGeneration ?? 1,
          worktree: task.worktree,
          origin,
          submittedHead: record.sourceHead!,
          intent: op.intent,
          baseBranch: record.targetRef.slice(11),
          beforeMutate,
        })
      }
      if (op.type === "validation.abort") {
        return input.store.validations.abort(op.taskID, op.validationGeneration, beforeMutate)
      }
      if (op.type === "validation.respond") {
        if (!("operator" in actor)) throw new Error("Validation decisions require the operator")
        const record = requireRecord(op.taskID)
        if (
          record.mode !== "no-mistakes" ||
          record.status === "cancelled" ||
          ["cancellation_outcome_unknown", "close_outcome_unknown"].includes(record.blocker ?? "")
        )
          throw new Error("Wrong validation mode")
        return input.store.validations.respond({
          taskID: op.taskID,
          generation: op.validationGeneration,
          action: op.action,
          findingIDs: op.findingIDs ? [...op.findingIDs] : undefined,
          instructions: op.instructions,
          userDecisionReference: op.userDecisionReference,
          beforeMutate,
        })
      }
      if (op.type === "delivery.cancel") {
        const task = requireTask(op.taskID)
        const record = requireRecord(op.taskID)
        if (record.status === "cancelled") return record
        if (record.status === "landed") throw new Error("A landed delivery cannot be cancelled")
        if (["publish_outcome_unknown", "landing_outcome_unknown"].includes(record.blocker ?? ""))
          throw new Error("Reconcile the earlier external side effect before cancelling")
        const validation = record.mode === "no-mistakes" ? input.store.validations.get(op.taskID) : undefined
        if (validation && !validation.runID) {
          input.store.deliveries.record({ ...record, status: "blocked", blocker: "cancellation_outcome_unknown" })
          throw new Error("Validation launch has no proven run ID; cancellation outcome is unknown")
        }
        if (validation && !["passed", "failed"].includes(validation.state))
          input.store.deliveries.record({ ...record, status: "blocked", blocker: "cancellation_outcome_unknown" })
        const terminal = validation
          ? await input.store.validations.abort(op.taskID, validation.generation, beforeMutate)
          : undefined
        if (terminal && !["passed", "failed"].includes(terminal.state))
          throw new Error("Validation cancellation has no confirmed terminal outcome")
        const prURL = record.pr?.url ?? terminal?.pr
        const observedPR = prURL
          ? await SupervisorDelivery.readPR({ project: task.project, url: prURL, runGh: input.runGh })
          : undefined
        const sourceState = observedPR
          ? await SupervisorDelivery.inspect({ task, targetRef: record.targetRef })
          : undefined
        const sourceHead =
          terminal?.head && terminal.headChain.includes(terminal.head) ? terminal.head : record.sourceHead
        if (
          observedPR &&
          (observedPR.head !== sourceHead ||
            sourceState?.sourceHead !== sourceHead ||
            observedPR.headBranch !== task.branch ||
            observedPR.base !== record.targetRef.slice("refs/heads/".length) ||
            (record.pr &&
              (observedPR.url !== record.pr.url ||
                observedPR.repo !== record.pr.repo ||
                observedPR.number !== record.pr.number ||
                (record.mode !== "no-mistakes" && observedPR.head !== record.pr.head))))
        )
          throw new Error("Cancellation PR branch, repository, or exact HEAD changed")
        if (observedPR?.state === "MERGED") throw new Error("PR has merged; reconcile landing instead of cancelling")
        if (observedPR?.state === "OPEN") beforeMutate()
        const closeRecord =
          observedPR?.state === "OPEN"
            ? input.store.deliveries.record({
                ...record,
                status: "blocked",
                blocker: "close_outcome_unknown",
                sourceHead,
                pr: observedPR,
              })
            : undefined
        const closedPR = closeRecord
          ? await SupervisorDelivery.closePR({ task, record: closeRecord, runGh: input.runGh, beforeMutate })
          : observedPR
        if (closedPR && closedPR.state !== "CLOSED") throw new Error("PR close has no confirmed CLOSED proof")
        beforeMutate()
        return input.store.deliveries.record({
          ...record,
          status: "cancelled",
          blocker: undefined,
          sourceHead,
          pr: closedPR,
          cancellation: {
            source: "operator" in actor ? "operator" : "lead",
            at: new Date().toISOString(),
            validationRunID: terminal?.runID,
            validationOutcome: terminal?.outcome,
            prURL: closedPR?.url,
            prState: closedPR ? "CLOSED" : undefined,
          },
        })
      }
      if (op.type === "delivery.publish") {
        const task = requireTask(op.taskID)
        const record = requireRecord(op.taskID)
        if (record.status === "landed") return record
        if (
          record.status === "cancelled" ||
          ["cancellation_outcome_unknown", "close_outcome_unknown"].includes(record.blocker ?? "")
        )
          throw new Error("Cancelled or uncertain cancellation cannot publish")
        if (record.mode === "no-mistakes") return refresh(task.id)
        if (record.mode !== "direct-PR") throw new Error("Local-only delivery cannot publish a PR")
        // Persist an uncertain state before the first external side effect. A crash cannot silently resubmit.
        if (record.blocker === "publish_outcome_unknown" && !("operator" in actor))
          throw new Error("Prior publish outcome needs operator reconciliation")
        if (record.blocker !== "publish_outcome_unknown")
          input.store.deliveries.record({ ...record, status: "blocked", blocker: "publish_outcome_unknown" })
        const pr = await SupervisorDelivery.publish({
          task,
          record,
          title: op.title,
          body: op.body,
          inspectOnly: record.blocker === "publish_outcome_unknown",
          runGh: input.runGh,
          beforeMutate,
        })
        beforeMutate()
        input.store.deliveries.record({ ...record, status: "pending", blocker: undefined, pr })
        return refresh(task.id)
      }
      if (op.type === "delivery.approve") {
        if (!("operator" in actor)) throw new Error("Manual merge approval requires the operator")
        const record = requireRecord(op.taskID)
        if (record.mergePolicy !== "manual" || !record.sourceHead || !record.targetHead || !op.reference.trim())
          throw new Error("Exact-head manual approval requires a reference")
        const state = await SupervisorDelivery.inspect({ task: requireTask(op.taskID), targetRef: record.targetRef })
        if (state.sourceHead !== record.sourceHead || state.targetHead !== record.targetHead)
          throw new Error("Source or target moved before approval")
        beforeMutate()
        input.store.deliveries.record({
          ...record,
          approval: {
            source: "captain",
            reference: op.reference,
            approvedAt: new Date().toISOString(),
            sourceHead: state.sourceHead,
            targetHead: state.targetHead,
          },
        })
        return refresh(op.taskID)
      }
      if (op.type === "delivery.reconcile") {
        if (!("operator" in actor)) throw new Error("Delivery reconciliation requires the operator")
        const task = requireTask(op.taskID)
        const record = requireRecord(op.taskID)
        if (record.status === "landed") return record
        if (
          record.status === "cancelled" ||
          ["cancellation_outcome_unknown", "close_outcome_unknown"].includes(record.blocker ?? "")
        )
          throw new Error("Cancelled or uncertain cancellation cannot reconcile for publication")
        if (record.blocker === "publish_outcome_unknown") {
          const pr = await SupervisorDelivery.publish({
            task,
            record,
            title: "chore: reconcile",
            body: "",
            inspectOnly: true,
            runGh: input.runGh,
            beforeMutate,
          })
          if (op.prURL && op.prURL !== pr.url) throw new Error("Reconciled PR differs from operator reference")
          beforeMutate()
          input.store.deliveries.record({ ...record, status: "pending", blocker: undefined, pr })
          return refresh(task.id)
        }
        if (record.blocker !== "landing_outcome_unknown")
          throw new Error("No uncertain delivery side effect to reconcile")
        const landing = await reconcileLanding(task, record, input.runGh)
        beforeMutate()
        return input.store.deliveries.record({ ...record, status: "landed", blocker: undefined, landing })
      }
      if (op.type === "delivery.land") {
        const task = requireTask(op.taskID)
        const record = await refresh(op.taskID)
        if (record.status === "landed") return record
        if (
          record.status === "cancelled" ||
          ["cancellation_outcome_unknown", "close_outcome_unknown"].includes(record.blocker ?? "")
        )
          throw new Error("Cancelled or uncertain cancellation cannot land")
        if (record.status !== "ready")
          throw new Error(
            `Delivery is not ready: ${SupervisorDelivery.assess(record).ready ? record.status : JSON.stringify(SupervisorDelivery.assess(record))}`,
          )
        beforeMutate()
        input.store.deliveries.record({ ...record, status: "blocked", blocker: "landing_outcome_unknown" })
        const landing =
          record.mode === "local-only"
            ? await SupervisorDelivery.landLocal({ task, record, beforeMutate })
            : await SupervisorDelivery.landPR({ task, record, runGh: input.runGh, beforeMutate })
        return input.store.deliveries.record({ ...record, status: "landed", blocker: undefined, landing })
      }
      if (op.type === "delivery.cleanup") {
        const task = requireTask(op.taskID)
        const previous = input.store.cleanup(task.id)
        if (previous) return previous
        const record = requireRecord(op.taskID)
        const landing = await SupervisorDelivery.verifyCleanup({ task, record, runGh: input.runGh })
        beforeMutate()
        return input.cleanup(task, landing, beforeMutate)
      }
      throw new Error("Unsupported delivery operation")
    }
    return { request, prepare, refresh }
  }
}

async function reconcileLanding(
  task: SupervisorStore.Task,
  record: SupervisorDelivery.Record,
  runGh?: SupervisorDelivery.GhRunner,
): Promise<SupervisorDelivery.Landing> {
  if (
    !record.sourceHead ||
    !record.targetHead ||
    SupervisorDelivery.assess({ ...record, blocker: undefined }).ready !== true
  )
    throw new Error("Uncertain landing has no prior exact-head ready gate")
  const state = await SupervisorDelivery.inspect({ task, targetRef: record.targetRef })
  if (state.sourceHead !== record.sourceHead) throw new Error("Landing source changed")
  if (record.mode === "local-only") {
    if (
      !(await gitIsAncestor(state.project, record.targetHead, record.sourceHead)) ||
      !(await gitIsAncestor(state.project, record.sourceHead, state.targetHead))
    )
      throw new Error("Local target does not prove the exact task HEAD landed")
    return {
      kind: "local",
      sourceHead: record.sourceHead,
      targetHead: record.targetHead,
      mergeCommit: record.sourceHead,
    }
  }
  if (!record.pr) throw new Error("Uncertain PR landing has no saved PR identity")
  const pr = await SupervisorDelivery.readPR({ project: task.project, url: record.pr.url, runGh })
  if (
    pr.state !== "MERGED" ||
    pr.head !== record.sourceHead ||
    pr.url !== record.pr.url ||
    pr.repo !== record.pr.repo ||
    pr.number !== record.pr.number ||
    !pr.mergeCommit
  )
    throw new Error("Forge does not prove the exact submitted task HEAD merged")
  return { kind: "pr", sourceHead: record.sourceHead, targetHead: record.targetHead, mergeCommit: pr.mergeCommit }
}

async function gitIsAncestor(cwd: string, older: string, newer: string) {
  const child = Bun.spawn(["git", "-C", cwd, "merge-base", "--is-ancestor", older, newer], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code > 1) throw new Error(`Git ancestry failed: ${stderr.trim()}`)
  return code === 0
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`)
  return stdout.trim()
}
