import { createHash } from "node:crypto"
import path from "node:path"
import { Schema } from "effect"
import { SupervisorDelegates } from "./delegates"
import type { SupervisorProtocol } from "./protocol"
import type { SupervisorStore } from "./store"

export namespace SupervisorDelegatesRuntime {
  const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/))
  const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000))
  const Generation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  const Model = Schema.Struct({ providerID: Text, modelID: Text, variant: Schema.optional(Text) })
  const Permission = Schema.Struct({ action: Text, resource: Text, effect: Schema.Literals(["allow", "deny", "ask"]) })
  const Dependency = Schema.Struct({ id: ID, when: Schema.Literals(["done", "landed"]) })
  const PolicyProvenance = Schema.Struct({
    source: Schema.Literals(["captain", "registry"]),
    reference: Text,
    capturedAt: Text,
  })
  const Work = Schema.Struct({
    sourceID: ID,
    destinationID: ID,
    kind: Schema.Literals(["ship", "scout"]),
    brief: Text,
    deliveryMode: Schema.Literals(["no-mistakes", "direct-PR", "local-only"]),
    mergePolicy: Schema.Literals(["manual", "auto"]),
    policyProvenance: Schema.optional(PolicyProvenance),
    classification: Schema.optional(Schema.String),
    overrides: Schema.Struct({
      baseRef: Schema.optional(Text),
      model: Schema.optional(Model),
      agent: Schema.optional(Text),
      permissions: Schema.optional(Schema.Array(Permission)),
    }),
    dependencies: Schema.Array(Dependency),
    resources: Schema.Array(Text),
    priority: Schema.Int,
    notBefore: Schema.optional(Schema.Number),
  })
  const Payload = Schema.Struct({
    sourceHandoffID: ID,
    sourceProjectID: ID,
    projectID: ID,
    requestedWorkIDs: Schema.Array(ID).check(Schema.isMinLength(1)),
    work: Schema.Array(Work).check(Schema.isMinLength(1)),
    predecessors: Schema.Array(
      Schema.Struct({
        id: ID,
        when: Schema.Literals(["done", "landed"]),
        state: Schema.Literals(["done", "cancelled"]),
        landed: Schema.optional(Schema.Json),
      }),
    ),
  })
  const Receipt = Schema.Struct({
    id: ID,
    projectID: ID,
    work: Schema.Array(Schema.Struct({ sourceID: ID, destinationID: ID })),
  })
  const Report = Schema.Struct({
    operationID: ID,
    evidence: Schema.Struct({
      kind: Schema.Literal("scout"),
      artifact: Schema.Struct({
        relativePath: Text,
        sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
        contentBase64: Schema.String,
      }),
      head: Text,
      baseCommit: Text,
      branch: Text,
      worktree: Text,
    }),
  })
  const Result = Schema.Struct({
    receipt: Receipt,
    work: Schema.Array(
      Schema.Struct({
        sourceID: ID,
        destinationID: ID,
        state: Schema.Literals(["done", "cancelled"]),
        landed: Schema.optional(Schema.Json),
        report: Schema.optional(Report),
      }),
    ),
  })
  const WorkStatus = Schema.Struct({
    sourceID: ID,
    destinationID: ID,
    state: Schema.Literals(["queued", "in-flight", "done", "cancelled"]),
    landed: Schema.optional(Schema.Json),
    report: Schema.optional(Report),
  })
  const DestinationStatus = Schema.Union([
    Schema.Struct({ found: Schema.Literal(false) }),
    Schema.Struct({
      found: Schema.Literal(true),
      receipt: Receipt,
      state: Schema.Literals(["running", "completed", "failed"]),
      work: Schema.Array(WorkStatus),
      result: Schema.optional(Result),
    }),
  ])
  export const Operation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("delegate.list"), includeArchived: Schema.optional(Schema.Boolean) }),
    Schema.Struct({
      type: Schema.Literal("delegate.add"),
      generation: Generation,
      id: ID,
      home: Text,
      host: Schema.optional(Text),
      scope: Text,
      sourceProjectID: Schema.optional(ID),
      projectID: Schema.optional(ID),
      enabled: Schema.optional(Schema.Boolean),
      model: Schema.optional(Model),
    }),
    Schema.Struct({
      type: Schema.Literal("delegate.update"),
      generation: Generation,
      id: ID,
      scope: Schema.optional(Text),
      projectID: Schema.optional(ID),
      enabled: Schema.optional(Schema.Boolean),
      model: Schema.optional(Model),
    }),
    Schema.Struct({ type: Schema.Literal("delegate.archive"), generation: Generation, id: ID }),
    Schema.Struct({
      type: Schema.Literal("delegate.provision"),
      generation: Generation,
      id: ID,
      project: Text,
      model: Schema.optional(Text),
      providerURL: Schema.optional(Text),
    }),
    Schema.Struct({
      type: Schema.Literal("delegate.status"),
      id: Schema.optional(ID),
      receivedID: Schema.optional(ID),
    }),
    Schema.Struct({
      type: Schema.Literal("delegate.send"),
      generation: Generation,
      id: ID,
      operationID: ID,
      text: Text,
      delivery: Schema.Literals(["steer", "queue"]),
    }),
    Schema.Struct({
      type: Schema.Literal("delegate.receive"),
      kind: Schema.Literal("message"),
      id: ID,
      sourceHome: Text,
      text: Text,
      delivery: Schema.Literals(["steer", "queue"]),
    }),
    Schema.Struct({
      type: Schema.Literal("delegate.receive"),
      kind: Schema.Literal("handoff"),
      id: ID,
      sourceHome: Text,
      payload: Payload,
    }),
    Schema.Struct({ type: Schema.Literal("delegate.cancel"), receivedID: ID }),
    Schema.Struct({
      type: Schema.Literal("handoff.create"),
      generation: Generation,
      id: ID,
      delegateID: ID,
      workIDs: Schema.Array(ID).check(Schema.isMinLength(1)),
    }),
    Schema.Struct({ type: Schema.Literal("handoff.status"), id: ID }),
    Schema.Struct({ type: Schema.Literal("handoff.retry"), generation: Generation, id: ID }),
    Schema.Struct({ type: Schema.Literal("handoff.cancel"), generation: Generation, id: ID }),
  ])
  export type Operation = typeof Operation.Type
  type Store = ReturnType<typeof SupervisorStore.open>
  type Actor = SupervisorProtocol.Actor
  type RouteOperation =
    | Extract<Operation, { type: "delegate.receive" | "delegate.status" | "delegate.cancel" }>
    | { type: "status" }
  export type Request = (
    delegate: SupervisorDelegates.Delegate,
    operation: RouteOperation,
  ) => Promise<SupervisorDelegates.TransportResult>

  export function open(input: {
    store: Store
    home: string
    authorize: (actor: Actor, generation?: number) => void
    request?: Request
    syncShared?: (delegate: SupervisorDelegates.Delegate) => Promise<SupervisorDelegates.TransportResult>
    notify?: () => void | Promise<void>
    cancelWork?: (id: string) => unknown | Promise<unknown>
  }) {
    if (!path.isAbsolute(input.home)) throw new Error("Supervisor home must be absolute")
    const request =
      input.request ??
      ((delegate: SupervisorDelegates.Delegate, operation: RouteOperation) =>
        SupervisorDelegates.request(delegate, operation as SupervisorProtocol.Operation))
    const home = path.resolve(input.home)

    async function handle(operation: Operation, actor: Actor): Promise<unknown> {
      if (operation.type === "delegate.receive") {
        requireOperator(actor)
        if (operation.kind === "message") {
          requireSourceHome(operation.sourceHome)
          const payload = { text: operation.text, delivery: operation.delivery }
          const notice = input.store.enqueueNotice({
            key: `delegate-message:${routeID(operation.sourceHome, operation.id)}`,
            payload,
          })
          if (notice.payload.text !== operation.text || notice.payload.delivery !== operation.delivery)
            throw new Error(`Conflicting delegate message ID: ${operation.id}`)
          return { messageID: notice.messageID, state: notice.state }
        }
        return receiveHandoff(operation)
      }
      if (operation.type === "delegate.cancel") {
        requireOperator(actor)
        return cancelDestination(operation.receivedID)
      }
      if (operation.type === "delegate.status" && operation.receivedID) {
        requireOperator(actor)
        if (operation.id) throw new Error("Choose a delegate or received handoff")
        return destinationStatus(operation.receivedID)
      }
      if (
        operation.type === "delegate.add" ||
        operation.type === "delegate.update" ||
        operation.type === "delegate.archive" ||
        operation.type === "delegate.provision"
      )
        requireOperator(actor)
      input.authorize(actor, "generation" in operation ? operation.generation : undefined)
      if (operation.type === "delegate.list")
        return input.store.delegates.list({ includeArchived: operation.includeArchived })
      if (operation.type === "delegate.add")
        return input.store.delegates.add({
          id: operation.id,
          home: operation.home,
          host: operation.host,
          scope: operation.scope,
          sourceProjectID: operation.sourceProjectID,
          projectID: operation.projectID,
          enabled: operation.enabled,
          model: operation.model,
        })
      if (operation.type === "delegate.update")
        return input.store.delegates.update(operation.id, {
          ...(operation.scope === undefined ? {} : { scope: operation.scope }),
          ...(operation.projectID === undefined ? {} : { projectID: operation.projectID }),
          ...(operation.enabled === undefined ? {} : { enabled: operation.enabled }),
          ...(operation.model === undefined ? {} : { model: operation.model }),
        })
      if (operation.type === "delegate.archive") {
        if (input.store.delegates.outstanding().some((handoff) => handoff.delegateID === operation.id))
          throw new Error(`Delegate has an unfinished handoff: ${operation.id}`)
        return input.store.delegates.archive(operation.id)
      }
      if (operation.type === "delegate.provision") {
        const delegate = requireDelegate(operation.id)
        const provisioned = await SupervisorDelegates.provision(delegate, {
          project: operation.project,
          model:
            operation.model ?? (delegate.model ? `${delegate.model.providerID}/${delegate.model.modelID}` : undefined),
          providerURL: operation.providerURL,
        })
        if (provisioned.state !== "ok" || !input.syncShared) return provisioned
        const shared = await input.syncShared(delegate)
        return shared.state === "ok" ? provisioned : shared
      }
      if (operation.type === "delegate.status") {
        if (!operation.id) throw new Error("Delegate ID is required")
        return request(requireDelegate(operation.id), { type: "status" })
      }
      if (operation.type === "delegate.send") {
        const delegate = requireDelegate(operation.id)
        if (input.syncShared) {
          const shared = await input.syncShared(delegate)
          if (shared.state !== "ok") return shared
        }
        return request(delegate, {
          type: "delegate.receive",
          kind: "message",
          id: operation.operationID,
          sourceHome: home,
          text: operation.text,
          delivery: operation.delivery,
        })
      }
      if (operation.type === "handoff.create") {
        const existing = input.store.delegates.handoff(operation.id)
        if (existing) {
          const previous = Schema.decodeUnknownSync(Payload)(existing.payload)
          if (
            existing.delegateID !== operation.delegateID ||
            JSON.stringify(previous.requestedWorkIDs) !== JSON.stringify(operation.workIDs)
          )
            throw new Error(`Conflicting handoff ID: ${operation.id}`)
          return advance(existing)
        }
        const delegate = requireDelegate(operation.delegateID)
        if (!delegate.sourceProjectID || !delegate.projectID)
          throw new Error(`Delegate requires an explicit source project to destination project route: ${delegate.id}`)
        const payload = makePayload(operation.id, delegate.sourceProjectID, delegate.projectID, [...operation.workIDs])
        const handoff = input.store.delegates.enqueue(
          {
            id: operation.id,
            delegateID: delegate.id,
            sourceWorkIDs: payload.work.map((item) => item.sourceID),
            payload,
          },
          () => payload.work.forEach((item) => input.store.backlog.delegate(item.sourceID, operation.id)),
        )
        return advance(handoff)
      }
      if (operation.type === "handoff.status") {
        const handoff = input.store.delegates.handoff(operation.id)
        if (!handoff) throw new Error(`Unknown handoff: ${operation.id}`)
        return handoff
      }
      if (operation.type === "handoff.retry") return advance(input.store.delegates.retry(operation.id))
      if (operation.type === "handoff.cancel") return advance(input.store.delegates.requestCancel(operation.id))
      throw new Error("Unknown delegate operation")
    }

    function requireDelegate(id: string) {
      const delegate = input.store.delegates.get(id)
      if (!delegate || !delegate.enabled) throw new Error(`Delegate unavailable: ${id}`)
      return delegate
    }

    function makePayload(handoffID: string, sourceProjectID: string, projectID: string, selectedIDs: string[]) {
      const items = input.store.backlog.list()
      const closure = SupervisorDelegates.closure(items, selectedIDs)
      const byID = new Map(items.map((item) => [item.id, item]))
      closure.forEach((id) => {
        const item = byID.get(id)!
        if (item.hold || item.delegatedHandoffID) throw new Error(`Work item is already held: ${id}`)
        if (item.projectID !== sourceProjectID)
          throw new Error(`Handoff crosses projects; route ${item.projectID} explicitly to a destination project`)
        if (item.deliveryMode === "local-only") throw new Error(`Local-only work must stay in the main home: ${id}`)
        item.dependencies.forEach((dependency) => {
          const previous = byID.get(dependency.id)!
          if (previous.projectID !== sourceProjectID)
            throw new Error(`Handoff crosses projects through dependency ${dependency.id}; use an explicit route`)
        })
      })
      const selected = new Set(closure)
      const predecessors = closure.flatMap((id) =>
        byID
          .get(id)!
          .dependencies.filter((dependency) => !selected.has(dependency.id))
          .map((dependency) => {
            const previous = byID.get(dependency.id)!
            return { id: dependency.id, when: dependency.when, state: previous.state, landed: previous.landed }
          }),
      )
      const work = closure.map((id) => {
        const item = byID.get(id)!
        return {
          sourceID: id,
          destinationID: routeID(home, `${handoffID}:${id}`),
          kind: item.kind,
          brief: item.brief,
          deliveryMode: item.deliveryMode,
          mergePolicy: item.mergePolicy,
          policyProvenance: item.policyProvenance,
          classification: item.classification,
          overrides: item.overrides,
          dependencies: item.dependencies
            .filter((dependency) => selected.has(dependency.id))
            .map((dependency) => ({ id: routeID(home, `${handoffID}:${dependency.id}`), when: dependency.when })),
          resources: item.resources,
          priority: item.priority,
          notBefore: item.notBefore,
        }
      })
      return Schema.decodeUnknownSync(Payload)({
        sourceHandoffID: handoffID,
        sourceProjectID,
        projectID,
        requestedWorkIDs: selectedIDs,
        work,
        predecessors,
      })
    }

    function receiveHandoff(operation: Extract<Operation, { type: "delegate.receive"; kind: "handoff" }>) {
      requireSourceHome(operation.sourceHome)
      if (operation.payload.work.some((item) => item.deliveryMode === "local-only"))
        throw new Error("Local-only work must stay in the main home")
      if (
        !operation.payload.work.length ||
        new Set(operation.payload.work.map((item) => item.destinationID)).size !== operation.payload.work.length
      )
        throw new Error("Handoff has duplicate or empty destination work")
      const known = new Set(operation.payload.work.map((item) => item.destinationID))
      operation.payload.predecessors.forEach((previous) => {
        if (previous.state !== "done" || (previous.when === "landed" && previous.landed === undefined))
          throw new Error(`Unsatisfied source dependency: ${previous.id}`)
      })
      operation.payload.work.forEach((item) =>
        item.dependencies.forEach((dependency) => {
          if (!known.has(dependency.id)) throw new Error(`Unknown received work dependency: ${dependency.id}`)
        }),
      )
      const received = input.store.delegates.receive(
        { id: operation.id, sourceHome: operation.sourceHome, payload: operation.payload },
        () => {
          const project = input.store.projects.get(operation.payload.projectID)
          if (!project || project.archived)
            throw new Error(`Destination project is unavailable: ${operation.payload.projectID}`)
          operation.payload.work.forEach((item) =>
            input.store.backlog.enqueue({
              id: item.destinationID,
              projectID: operation.payload.projectID,
              kind: item.kind,
              brief: item.brief,
              deliveryMode: item.deliveryMode,
              mergePolicy: item.mergePolicy,
              policyProvenance: item.policyProvenance,
              classification: item.classification,
              overrides: {
                ...item.overrides,
                permissions: item.overrides.permissions?.map((permission) => ({ ...permission })),
              },
              dependencies: item.dependencies.map((dependency) => ({ ...dependency })),
              resources: [...item.resources],
              priority: item.priority,
              notBefore: item.notBefore,
            }),
          )
          return {
            id: operation.id,
            projectID: operation.payload.projectID,
            work: operation.payload.work.map((item) => ({
              sourceID: item.sourceID,
              destinationID: item.destinationID,
            })),
          }
        },
      )
      void Promise.resolve()
        .then(() => input.notify?.())
        .catch(() => {})
      return received.receipt
    }

    function destinationStatus(id: string) {
      const received = input.store.delegates.received(id)
      if (!received) return { found: false }
      const payload = Schema.decodeUnknownSync(Payload)(received.payload)
      const receipt = Schema.decodeUnknownSync(Receipt)(received.receipt)
      const work = payload.work.map((item) => {
        const current = input.store.backlog.get(item.destinationID)
        if (!current) throw new Error(`Received work disappeared: ${item.destinationID}`)
        const report =
          current.state === "done" && item.kind === "scout" ? acceptedScoutReport(input.store, current) : undefined
        return {
          sourceID: item.sourceID,
          destinationID: item.destinationID,
          state: current.state,
          landed: current.landed,
          report,
        }
      })
      if (work.some((item) => item.state === "cancelled")) return { found: true, receipt, work, state: "failed" }
      if (work.every((item) => item.state === "done"))
        return { found: true, receipt, work, state: "completed", result: { receipt, work } }
      return { found: true, receipt, work, state: "running" }
    }

    async function cancelDestination(id: string) {
      const received = input.store.delegates.received(id)
      if (!received) return { found: false }
      const payload = Schema.decodeUnknownSync(Payload)(received.payload)
      for (const item of payload.work) {
        const current = input.store.backlog.get(item.destinationID)
        if (!current) throw new Error(`Received work disappeared: ${item.destinationID}`)
        if (current.state === "queued") input.store.backlog.cancel(item.destinationID)
        if (current.state === "in-flight") {
          if (!input.cancelWork) throw new Error(`Native cancellation is unavailable for ${item.destinationID}`)
          await input.cancelWork(item.destinationID)
        }
      }
      return destinationStatus(id)
    }

    async function advance(handoff: SupervisorDelegates.Handoff) {
      if (handoff.cancelRequested) return advanceCancellation(handoff)
      if (handoff.state === "completed" || handoff.state === "failed") return handoff
      const delegate = requireDelegate(handoff.delegateID)
      const receivedID = routeID(home, handoff.id)
      const expected = Schema.decodeUnknownSync(Payload)(handoff.payload)
      if (handoff.state === "pending") {
        if (input.syncShared) {
          const shared = await input.syncShared(delegate)
          if (shared.state === "unknown") return input.store.delegates.markUnknown(handoff.id, shared.error)
          if (shared.state === "error") return input.store.delegates.fail(handoff.id, shared.error)
        }
        const delivered = await request(delegate, {
          type: "delegate.receive",
          kind: "handoff",
          id: receivedID,
          sourceHome: home,
          payload: expected,
        })
        if (delivered.state === "unknown") return input.store.delegates.markUnknown(handoff.id, delivered.error)
        if (delivered.state === "error") return input.store.delegates.fail(handoff.id, delivered.error)
        input.store.delegates.ackReceived(handoff.id, requireReceipt(delivered.result, expected, receivedID))
      }
      const queried = await request(delegate, { type: "delegate.status", receivedID })
      if (queried.state === "unknown") return input.store.delegates.markUnknown(handoff.id, queried.error)
      if (queried.state === "error") return input.store.delegates.markUnknown(handoff.id, queried.error)
      const status = Schema.decodeUnknownSync(DestinationStatus)(queried.result)
      if (!status.found) return input.store.delegates.markUnknown(handoff.id, "Destination has no handoff receipt")
      requireDestinationMapping(status, expected, receivedID)
      input.store.delegates.ackReceived(handoff.id, requireReceipt(status.receipt, expected, receivedID))
      if (status.state === "failed") return input.store.delegates.fail(handoff.id, "Destination work was cancelled")
      if (status.state !== "completed") return input.store.delegates.handoff(handoff.id)!
      if (!status.result) throw new Error(`Destination omitted completed result: ${handoff.id}`)
      const result = Schema.decodeUnknownSync(Result)(status.result)
      if (
        JSON.stringify(result.receipt) !== JSON.stringify(status.receipt) ||
        result.work.length !== expected.work.length ||
        result.work.some((item) => item.state !== "done") ||
        JSON.stringify(result.work) !== JSON.stringify(status.work)
      )
        throw new Error(`Destination returned conflicting result: ${handoff.id}`)
      const completed = input.store.delegates.complete(handoff.id, result, () => {
        result.work.forEach((item) =>
          input.store.backlog.settleDelegated({
            id: item.sourceID,
            handoffID: handoff.id,
            landed:
              item.landed === undefined
                ? undefined
                : {
                    delegateID: handoff.delegateID,
                    handoffID: handoff.id,
                    receipt: result.receipt,
                    destinationWorkID: item.destinationID,
                    destinationLanded: item.landed,
                  },
          }),
        )
      })
      if (input.store.lead()?.active)
        input.store.enqueueNotice({
          key: `delegate-result:${handoff.id}`,
          payload: { text: `Delegate ${handoff.delegateID} finished handoff ${handoff.id}.`, delivery: "queue" },
        })
      return completed
    }

    async function advanceCancellation(handoff: SupervisorDelegates.Handoff) {
      if (handoff.result !== undefined) return handoff
      const delegate = requireDelegate(handoff.delegateID)
      const receivedID = routeID(home, handoff.id)
      const expected = Schema.decodeUnknownSync(Payload)(handoff.payload)
      const queried = await request(delegate, { type: "delegate.status", receivedID })
      if (queried.state !== "ok") return input.store.delegates.markUnknown(handoff.id, queried.error)
      const initial = Schema.decodeUnknownSync(DestinationStatus)(queried.result)
      if (!initial.found)
        return input.store.delegates.markUnknown(
          handoff.id,
          "Destination has no receipt; prior admission may still arrive, so source work remains delegated",
        )
      requireDestinationMapping(initial, expected, receivedID)
      const cancelled = await request(delegate, { type: "delegate.cancel", receivedID })
      if (cancelled.state !== "ok") return input.store.delegates.markUnknown(handoff.id, cancelled.error)
      const status = Schema.decodeUnknownSync(DestinationStatus)(cancelled.result)
      if (!status.found)
        return input.store.delegates.markUnknown(handoff.id, "Destination receipt vanished during cancellation")
      requireDestinationMapping(status, expected, receivedID)
      if (!status.work.every((item) => item.state === "done" || item.state === "cancelled"))
        return input.store.delegates.handoff(handoff.id)!
      const result = { receipt: status.receipt, work: status.work }
      const apply = () => {
        status.work.forEach((item) => {
          if (item.state === "cancelled")
            return input.store.backlog.settleDelegatedCancelled({ id: item.sourceID, handoffID: handoff.id })
          return input.store.backlog.settleDelegated({
            id: item.sourceID,
            handoffID: handoff.id,
            landed:
              item.landed === undefined
                ? undefined
                : {
                    delegateID: handoff.delegateID,
                    handoffID: handoff.id,
                    receipt: result.receipt,
                    destinationWorkID: item.destinationID,
                    destinationLanded: item.landed,
                  },
          })
        })
      }
      const settled = status.work.every((item) => item.state === "done")
        ? input.store.delegates.complete(handoff.id, result, apply)
        : input.store.delegates.cancelled(handoff.id, status.receipt, result, apply)
      if (input.store.lead()?.active)
        input.store.enqueueNotice({
          key: `delegate-cancelled:${handoff.id}`,
          payload: {
            text: `Delegate ${handoff.delegateID} settled handoff ${handoff.id} after cancellation.`,
            delivery: "queue",
          },
        })
      return settled
    }

    async function reconcile(options?: { limit?: number; minAgeMs?: number }) {
      const limit = options?.limit ?? 8
      const minAgeMs = options?.minAgeMs ?? 2000
      const pending = input.store.delegates
        .outstanding()
        .filter((handoff) => Date.now() - handoff.updatedAt >= minAgeMs)
        .slice(0, limit)
      return Promise.all(pending.map(advance))
    }

    return { handle, reconcile }
  }

  function requireReceipt(value: unknown, payload: typeof Payload.Type, id: string) {
    const receipt = Schema.decodeUnknownSync(Receipt)(value)
    if (
      receipt.id !== id ||
      receipt.projectID !== payload.projectID ||
      receipt.work.length !== payload.work.length ||
      receipt.work.some(
        (item, index) =>
          item.sourceID !== payload.work[index]?.sourceID || item.destinationID !== payload.work[index]?.destinationID,
      )
    )
      throw new Error(`Destination returned conflicting handoff receipt: ${payload.sourceHandoffID}`)
    return receipt
  }

  function requireDestinationMapping(
    status: Extract<typeof DestinationStatus.Type, { found: true }>,
    payload: typeof Payload.Type,
    id: string,
  ) {
    requireReceipt(status.receipt, payload, id)
    if (
      status.work.length !== payload.work.length ||
      status.work.some(
        (item, index) =>
          item.sourceID !== payload.work[index]?.sourceID ||
          item.destinationID !== payload.work[index]?.destinationID ||
          (item.state === "done" && payload.work[index]?.kind === "scout" && !item.report) ||
          (item.report !== undefined && (item.state !== "done" || payload.work[index]?.kind !== "scout")),
      )
    )
      throw new Error(`Destination returned conflicting work status: ${payload.sourceHandoffID}`)
  }

  function acceptedScoutReport(store: Store, item: NonNullable<ReturnType<Store["backlog"]["get"]>>) {
    if (!item.taskID) throw new Error(`Completed delegated scout has no native task: ${item.id}`)
    const task = store.task(item.taskID)
    if (task?.status !== "completed") throw new Error(`Delegated scout task is not complete: ${item.id}`)
    const receipt = store
      .receipts(item.taskID)
      .filter((entry) => entry.kind === "scout")
      .at(-1)
    if (!receipt) throw new Error(`Completed delegated scout has no accepted receipt: ${item.id}`)
    return Schema.decodeUnknownSync(Report)(receipt)
  }

  function requireOperator(actor: Actor) {
    if (!("operator" in actor))
      throw new Error("Delegate configuration and inbound transport require operator authority")
  }

  function requireSourceHome(home: string) {
    if (!path.isAbsolute(home) || home.includes("\0")) throw new Error("Source home must be an absolute path")
  }

  function routeID(home: string, id: string) {
    return `dh_${createHash("sha256").update(`${home}\0${id}`).digest("hex").slice(0, 40)}`
  }
}
