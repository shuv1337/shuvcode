export * as SubagentRecovery from "./subagent-recovery.js"

import { createHash } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import { SessionEvent } from "./event.js"
import { SessionMessage } from "./message.js"
import type { Session } from "../session.js"
import { SessionSchema } from "./schema.js"
import { SubagentCompletion } from "./subagent-completion.js"

const decode = Schema.decodeUnknownOption(SessionEvent.Tool.SubagentPrepared.data.fields.recovery)

/** The confirmed call's original input is the immutable authority, not a later tool invocation. */
export const digest = (input: Record<string, unknown>) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(input).filter(([key, value]) => !(["model", "sessionID"].includes(key) && value === "")),
        ),
      ),
    )
    .digest("hex")

export const notificationID = (operation: { childSessionID: SessionSchema.ID; inboxID: SessionMessage.ID }) =>
  SessionMessage.ID.make(
    `msg_${createHash("sha256").update(`${operation.childSessionID}:${operation.inboxID}:notification`).digest("hex")}`,
  )

export const prepared = (tool: SessionMessage.AssistantTool) => {
  if (tool.name !== "subagent" || tool.state.status !== "running") return
  const value = decode(tool.state.metadata.recovery)
  if (Option.isNone(value) || value.value.inputDigest !== digest(tool.state.input)) return
  return value.value
}

/** A terminal child execution after this exact admitted prompt is reusable without running the child again. */
export const settled = Effect.fn("SubagentRecovery.settled")(function* (
  sessions: Pick<Session.Interface, "messages">,
  childID: SessionSchema.ID,
  inboxID: SessionMessage.ID,
) {
  const messages = yield* sessions.messages({ sessionID: childID, order: "asc" })
  const admitted = messages.findIndex((message) => message.id === inboxID && message.type === "user")
  if (admitted < 0) return
  const following = messages.slice(admitted + 1)
  const nextPrompt = following.findIndex((message) => message.type === "user")
  const tail = nextPrompt < 0 ? following : following.slice(0, nextPrompt)
  const idle = tail.findLastIndex((message) => message.type === "idle")
  if (idle < 0) return
  const outcome = tail[idle]
  if (outcome.type !== "idle") return
  return {
    status: outcome.outcome,
    output: SubagentCompletion.text(
      tail.slice(0, idle).findLast((message) => message.type === "assistant" && message.time.completed !== undefined),
    ),
  }
})
