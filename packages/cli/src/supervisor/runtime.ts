import { isSessionNotFoundError } from "@opencode/client"
import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Schema } from "effect"
import { SupervisorBacklog } from "./backlog"
import { SupervisorAway } from "./away"
import { SupervisorChannels } from "./channels"
import { SupervisorChannelsRuntime } from "./channels-runtime"
import { SupervisorDeliveryRuntime } from "./delivery-runtime"
import { SupervisorDelegatesRuntime } from "./delegates-runtime"
import { SupervisorKnowledge } from "./knowledge"
import { SupervisorNative } from "./native"
import { SupervisorProjects } from "./projects"
import { SupervisorPresentation } from "./presentation"
import { SupervisorProtocol } from "./protocol"
import { SupervisorSettings } from "./settings"
import { SupervisorStore } from "./store"
import { SupervisorWorktree } from "./worktree"
import { SupervisorVoice } from "./voice"

export namespace SupervisorRuntime {
  export async function open(input: {
    home: string
    endpoint: string
    native: ReturnType<typeof SupervisorNative.connect>
    managed?: { epoch: number; pilotID: string }
  }) {
    const store = SupervisorStore.open(input.home, input.managed)
    const home = await realpath(input.home)
    try {
      store.bindServer(new URL(input.endpoint).toString())
    } catch (error) {
      store.close()
      throw error
    }
    const native = input.native
    const defaults = (await Bun.file(path.join(home, "settings.json")).exists())
      ? await SupervisorSettings.read(home)
      : undefined
    const permissionDefaults: SupervisorStore.Task["permissions"] = defaults
      ? SupervisorSettings.permissions(defaults)
      : [{ action: "*", resource: "*", effect: "ask" }]
    if (defaults && defaults.registerProject !== false && !store.projects.default()) {
      store.projects.add(
        await SupervisorProjects.prepare({
          path: defaults.project,
          baseRef: defaults.baseRef,
          model: defaults.model,
          agent: defaults.agent,
          permissions: SupervisorSettings.permissions(defaults),
        }),
      )
    }
    for (const current of store.tasks()) {
      if (store.backlog.list().some((item) => item.taskID === current.id)) continue
      const registered = store.projects.list({ includeArchived: true }).find((item) => item.path === current.project)
      const project =
        registered ??
        store.projects.add(
          await SupervisorProjects.prepare({
            id: `project-${createHash("sha256").update(current.project).digest("hex").slice(0, 12)}`,
            path: current.project,
            baseRef: current.baseRef,
            model: current.model,
            agent: current.agent,
            permissions: current.permissions,
          }),
        )
      store.backlog.enqueue({
        id: current.id,
        projectID: project.id,
        kind: current.kind,
        brief: current.brief,
        deliveryMode: "local-only",
        mergePolicy: "manual",
        classification: "Approved pilot execution; delivery authority unchanged",
        overrides: {
          baseRef: current.baseRef,
          model: current.model,
          agent: current.agent,
          permissions: current.permissions,
        },
      })
      store.backlog.markStarted({ id: current.id, taskID: current.id })
      if (current.status === "completed" && current.kind === "scout") store.backlog.finish(current.id)
      if (current.status === "cancelled") store.backlog.settleCancelled(current.id)
    }
    const tails = new Map<string, Promise<void>>()
    let closed = false
    let maintenanceAt = 0
    let channelAt = 0
    const maintenanceWarnings = new Map<string, string>()
    const away = store.away({
      isLead: (sessionID) => store.lead()?.active === true && store.lead()?.sessionID === sessionID,
      isInternal: (messageID) => store.isNotice(messageID),
      snapshot: returnEvidence,
      validateClassification(input) {
        if (input.kind === "external-wait") return Boolean(input.reason.trim() && input.reference.trim())
        return store
          .tasks()
          .some((task) =>
            store
              .decisions(task.id)
              .some(
                (decision) =>
                  input.reference === `${task.id}/${decision.id}` &&
                  decision.resolution === undefined &&
                  Schema.is(Schema.Struct({ requiredAuthority: Schema.Literal("user") }))(decision.payload),
              ),
          )
      },
    })
    away.reopened()
    const voice = SupervisorVoice.open({ home, store })
    const knowledge = SupervisorKnowledge.open({ store, home })
    const channels = SupervisorChannelsRuntime.open({
      store: store.channels,
      lead: () => store.lead(),
      home,
      native,
      away: () => away.get().enabled,
      workBinding(binding) {
        const work = store.backlog.get(binding.workID)
        if (!work || (binding.taskID ? work.taskID !== binding.taskID : work.delegatedHandoffID !== binding.handoffID))
          return
        return { outcome: work.state === "done" ? "succeeded" : work.state === "cancelled" ? "cancelled" : undefined }
      },
      workerScope(sessionID) {
        const current = store.tasks().find((item) => item.sessionID === sessionID)
        return current ? { taskID: current.id, projectID: workForTask(current.id)?.projectID } : undefined
      },
      notify(notice) {
        const note = store.channels.inbox
          .list()
          .find((item) => notice.key === `channel-inbox:${item.id}` && item.trusted && item.source !== "relay")
        const lead = store.lead()
        const text =
          note && lead?.active
            ? away.admit({ sessionID: lead.sessionID, messageID: note.id, text: note.text }).text
            : notice.text
        store.enqueueNotice({ key: notice.key, payload: { text, delivery: "steer" } })
      },
    })
    const delivery = SupervisorDeliveryRuntime.open({
      store,
      authorize: authority,
      async quiet(current) {
        return { outcome: (await quiet(current)).outcome }
      },
      async complete(current, lead) {
        const receipt = store.receipts(current.id).at(-1)
        if (!receipt) throw new Error("Task has no verified receipt")
        await SupervisorWorktree.verify({
          task: current,
          receipt: Schema.decodeUnknownSync(SupervisorProtocol.Evidence)(receipt.evidence),
        })
        if (current.status !== "completed") store.completeTask({ authority: lead, taskID: current.id })
      },
      async cleanup(current, landing, beforeMutate) {
        const work = workForTask(current.id)
        if (work) channels.assertTeardownAllowed({ workID: work.id, taskID: current.id })
        const previous = store.cleanup(current.id)
        if (previous) return previous
        if (current.admissionUncertain) throw new Error("Cleanup blocked by an unknown earlier admission")
        await quiet(current)
        const receipt = await SupervisorWorktree.cleanupLanded(current, { ...landing, beforeMutate })
        store.recordCleanup({ taskID: current.id, evidence: receipt })
        return receipt
      },
    })
    const delegates = SupervisorDelegatesRuntime.open({
      store,
      home,
      syncShared: knowledge.sync,
      authorize(actor, generation) {
        const current = store.lead()
        authority(actor, generation ?? current?.generation ?? -1)
      },
      async cancelWork(id) {
        const item = store.backlog.get(id)
        await serial(
          () => cancelWork(id, authority({ operator: true }, store.lead()?.generation ?? -1)),
          item?.taskID ? `task:${item.taskID}` : `work:${id}`,
        )
      },
    })

    function serial<A>(run: () => Promise<A>, key = "home"): Promise<A> {
      if (closed) return Promise.reject(new Error("Supervisor is closed"))
      const result = (tails.get(key) ?? Promise.resolve()).then(run)
      const tail = result.then(
        () => {},
        () => {},
      )
      tails.set(key, tail)
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
      })
      return result
    }

    function operationKey(operation: SupervisorProtocol.Operation) {
      if (operation.type.startsWith("knowledge.")) return "knowledge"
      if (Schema.is(SupervisorAway.Operation)(operation)) return "away"
      if (Schema.is(SupervisorVoice.Operation)(operation)) return "channels"
      if ("taskID" in operation && operation.taskID) return `task:${operation.taskID}`
      if (operation.type.startsWith("work.") && "id" in operation && operation.id) {
        const current = store.backlog.get(operation.id)
        return current?.taskID ? `task:${current.taskID}` : `work:${operation.id}`
      }
      if (operation.type === "status" || operation.type === "project.list" || operation.type === "presentation")
        return "view"
      if (operation.type.startsWith("delegate.") || operation.type.startsWith("handoff.")) return "delegates"
      if (Schema.is(SupervisorChannels.Operation)(operation)) return "channels"
      return "home"
    }

    function authority(actor: SupervisorProtocol.Actor, generation: number) {
      const lead = store.lead()
      if (
        !lead?.active ||
        lead.generation !== generation ||
        (!("operator" in actor) && actor.sessionID !== lead.sessionID)
      )
        throw new Error("Supervisor lead authority is stale or revoked")
      return { sessionID: lead.sessionID, generation }
    }

    function task(id: string) {
      const found = store.task(id)
      if (!found) throw new Error(`Unknown supervisor task: ${id}`)
      return found
    }

    function requireInheritedPermissions(
      actor: SupervisorProtocol.Actor,
      requested: readonly SupervisorProjects.Permission[] | undefined,
      inherited: readonly SupervisorProjects.Permission[],
    ) {
      if ("operator" in actor || requested === undefined || isDeepStrictEqual(requested, inherited)) return
      throw new Error(
        "Changing worker permissions requires the operator; omit permissions to inherit the approved policy",
      )
    }

    function workForTask(id: string) {
      return store.backlog.list().find((item) => item.taskID === id)
    }

    function settleDelivery(id: string) {
      const work = workForTask(id)
      if (!work) return
      const record = store.deliveries.get(id)
      if (record?.status === "landed" && record.landing) store.backlog.finishLanded(work.id, record.landing)
      if (record?.status === "cancelled" && work.state === "in-flight") store.backlog.settleCancelled(work.id)
    }

    function projectForWork(item: SupervisorBacklog.WorkItem) {
      const project = store.projects.get(item.projectID)
      if (!project || project.archived) throw new Error(`Project is unavailable for new work: ${item.projectID}`)
      return project
    }

    function returnEvidence(startedAt?: number): SupervisorAway.ReturnEvidence {
      const tasks = store.tasks()
      const work = store.backlog.list()
      const errors = tasks
        .filter((task) => task.status === "active" || task.status === "cancelling")
        .filter((task) => task.error || task.admissionUncertain)
      return {
        health: [
          store.lead()?.active ? "Supervisor lead active" : "Supervisor lead unavailable",
          ...maintenanceWarnings.values(),
        ],
        blockers: [
          ...errors.map((task) => ({ id: task.id, reason: task.error ?? "Native admission is uncertain" })),
          ...[...maintenanceWarnings.entries()].map(([id, reason]) => ({ id: `maintenance:${id}`, reason })),
        ],
        waiting: tasks.flatMap((task) =>
          store
            .decisions(task.id)
            .filter(
              (decision) =>
                decision.resolution === undefined &&
                Schema.is(Schema.Struct({ requiredAuthority: Schema.Literal("user") }))(decision.payload),
            )
            .map((decision) => `${task.id}/${decision.id}`),
        ),
        failed: tasks
          .filter((task) => task.executionOutcome === "failed")
          .map((task) => `${task.id}: ${task.error ?? "Native execution failed"}`),
        handled: work
          .filter(
            (item) =>
              (item.state === "done" || item.state === "cancelled") &&
              (startedAt === undefined || item.updatedAt >= startedAt),
          )
          .map((item) => `${item.id}: ${item.state}${item.landed ? "; landed" : ""}`),
        cost: [
          `${work.filter((item) => item.state === "in-flight").length} work items in flight; ${tasks.reduce((sum, task) => sum + store.receipts(task.id).length, 0)} lifetime verified results; provider cost is not measured`,
        ],
      }
    }

    function occupiedResources() {
      return store.backlog.list({ state: "in-flight" }).flatMap((item) => item.resources)
    }

    async function cancelWork(id: string, lead: SupervisorStore.Authority) {
      const current = store.backlog.get(id)
      if (!current) throw new Error(`Unknown supervisor work item: ${id}`)
      if (current.delegatedHandoffID) throw new Error("Delegated work must be cancelled through its handoff")
      if (current.state === "queued") return store.backlog.cancel(id)
      if (current.state === "cancelled") return current
      if (current.state === "done") throw new Error("Completed work cannot be cancelled")
      if (!current.taskID) throw new Error("Work has no execution to cancel")
      const execution = task(current.taskID)
      if (execution.status === "completed") {
        if (store.deliveries.get(execution.id))
          await delivery.request(
            { operator: true },
            { type: "delivery.cancel", generation: lead.generation, taskID: execution.id },
          )
        return store.backlog.settleCancelled(id)
      }
      if (execution.status === "cancelled") return store.backlog.settleCancelled(id)
      store.cancelTask({ authority: lead, taskID: execution.id })
      await observe(execution.id).catch((error) =>
        store.noteFailure({ taskID: execution.id, message: error instanceof Error ? error.message : String(error) }),
      )
      if (task(execution.id).status === "cancelled") store.backlog.settleCancelled(id)
      return store.backlog.get(id)!
    }

    async function startWork(id: string, lead: SupervisorStore.Authority) {
      knowledge.guard()
      const item = store.backlog.get(id)
      if (!item) throw new Error(`Unknown supervisor work item: ${id}`)
      const readiness = store.backlog.readiness(id, { occupiedResources: occupiedResources() })
      if (!readiness.eligible) throw new Error(`Work is not ready: ${readiness.reasons.join("; ")}`)
      const project = projectForWork(item)
      const model = item.overrides.model ?? project.model ?? defaults?.model
      if (!model) throw new Error(`Choose a worker model for project ${project.id}`)
      const taskID = item.attempt === 1 ? item.id : `${item.id.slice(0, 65)}-attempt-${item.attempt}`
      const plan = await SupervisorWorktree.propose({
        home,
        taskID,
        project: project.path,
        baseRef: item.overrides.baseRef ?? project.baseRef,
        kind: item.kind,
      })
      const digest = createHash("sha256").update(`${home}\0${taskID}`).digest("hex")
      return store.backlog.dispatch(id, () => {
        const ready = store.backlog.readiness(id, { occupiedResources: occupiedResources() })
        if (!ready.eligible) throw new Error(`Work is not ready: ${ready.reasons.join("; ")}`)
        store.createTask({
          authority: lead,
          messageID: `msg_${digest}_initial`,
          task: {
            id: taskID,
            kind: item.kind,
            project: plan.project,
            worktree: plan.worktree,
            branch: plan.branch,
            baseRef: plan.baseRef,
            baseCommit: plan.baseCommit,
            sessionID: `ses_${digest}`,
            brief: item.brief,
            model,
            agent: item.overrides.agent ?? project.agent ?? defaults?.agent ?? "build",
            permissions:
              item.overrides.permissions ??
              project.permissions ??
              (defaults ? SupervisorSettings.permissions(defaults) : [{ action: "*", resource: "*", effect: "ask" }]),
          },
        })
        return taskID
      })
    }

    function worker(actor: SupervisorProtocol.Actor, current: SupervisorStore.Task) {
      if (!("sessionID" in actor) || actor.sessionID !== current.sessionID)
        throw new Error("Only this task's native worker may submit its result or decision")
    }

    async function quiet(current: SupervisorStore.Task) {
      const session = await native.get(current.sessionID)
      if ((await native.active()).includes(current.sessionID) || (await native.inbox(current.sessionID)).length)
        throw new Error("Native worker has active execution or pending inbox input")
      return session
    }

    async function provision(current: SupervisorStore.Task, lead: SupervisorStore.Authority) {
      await SupervisorWorktree.create(current)
      if (current.provisioned) {
        const found = await native.get(current.sessionID)
        if (found.parentID || found.location.directory !== current.worktree)
          throw new Error("Native worker identity or placement changed")
        return
      }
      await native.create({
        sessionID: current.sessionID,
        directory: current.worktree,
        agent: current.agent,
        model: { providerID: current.model.providerID, id: current.model.modelID, variant: current.model.variant },
        permissions: current.permissions,
        title: `Supervisor ${current.kind}: ${current.id}`,
      })
      store.markProvisioned({ authority: lead, taskID: current.id })
    }

    async function refreshDelivery(current: SupervisorStore.Task) {
      const log = await native.log({ sessionID: current.sessionID, after: current.cursor })
      const ownedMessages = new Set(store.ownedMessages(current.id))
      const delivered = log.events
        .filter((event) => event.name === "session.inbox.delivered")
        .map((event) => Schema.decodeUnknownSync(Schema.Struct({ inboxID: Schema.String }))(event.data).inboxID)
        .filter((id) => ownedMessages.has(id))
      store.observe({
        taskID: current.id,
        sessionID: current.sessionID,
        // Status can refresh deliveries while reconciliation owns an older log snapshot.
        // Only that serialized observer advances the cursor; delivery facts are idempotent.
        cursor: task(current.id).cursor,
        delivered,
      })
    }

    function prompt(current: SupervisorStore.Task, item: SupervisorStore.Outbox) {
      return `${item.payload.text}\n\nSupervisor task: ${current.id}\nOperation: ${item.messageID}\nWhen finished, use supervisor_result with the artifact's relative path. The tool finds your assigned task, computes evidence, and submits a provisional receipt. For a question, use supervisor_decision and finish your response; the durable answer will resume this session. Do not wait or poll for the answer in a tool. Do not merge, delete the worktree, or claim the task complete.`
    }

    async function dispatch(item: SupervisorStore.Outbox) {
      const lead = store.lead()
      const current = task(item.taskID)
      const work = workForTask(current.id)
      if (
        !lead?.active ||
        current.status !== "active" ||
        !store.pendingOutbox().some((next) => next.messageID === item.messageID && next.taskID === item.taskID)
      )
        return
      if (work?.hold && (work.hold.until === undefined || work.hold.until > Date.now())) return
      if (current.admissionUncertain) throw new Error("Native admission is uncertain; fenced recovery is required")
      await provision(current, lead)
      await native.pluginReady(current.worktree, "native-supervisor-pilot")
      store.beginDispatch({ authority: lead, taskID: current.id, messageID: item.messageID })
      try {
        await native.prompt({
          sessionID: current.sessionID,
          id: item.messageID,
          text: prompt(current, item),
          delivery: item.payload.delivery,
          resume: true,
        })
        store.recordAdmission({ taskID: current.id, sessionID: current.sessionID, messageID: item.messageID })
        if (!task(current.id).admissionUncertain) store.clearFailure({ taskID: current.id })
      } catch (error) {
        store.markAdmissionUncertain(current.id)
        throw error
      }
    }

    async function observe(id: string) {
      settleDelivery(id)
      const current = task(id)
      const lead = store.lead()
      const work = workForTask(current.id)
      if (current.status === "cancelled" && work?.state === "in-flight") store.backlog.settleCancelled(work.id)
      if (current.status === "completed" && current.kind === "scout" && work?.state === "in-flight")
        store.backlog.finish(work.id)
      if (current.status !== "active" && current.status !== "cancelling") return
      if (!current.provisioned) {
        if (current.status !== "cancelling") return
        const found = await native.get(current.sessionID).catch((error) => {
          if (isSessionNotFoundError(error)) return undefined
          throw error
        })
        if (!found && lead?.active) {
          store.settleCancellation({ authority: lead, taskID: current.id })
          return
        }
      }
      const log = await native.log({ sessionID: current.sessionID, after: current.cursor })
      const session = await native.get(current.sessionID)
      const ownedMessages = new Set(store.ownedMessages(current.id))
      const delivered = log.events
        .filter((event) => event.name === "session.inbox.delivered")
        .map((event) => Schema.decodeUnknownSync(Schema.Struct({ inboxID: Schema.String }))(event.data).inboxID)
        .filter((id) => ownedMessages.has(id))
      const observation = {
        taskID: current.id,
        sessionID: current.sessionID,
        cursor: log.cursor ?? current.cursor,
        delivered,
        outcome: session.outcome,
      }
      if (current.status === "cancelling") {
        if (!lead?.active) return
        const owned = new Set(store.ownedMessages(current.id))
        for (const item of await native.inbox(current.sessionID))
          if (owned.has(item.id)) await native.cancel({ sessionID: current.sessionID, inboxID: item.id })
        await native.interrupt(current.sessionID)
        await quiet(current)
        if (
          current.admissionUncertain ||
          store.outbox(current.id).some((item) => item.attempted && item.state !== "acked")
        )
          throw new Error(
            "Cancellation cannot settle: an earlier admission outcome is unknown; native request fencing is required before cleanup",
          )
        store.settleCancellation({ authority: lead, taskID: current.id })
      }
      if (current.status === "active") {
        const proposals = store.pendingReceipts().filter((item) => item.taskID === current.id)
        if (proposals.length) {
          if ((await native.active()).includes(current.sessionID) || (await native.inbox(current.sessionID)).length) {
            store.observe(observation)
            return
          }
          const settled = await quiet(current)
          if (settled.outcome !== "succeeded") throw new Error("Native worker has not completed successfully")
          for (const proposal of proposals) {
            const evidence = Schema.decodeUnknownSync(SupervisorProtocol.Evidence)(proposal.receipt.evidence)
            const verified = await SupervisorWorktree.verify({ task: current, receipt: evidence })
            if (JSON.stringify(verified) !== JSON.stringify(proposal.receipt.evidence))
              throw new Error("Receipt evidence changed before native worker settlement")
            store.observe({ ...observation, outcome: settled.outcome, receipt: proposal.receipt })
          }
          if (!task(current.id).admissionUncertain) store.clearFailure({ taskID: current.id })
          return
        }
      }
      store.observe(observation)
      if (task(current.id).admissionUncertain) {
        store.noteFailure({
          taskID: current.id,
          message: "An earlier admission outcome is unknown; cleanup remains blocked",
        })
        return
      }
      if (session.outcome === "failed" || session.outcome === "interrupted") {
        store.noteFailure({
          taskID: current.id,
          message: `Native execution ${session.outcome}; inspect the worker before continuing`,
        })
        return
      }
      if (!store.pendingOutbox().some((item) => item.taskID === current.id)) store.clearFailure({ taskID: current.id })
    }

    async function reconcile() {
      for (const item of await serial(async () => store.backlog.eligible({ occupiedResources: occupiedResources() }))) {
        await serial(async () => {
          const lead = store.lead()
          if (!lead?.active) return
          if (!store.backlog.readiness(item.id, { occupiedResources: occupiedResources() }).eligible) return
          try {
            await startWork(item.id, lead)
          } catch (error) {
            store.enqueueNotice({
              key: `dispatch:${item.id}:${item.attempt}:${createHash("sha256").update(String(error)).digest("hex")}`,
              payload: {
                text: `Supervisor could not start ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
                delivery: "steer",
              },
            })
          }
        }, `work:${item.id}`)
      }
      // Only operations for the same task serialize. A slow native admission cannot block the fleet.
      await Promise.all(
        store.pendingOutbox().map((item) =>
          serial(async () => {
            try {
              await dispatch(item)
            } catch (error) {
              store.noteFailure({
                taskID: item.taskID,
                message: error instanceof Error ? error.message : String(error),
              })
            }
          }, `task:${item.taskID}`),
        ),
      )
      await Promise.all(
        store.tasks().map((item) =>
          serial(async () => {
            try {
              await observe(item.id)
            } catch (error) {
              store.noteFailure({ taskID: item.id, message: error instanceof Error ? error.message : String(error) })
            }
          }, `task:${item.id}`),
        ),
      )
      if (Date.now() - maintenanceAt >= 10_000) {
        maintenanceAt = Date.now()
        await Promise.all([
          serial(() => delegates.reconcile(), "delegates"),
          serial(async () => {
            if (Date.now() - channelAt < 30_000) return
            channelAt = Date.now()
            const configured = store.channels.channels
              .list()
              .some((item) => item.enabled && (item.kind === "relay" || item.kind === "voice"))
            if (!configured) return
            await channels.poll({ operator: true })
            await channels.flush({ operator: true }, { automatic: true })
            maintenanceWarnings.delete("channels")
          }, "channels").catch((error) => {
            maintenanceWarnings.set("channels", error instanceof Error ? error.message : String(error))
          }),
          ...store.deliveries
            .list()
            .filter(
              (item) => item.status !== "landed" && !item.blocker && (item.pr || store.validations.get(item.taskID)),
            )
            .map((item) =>
              serial(async () => {
                const next = await delivery.refresh(item.taskID)
                const signature = createHash("sha256")
                  .update(JSON.stringify([next.status, next.checks?.status, next.validation?.status, next.sourceHead]))
                  .digest("hex")
                store.enqueueNotice({
                  key: `delivery:${item.taskID}:${signature}`,
                  payload: {
                    text: `Delivery for ${item.taskID}: ${next.status}. Inspect supervisor_delivery before landing.`,
                    delivery: "steer",
                  },
                })
              }, `task:${item.taskID}`),
            ),
        ])
      }
      await serial(async () => {
        const awayState = away.get()
        away.recordEvidence(returnEvidence((awayState.contract ?? awayState.catchup?.contract)?.enteredAt))
        if (!store.lead()?.active) return
        for (const work of store.backlog.list().filter((item) => item.state === "done" || item.state === "cancelled")) {
          if (!work.taskID && !work.delegatedHandoffID) continue
          store.channels.replies.recordTerminal({
            workID: work.id,
            ...(work.taskID ? { taskID: work.taskID } : { handoffID: work.delegatedHandoffID }),
            outcome: work.state === "done" ? "succeeded" : "cancelled",
          })
        }
        await channels.reconcile()
        for (const pending of away.pendingInputs()) {
          const notice = store.enqueueNotice({ key: pending.id, payload: { text: pending.text, delivery: "steer" } })
          if (notice.state === "acked") away.ackInput(pending.id)
        }
        for (const current of store.tasks()) {
          for (const decision of store.decisions(current.id).filter((item) => item.resolution === undefined))
            store.enqueueNotice({
              key: `decision:${current.id}:${decision.id}`,
              payload: {
                text: `Supervisor decision pending for ${current.id}: ${JSON.stringify(decision)}. Inspect status and resolve this decision.`,
                delivery: "steer",
              },
            })
          for (const receipt of store.receipts(current.id))
            store.enqueueNotice({
              key: `receipt:${current.id}:${receipt.operationID}`,
              payload: {
                text: `Supervisor verified ${current.kind} result for ${current.id}, operation ${receipt.operationID}. Inspect status and complete only when every obligation and decision is settled.`,
                delivery: "steer",
              },
            })
          if (current.error)
            store.enqueueNotice({
              key: `error:${current.id}:${createHash("sha256").update(current.error).digest("hex")}`,
              payload: { text: `Supervisor task ${current.id} needs attention: ${current.error}`, delivery: "steer" },
            })
        }
      })
      for (const notice of await serial(async () => store.pendingNotices())) {
        await serial(async () => {
          const lead = store.lead()
          if (!lead?.active || lead.generation !== notice.generation) return
          // A missing lead remains an explicit failed wake; never recreate it or drop its pending notice.
          await native.get(notice.sessionID)
          if (store.lead()?.active !== true || store.lead()?.generation !== notice.generation) return
          await native.prompt({ sessionID: notice.sessionID, id: notice.messageID, ...notice.payload, resume: true })
          store.ackNotice({ generation: notice.generation, key: notice.key })
          if (away.pendingInputs().some((input) => input.id === notice.key)) away.ackInput(notice.key)
        }, "notice")
      }
    }

    return {
      home,
      recoveryInterruptions: () =>
        store
          .tasks()
          .filter((item) => item.status === "cancelling" || item.status === "cancelled")
          .map((item) => item.sessionID),
      recoverFencedEpoch: async (fence: { from: number; to: number; pilotID: string }) =>
        serial(async () => {
          if (!input.managed || fence.to !== input.managed.epoch || fence.pilotID !== input.managed.pilotID)
            throw new Error("Fenced recovery requires the matching managed runtime")
          for (const current of store.tasks()) {
            const session = await native.get(current.sessionID).catch((error) => {
              if (!current.provisioned && isSessionNotFoundError(error)) return undefined
              throw error
            })
            if (!session) continue
            if (session.id !== current.sessionID || session.parentID || session.location.directory !== current.worktree)
              throw new Error(`Native worker identity or placement changed: ${current.id}`)
          }
          return store.recoverFencedEpoch(fence)
        }),
      reconcile,
      request: (actor: SupervisorProtocol.Actor, operation: SupervisorProtocol.Operation) =>
        serial(async () => {
          if (Schema.is(SupervisorKnowledge.Operation)(operation)) return knowledge.request(operation, actor)
          if (Schema.is(SupervisorAway.Operation)(operation)) return away.request(actor, operation)
          if (Schema.is(SupervisorVoice.Operation)(operation)) return voice.request(actor, operation)
          if (
            [
              "work.create",
              "task.create",
              "project.add",
              "project.update",
              "project.default",
              "project.archive",
              "project.restore",
              "delegate.add",
              "delegate.update",
              "delegate.provision",
              "handoff.create",
            ].includes(operation.type)
          ) {
            away.guard()
            knowledge.guard()
          }
          if (Schema.is(SupervisorDelegatesRuntime.Operation)(operation)) return delegates.handle(operation, actor)
          if (Schema.is(SupervisorDeliveryRuntime.Operation)(operation)) {
            const result = await delivery.request(actor, operation)
            settleDelivery(operation.taskID)
            return result
          }
          if (Schema.is(SupervisorChannels.Operation)(operation)) {
            if (operation.type === "channel.poll") return channels.poll(actor)
            if (operation.type === "channel.flush") return channels.flush(actor)
            return channels.request(actor, operation)
          }
          if (operation.type === "lead.activate") {
            if (!("operator" in actor)) throw new Error("Lead activation requires the local operator")
            const session = await native.get(operation.sessionID)
            if (session.parentID || store.tasks().some((item) => item.sessionID === session.id))
              throw new Error("Lead must be an independent session outside this worker fleet")
            return store.activateLead(operation)
          }
          if (operation.type === "presentation") {
            if (!("operator" in actor)) throw new Error("Presentation requires the local operator")
            if (!defaults) throw new Error("Supervisor home has no settings")
            const lead = store.lead()
            const entries: (typeof SupervisorPresentation.Facts.Type.entries)[number][] = [
              ...(lead?.active
                ? [
                    {
                      id: "lead",
                      role: "lead" as const,
                      title: defaults.profile?.id === "shuvbro" ? "ShuvBro lead" : "Supervisor lead",
                      sessionID: lead.sessionID,
                      location: defaults.project,
                      lifecycle: "active" as const,
                      decisions: 0,
                      uncertain: false,
                      retired: false,
                    },
                  ]
                : []),
              ...store.tasks().map((item) => {
                const work = workForTask(item.id)
                return {
                  id: item.id,
                  role: item.kind,
                  taskID: item.id,
                  workID: work?.id,
                  projectID: work?.projectID,
                  title: work?.id ?? item.id,
                  sessionID: item.sessionID,
                  location: item.worktree,
                  lifecycle: item.status,
                  decisions: store.decisions(item.id).filter((decision) => !decision.resolution).length,
                  uncertain: item.admissionUncertain,
                  retired: Boolean(store.cleanup(item.id)),
                }
              }),
            ]
            return { entries }
          }
          if (operation.type === "project.list") {
            const lead = store.lead()
            if ("operator" in actor || (lead?.active && actor.sessionID === lead.sessionID))
              return {
                projects: store.projects.list({ includeArchived: operation.includeArchived }),
                defaultProject: store.projects.default()?.id,
              }
            const current = store.tasks().find((item) => item.sessionID === actor.sessionID)
            if (!current) throw new Error("Session has no authority in this supervisor home")
            return {
              projects: store.projects.list({ includeArchived: true }).filter((item) => item.path === current.project),
            }
          }
          if (operation.type === "project.add") {
            authority(actor, operation.generation)
            requireInheritedPermissions(actor, operation.permissions, permissionDefaults)
            if (
              !("operator" in actor) &&
              (operation.yolo === true || (operation.mode && operation.mode !== "local-only"))
            )
              throw new Error("New publishing or automatic merge policy requires the operator's project command")
            const prepared = await SupervisorProjects.provision({
              home,
              ...operation,
              mode: "operator" in actor ? operation.mode : "local-only",
              permissions: operation.permissions ? [...operation.permissions] : undefined,
            })
            authority(actor, operation.generation)
            return store.projects.add(prepared)
          }
          if (operation.type === "project.update") {
            authority(actor, operation.generation)
            const current = store.projects.get(operation.id)
            if (!current) throw new Error(`Unknown supervisor project: ${operation.id}`)
            requireInheritedPermissions(actor, operation.permissions, current.permissions ?? permissionDefaults)
            if (
              !("operator" in actor) &&
              ((operation.yolo === true && !current.yolo) || (operation.mode && operation.mode !== current.mode))
            )
              throw new Error(
                "Changing delivery policy or enabling automatic merge requires the operator's project command",
              )
            const policy = {
              description: operation.description ?? current.description,
              baseRef: operation.baseRef ?? current.baseRef,
              mode: operation.mode ?? current.mode,
              yolo: operation.yolo ?? current.yolo,
              model: operation.model ?? current.model,
              agent: operation.agent ?? current.agent,
              permissions: operation.permissions ? [...operation.permissions] : current.permissions,
            }
            await SupervisorProjects.prepare({ id: current.id, path: current.path, ...policy })
            authority(actor, operation.generation)
            return store.projects.update(current.id, policy)
          }
          if (
            operation.type === "project.default" ||
            operation.type === "project.archive" ||
            operation.type === "project.restore"
          ) {
            authority(actor, operation.generation)
            if (operation.type === "project.default") return store.projects.setDefault(operation.id)
            if (operation.type === "project.restore") return store.projects.restore(operation.id)
            if (
              store.backlog
                .list({ projectID: operation.id })
                .some((item) => item.state === "queued" || item.state === "in-flight")
            )
              throw new Error("Project has queued or in-flight work; resolve it before archiving")
            return store.projects.archive(operation.id)
          }
          if (operation.type === "work.create") {
            authority(actor, operation.generation)
            if (operation.id === "lead") throw new Error("Work item ID lead is reserved for the managed lead")
            const project = operation.projectID ? store.projects.get(operation.projectID) : store.projects.default()
            if (!project || project.archived)
              throw new Error("Choose an active registered project with supervisor_projects")
            const existing = store.backlog.get(operation.id)
            requireInheritedPermissions(
              actor,
              operation.permissions,
              existing?.overrides.permissions ?? project.permissions ?? permissionDefaults,
            )
            const mode =
              project.mode === "no-mistakes-prod-only"
                ? operation.classification === "internal"
                  ? "direct-PR"
                  : "no-mistakes"
                : project.mode
            if (
              !("operator" in actor) &&
              ((operation.mergePolicy === "auto" && !(existing ? existing.mergePolicy === "auto" : project.yolo)) ||
                (operation.mode && operation.mode !== (existing?.deliveryMode ?? mode)))
            )
              throw new Error(
                "A work item cannot increase merge authority or change delivery mode without the operator",
              )
            return store.backlog.enqueue({
              id: operation.id,
              projectID: project.id,
              kind: operation.kind,
              brief: operation.brief,
              deliveryMode: operation.mode ?? existing?.deliveryMode ?? mode,
              mergePolicy: operation.mergePolicy ?? existing?.mergePolicy ?? (project.yolo ? "auto" : "manual"),
              policyProvenance: existing?.policyProvenance ?? {
                source: "operator" in actor && (operation.mode || operation.mergePolicy) ? "captain" : "registry",
                reference:
                  "operator" in actor && (operation.mode || operation.mergePolicy)
                    ? `operator:work:${operation.id}`
                    : `project:${project.id}`,
                capturedAt: new Date(existing?.createdAt ?? Date.now()).toISOString(),
              },
              classification: operation.classification,
              overrides: {
                baseRef: operation.baseRef,
                model: operation.model,
                agent: operation.agent,
                permissions: operation.permissions
                  ? [...operation.permissions]
                  : (existing?.overrides.permissions ??
                    project.permissions ??
                    (defaults
                      ? SupervisorSettings.permissions(defaults)
                      : [{ action: "*", resource: "*", effect: "ask" }])),
              },
              dependencies: operation.dependencies ? [...operation.dependencies] : undefined,
              resources: operation.resources ? [...operation.resources] : undefined,
              priority: operation.priority,
              notBefore: operation.notBefore,
              hold: operation.hold,
            })
          }
          if (operation.type === "work.update") {
            authority(actor, operation.generation)
            const current = store.backlog.get(operation.id)
            if (!current) throw new Error(`Unknown supervisor work item: ${operation.id}`)
            requireInheritedPermissions(
              actor,
              operation.permissions,
              current.overrides.permissions ?? store.projects.get(current.projectID)?.permissions ?? permissionDefaults,
            )
            const updated = store.backlog.update(current.id, {
              brief: operation.brief ?? current.brief,
              priority: operation.priority ?? current.priority,
              notBefore: operation.notBefore ?? current.notBefore,
              dependencies: operation.dependencies ? [...operation.dependencies] : current.dependencies,
              resources: operation.resources ? [...operation.resources] : current.resources,
              overrides: {
                baseRef: operation.baseRef ?? current.overrides.baseRef,
                model: operation.model ?? current.overrides.model,
                agent: operation.agent ?? current.overrides.agent,
                permissions: operation.permissions ? [...operation.permissions] : current.overrides.permissions,
              },
            })
            return operation.hold ? store.backlog.hold(updated.id, operation.hold) : updated
          }
          if (
            operation.type === "work.hold" ||
            operation.type === "work.release" ||
            operation.type === "work.cancel" ||
            operation.type === "work.retry" ||
            operation.type === "work.dispatch"
          ) {
            const lead = authority(actor, operation.generation)
            if (operation.type === "work.hold")
              return store.backlog.hold(operation.id, { reason: operation.reason, until: operation.until })
            if (operation.type === "work.release") return store.backlog.release(operation.id)
            if (operation.type === "work.dispatch") return startWork(operation.id, lead)
            const current = store.backlog.get(operation.id)
            if (!current) throw new Error(`Unknown supervisor work item: ${operation.id}`)
            if (operation.type === "work.retry") {
              if (current.taskID && store.task(current.taskID)?.admissionUncertain)
                throw new Error("Cannot retry while the previous native admission is uncertain")
              return store.backlog.retry(current.id)
            }
            return cancelWork(current.id, lead)
          }
          if (operation.type === "status") {
            const lead = store.lead()
            const all = "operator" in actor || (lead?.active && lead.sessionID === actor.sessionID)
            const tasks = store
              .tasks()
              .filter(
                (item) =>
                  (!operation.taskID || item.id === operation.taskID) &&
                  (all || ("sessionID" in actor && item.sessionID === actor.sessionID)),
              )
            if (!all && !tasks.length) throw new Error("Session has no authority in this supervisor home")
            const active = await native.active().catch(() => undefined)
            return {
              lead: all ? lead : undefined,
              warnings: all ? [...maintenanceWarnings.values()] : undefined,
              projects: store.projects
                .list({ includeArchived: true })
                .filter((project) => all || tasks.some((item) => item.project === project.path)),
              defaultProject: all ? store.projects.default()?.id : undefined,
              backlog: store.backlog
                .list()
                .filter(
                  (item) =>
                    (all || tasks.some((current) => current.id === item.taskID)) &&
                    (!operation.taskID || item.id === operation.taskID || item.taskID === operation.taskID),
                )
                .map((item) => ({
                  ...item,
                  readiness: store.backlog.readiness(item.id, { occupiedResources: occupiedResources() }),
                })),
              deliveries: store.deliveries
                .list()
                .filter((delivery) => all || tasks.some((item) => item.id === delivery.taskID)),
              validations: store.validations
                .list()
                .filter((validation) => all || tasks.some((item) => item.id === validation.taskID)),
              delegates: all ? store.delegates.list({ includeArchived: true }) : undefined,
              away: all ? away.get() : undefined,
              replies: all ? store.channels.replies.list() : undefined,
              inbox: all ? store.channels.inbox.list() : undefined,
              pendingNotifications: all ? store.pendingNotices() : undefined,
              tasks: await Promise.all(
                tasks.map(async (item) => {
                  const deliveryFresh = item.provisioned
                    ? await refreshDelivery(item).then(
                        () => true,
                        () => false,
                      )
                    : false
                  const observed = await Promise.all([
                    native.get(item.sessionID).then(
                      () => true,
                      () => false,
                    ),
                    native.inbox(item.sessionID).catch(() => undefined),
                    native.permissions(item.worktree, item.sessionID).catch(() => undefined),
                  ])
                  return {
                    ...item,
                    deliveryFresh,
                    native: {
                      state:
                        active && observed[0] && observed[1] && observed[2]
                          ? active.includes(item.sessionID)
                            ? "running"
                            : "idle"
                          : "unknown",
                      pending: observed[1]?.length ?? 0,
                      permissions: observed[2]?.length ?? 0,
                      permissionRequests:
                        observed[2]?.map((request) => ({
                          id: request.id,
                          action: request.action,
                          resources: request.resources,
                        })) ?? [],
                    },
                    receipts: store.receipts(item.id),
                    decisions: store.decisions(item.id),
                    obligations: store.obligations(item.id),
                    cleanup: store.cleanup(item.id),
                  }
                }),
              ),
            }
          }
          if (operation.type === "lead.revoke") {
            if (!("operator" in actor)) throw new Error("Lead revocation requires the local operator")
            store.revokeLead(authority(actor, operation.generation))
            return store.lead()
          }
          if (operation.type === "task.create") {
            const lead = authority(actor, operation.generation)
            if (operation.taskID === "lead") throw new Error("Task ID lead is reserved for the managed lead")
            const existing = store.task(operation.taskID)
            if (existing && existing.project !== (await realpath(operation.project)))
              throw new Error("Conflicting supervisor project")
            const plan =
              existing ??
              (await SupervisorWorktree.propose({
                home,
                taskID: operation.taskID,
                project: operation.project,
                baseRef: operation.baseRef,
                kind: operation.kind,
              }))
            requireInheritedPermissions(
              actor,
              operation.permissions,
              existing?.permissions ??
                store.projects.list({ includeArchived: true }).find((item) => item.path === plan.project)
                  ?.permissions ??
                permissionDefaults,
            )
            const digest = createHash("sha256").update(`${home}\0${operation.taskID}`).digest("hex")
            const current = store.createTask({
              authority: lead,
              messageID: `msg_${digest}_initial`,
              task: {
                id: operation.taskID,
                kind: operation.kind,
                project: plan.project,
                worktree: plan.worktree,
                branch: plan.branch,
                baseRef: operation.baseRef,
                baseCommit: plan.baseCommit,
                sessionID: `ses_${digest}`,
                brief: operation.brief,
                model: operation.model,
                agent: operation.agent,
                permissions: [...operation.permissions],
              },
            })
            const project =
              store.projects.list({ includeArchived: true }).find((item) => item.path === current.project) ??
              store.projects.add(
                await SupervisorProjects.prepare({
                  path: current.project,
                  baseRef: current.baseRef,
                  model: current.model,
                  agent: current.agent,
                  permissions: current.permissions,
                }),
              )
            if (!store.backlog.get(current.id)) {
              store.backlog.enqueue({
                id: current.id,
                projectID: project.id,
                kind: current.kind,
                brief: current.brief,
                deliveryMode: "local-only",
                mergePolicy: "manual",
                classification: "Explicit compatibility task; no publishing or merge authority",
                overrides: {
                  baseRef: current.baseRef,
                  model: current.model,
                  agent: current.agent,
                  permissions: current.permissions,
                },
              })
              store.backlog.markStarted({ id: current.id, taskID: current.id })
            }
            return current
          }
          const current = task(operation.taskID)
          if (operation.type === "receipt.propose") {
            worker(actor, current)
            await refreshDelivery(current)
            if (
              !store
                .obligations(current.id)
                .some((item) => item.operationID === operation.operationID && item.state === "open" && item.delivered)
            )
              throw new Error("Receipt operation is not open and delivered to this native worker")
            const evidence = await SupervisorWorktree.verify({ task: current, receipt: operation.evidence })
            return store.proposeReceipt({
              taskID: current.id,
              operationID: operation.operationID,
              receipt: { kind: current.kind, evidence },
            })
          }
          if (operation.type === "decision.open") {
            worker(actor, current)
            return store.openDecision({
              taskID: current.id,
              id: operation.id,
              payload: {
                question: operation.question,
                requiredAuthority: operation.requiredAuthority ?? "lead",
                category: operation.category ?? "question",
              },
            })
          }
          const lead = authority(actor, operation.generation)
          if (operation.type === "task.interrupt") {
            const work = workForTask(current.id)
            if (work) store.backlog.hold(work.id, { reason: "Interrupted by the lead or operator" })
            await native.interrupt(current.sessionID)
            return task(current.id)
          }
          if (operation.type === "task.resume") {
            const work = workForTask(current.id)
            if (work) store.backlog.release(work.id)
            return store.enqueue({
              authority: lead,
              taskID: current.id,
              messageID: operation.operationID,
              payload: {
                text: operation.text ?? "Continue the assigned task and its outstanding obligations.",
                delivery: "steer",
              },
            })
          }
          if (operation.type === "task.send") {
            if (!operation.operationID.startsWith("msg_")) throw new Error("Operation ID must start with msg_")
            return store.enqueue({
              authority: lead,
              taskID: current.id,
              messageID: operation.operationID,
              payload: { text: operation.text, delivery: operation.delivery },
            })
          }
          if (operation.type === "task.cancel") {
            const work = workForTask(current.id)
            if (work) return cancelWork(work.id, lead)
            store.cancelTask({ authority: lead, taskID: current.id })
            return task(current.id)
          }
          if (operation.type === "decision.resolve") {
            const decision = store.decisions(current.id).find((item) => item.id === operation.id)
            if (
              decision &&
              Schema.decodeUnknownSync(
                Schema.Struct({ requiredAuthority: Schema.optional(Schema.Literals(["lead", "user"])) }),
              )(decision.payload).requiredAuthority === "user" &&
              !("operator" in actor)
            )
              throw new Error(
                "This decision requires the user; ask them to answer through the operator or decision board",
              )
            store.resolveDecision({
              authority: lead,
              taskID: current.id,
              id: operation.id,
              resolution: {
                answer: operation.answer,
                answeredBy: "operator" in actor ? "user" : "lead",
                sessionID: lead.sessionID,
                generation: lead.generation,
                ...(operation.requestID ? { requestID: operation.requestID } : {}),
              },
              expectedQuestion: operation.expectedQuestion,
              requestID: operation.requestID,
              messageID: `msg_${createHash("sha256").update(`${home}\0${current.id}\0${operation.id}`).digest("hex")}`,
              payload: { text: `Decision ${operation.id}: ${operation.answer}`, delivery: "steer" },
            })
            return store.decisions(current.id)
          }
          if (operation.type === "task.complete" && current.status === "completed") return current
          if (operation.type === "task.cleanup") {
            const previous = store.cleanup(current.id)
            if (previous) return previous
          }
          const settled = await quiet(current)
          if (operation.type === "task.complete") {
            if (settled.outcome !== "succeeded") throw new Error("Native worker has not completed successfully")
            const receipt = store.receipts(current.id).at(-1)
            if (!receipt) throw new Error("Task has no verified receipt")
            await SupervisorWorktree.verify({
              task: current,
              receipt: Schema.decodeUnknownSync(SupervisorProtocol.Evidence)(receipt.evidence),
            })
            store.completeTask({ authority: lead, taskID: current.id })
            const work = workForTask(current.id)
            if (work && current.kind === "scout") store.backlog.finish(work.id)
            return task(current.id)
          }
          if (current.admissionUncertain) throw new Error("Cleanup blocked by an unknown earlier admission")
          if (current.status !== "completed" && current.status !== "cancelled")
            throw new Error("Cleanup requires a terminal task")
          const work = workForTask(current.id)
          if (work) channels.assertTeardownAllowed({ workID: work.id, taskID: current.id })
          if (operation.type === "task.discard") {
            if (!("operator" in actor)) throw new Error("Discard requires the local operator")
            const previous = store.cleanup(current.id)
            if (previous) return previous
            const receipt = await SupervisorWorktree.discard(current, { home, reference: operation.reference })
            store.recordCleanup({ taskID: current.id, evidence: receipt })
            return receipt
          }
          const receipt = await SupervisorWorktree.cleanup(current, { landingRef: operation.landingRef })
          store.recordCleanup({ taskID: current.id, evidence: receipt })
          return receipt
        }, operationKey(operation)),
      async close() {
        if (closed) return
        closed = true
        await Promise.all(tails.values())
        store.close()
      },
    }
  }
}
