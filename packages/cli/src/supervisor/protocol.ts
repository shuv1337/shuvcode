import { Schema } from "effect"
import { SupervisorAway } from "./away"
import { SupervisorVoice } from "./voice"
import { SupervisorChannels } from "./channels"
import { SupervisorDeliveryRuntime } from "./delivery-runtime"
import { SupervisorDelegatesRuntime } from "./delegates-runtime"
import { SupervisorKnowledge } from "./knowledge"

export namespace SupervisorProtocol {
  const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000))
  const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/))
  const Generation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  const Task = { taskID: ID }
  const Lead = { generation: Generation }
  export const Model = Schema.Struct({ providerID: Text, modelID: Text, variant: Schema.optional(Text) })
  export const Permission = Schema.Struct({
    action: Text,
    resource: Text,
    effect: Schema.Literals(["allow", "deny", "ask"]),
  })
  export const ProjectMode = Schema.Literals(["no-mistakes", "direct-PR", "local-only", "no-mistakes-prod-only"])
  export const DeliveryMode = Schema.Literals(["no-mistakes", "direct-PR", "local-only"])
  export const MergePolicy = Schema.Literals(["manual", "auto"])
  export const Dependencies = Schema.Array(Schema.Struct({ id: ID, when: Schema.Literals(["done", "landed"]) }))
  export const Hold = Schema.Struct({ reason: Text, until: Schema.optional(Schema.Number) })
  const ProjectPolicy = {
    description: Schema.optional(Schema.String),
    baseRef: Schema.optional(Text),
    mode: Schema.optional(ProjectMode),
    yolo: Schema.optional(Schema.Boolean),
    model: Schema.optional(Model),
    agent: Schema.optional(Text),
    permissions: Schema.optional(Schema.Array(Permission)),
  }
  const WorkPolicy = {
    baseRef: Schema.optional(Text),
    model: Schema.optional(Model),
    agent: Schema.optional(Text),
    permissions: Schema.optional(Schema.Array(Permission)),
    dependencies: Schema.optional(Dependencies),
    resources: Schema.optional(Schema.Array(Text)),
    priority: Schema.optional(Schema.Int),
    notBefore: Schema.optional(Schema.Number),
    hold: Schema.optional(Hold),
  }
  export const Evidence = Schema.Struct({
    kind: Schema.Literals(["ship", "scout"]),
    artifact: Schema.Struct({ relativePath: Text, sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)) }),
    head: Schema.optional(Text),
  })
  export const Operation = Schema.Union([
    SupervisorAway.Operation,
    SupervisorVoice.Operation,
    SupervisorChannels.Operation,
    SupervisorDeliveryRuntime.Operation,
    SupervisorDelegatesRuntime.Operation,
    SupervisorKnowledge.Operation,
    Schema.Struct({ type: Schema.Literal("status"), taskID: Schema.optional(ID) }),
    Schema.Struct({ type: Schema.Literal("project.list"), includeArchived: Schema.optional(Schema.Boolean) }),
    Schema.Struct({
      type: Schema.Literal("project.add"),
      ...Lead,
      id: Schema.optional(ID),
      path: Schema.optional(Text),
      url: Schema.optional(Text),
      initialize: Schema.optional(Schema.Boolean),
      ...ProjectPolicy,
    }),
    Schema.Struct({ type: Schema.Literal("project.update"), ...Lead, id: ID, ...ProjectPolicy }),
    Schema.Struct({ type: Schema.Literal("project.default"), ...Lead, id: ID }),
    Schema.Struct({ type: Schema.Literal("project.archive"), ...Lead, id: ID }),
    Schema.Struct({ type: Schema.Literal("project.restore"), ...Lead, id: ID }),
    Schema.Struct({
      type: Schema.Literal("work.create"),
      ...Lead,
      id: ID,
      projectID: Schema.optional(ID),
      kind: Schema.Literals(["ship", "scout"]),
      brief: Text,
      mode: Schema.optional(DeliveryMode),
      mergePolicy: Schema.optional(MergePolicy),
      classification: Schema.optional(Schema.Literals(["internal", "product", "mixed", "uncertain"])),
      ...WorkPolicy,
    }),
    Schema.Struct({
      type: Schema.Literal("work.update"),
      ...Lead,
      id: ID,
      brief: Schema.optional(Text),
      ...WorkPolicy,
    }),
    Schema.Struct({ type: Schema.Literal("work.hold"), ...Lead, id: ID, ...Hold.fields }),
    Schema.Struct({ type: Schema.Literal("work.release"), ...Lead, id: ID }),
    Schema.Struct({ type: Schema.Literal("work.cancel"), ...Lead, id: ID }),
    Schema.Struct({ type: Schema.Literal("work.retry"), ...Lead, id: ID }),
    Schema.Struct({ type: Schema.Literal("work.dispatch"), ...Lead, id: ID }),
    Schema.Struct({
      type: Schema.Literal("lead.activate"),
      sessionID: Text,
      expectedGeneration: Generation,
      adoptPending: Schema.optional(Schema.Boolean),
    }),
    Schema.Struct({ type: Schema.Literal("lead.revoke"), ...Lead }),
    Schema.Struct({
      type: Schema.Literal("task.create"),
      ...Lead,
      ...Task,
      kind: Schema.Literals(["ship", "scout"]),
      project: Text,
      baseRef: Text,
      brief: Text,
      model: Schema.Struct({ providerID: Text, modelID: Text, variant: Schema.optional(Text) }),
      agent: Text,
      permissions: Schema.Array(
        Schema.Struct({ action: Text, resource: Text, effect: Schema.Literals(["allow", "deny", "ask"]) }),
      ),
    }),
    Schema.Struct({
      type: Schema.Literal("task.send"),
      ...Lead,
      ...Task,
      operationID: ID,
      text: Text,
      delivery: Schema.Literals(["steer", "queue"]),
    }),
    Schema.Struct({ type: Schema.Literal("task.cancel"), ...Lead, ...Task }),
    Schema.Struct({ type: Schema.Literal("task.interrupt"), ...Lead, ...Task }),
    Schema.Struct({
      type: Schema.Literal("task.resume"),
      ...Lead,
      ...Task,
      operationID: ID,
      text: Schema.optional(Text),
    }),
    Schema.Struct({ type: Schema.Literal("task.complete"), ...Lead, ...Task }),
    Schema.Struct({ type: Schema.Literal("task.cleanup"), ...Lead, ...Task, landingRef: Text }),
    Schema.Struct({ type: Schema.Literal("task.discard"), ...Lead, ...Task, reference: Text }),
    Schema.Struct({ type: Schema.Literal("receipt.propose"), ...Task, operationID: ID, evidence: Evidence }),
    Schema.Struct({
      type: Schema.Literal("decision.open"),
      ...Task,
      id: ID,
      question: Text,
      requiredAuthority: Schema.optional(Schema.Literals(["lead", "user"])),
      category: Schema.optional(Schema.Literals(["question", "approval", "blocked"])),
    }),
    Schema.Struct({
      type: Schema.Literal("decision.resolve"),
      ...Lead,
      ...Task,
      id: ID,
      answer: Text,
      expectedQuestion: Schema.optional(Text),
      requestID: Schema.optional(Text),
    }),
  ])
  export type Operation = typeof Operation.Type
  export type Actor = { operator: true } | { sessionID: string }
  export const Request = Schema.Struct({ sessionID: Schema.optional(Text), operation: Operation })
  export const decode = Schema.decodeUnknownSync(Operation)
}
