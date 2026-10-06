import { createHash } from "node:crypto"
import path from "node:path"
import { Schema } from "effect"
import { SupervisorSettings } from "./settings"
import type { SupervisorStore } from "./store"

export namespace SupervisorVoice {
  const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000))
  export const Scope = Schema.Literals(["counts", "full"])
  export const Config = Schema.Struct({
    version: Schema.Literal(1),
    region: Schema.optional(Text),
    model: Schema.optional(Text),
    profile: Schema.optional(Schema.String),
    voice: Text,
    scope: Scope,
    deny: Schema.Array(Text),
    python: Text,
  })
  export type Config = typeof Config.Type
  export const Operation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("voice.snapshot") }),
    Schema.Struct({ type: Schema.Literal("voice.enqueue"), interactionID: Text, request: Text }),
  ])
  export type Operation = typeof Operation.Type

  export async function configuration(home: string): Promise<Config> {
    const file = Bun.file(path.join(home, "voice.json"))
    if (!(await file.exists())) return { version: 1, voice: "matthew", scope: "counts", deny: [], python: "python3" }
    return Schema.decodeUnknownSync(Config)(await file.json())
  }

  export async function configure(home: string, input: Partial<Omit<Config, "version">>) {
    const result = Schema.decodeUnknownSync(Config)({
      ...(await configuration(home)),
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    })
    await SupervisorSettings.write(home, "voice.json", result)
    return result
  }

  export function open(input: { home: string; store: ReturnType<typeof SupervisorStore.open> }) {
    async function request(actor: { operator: true } | { sessionID: string }, operation: Operation) {
      if (!("operator" in actor)) throw new Error("Voice access requires the local operator")
      if (operation.type === "voice.enqueue") {
        const id = `voice-${createHash("sha256").update(operation.interactionID).digest("hex")}`
        const existing = input.store.channels.inbox.get(id)
        if (existing && existing.source !== "voice") throw new Error("Voice request identity belongs to another source")
        const note =
          existing ??
          input.store.channels.inbox.note({
            id,
            source: "voice",
            trusted: true,
            text: operation.request,
          })
        return {
          queued: true,
          note_id: note.id,
          queued_text: existing?.text ?? operation.request,
          handover: "The request is queued for the supervisor. It has not started or completed yet.",
        }
      }
      const config = await configuration(input.home)
      const open = input.store.backlog.list().filter((work) => work.state === "queued" || work.state === "in-flight")
      const decisions = open.flatMap((work) =>
        work.taskID
          ? input.store
              .decisions(work.taskID)
              .filter((item) => item.resolution === undefined)
              .map((decision) => ({ work, decision }))
          : [],
      )
      const deliveries = input.store.deliveries
        .list()
        .filter(
          (record) =>
            record.status !== "landed" &&
            record.status !== "cancelled" &&
            open.some((work) => work.taskID === record.taskID),
        )
      const counts = {
        in_flight: open.filter((work) => work.state === "in-flight").length,
        queued: open.filter((work) => work.state === "queued").length,
        waiting_for_user: decisions.filter(({ decision }) =>
          Schema.is(Schema.Struct({ requiredAuthority: Schema.Literal("user") }))(decision.payload),
        ).length,
        open_reviews: deliveries.length,
        workers: input.store.tasks().reduce((result, task) => ({ ...result, [task.status]: result[task.status] + 1 }), {
          active: 0,
          cancelling: 0,
          cancelled: 0,
          completed: 0,
        }),
      }
      if (config.scope === "counts") return { schema_version: 1, read_scope: "counts", counts }
      const listed = open.map((work) => ({
        id: work.id,
        project: work.projectID,
        state: work.state,
        pr: deliveries.find((record) => record.taskID === work.taskID)?.pr?.url,
      }))
      const allowed = listed.filter(
        (item) =>
          !config.deny.some((word) =>
            `${item.id} ${item.project} ${item.pr ?? ""}`.toLowerCase().includes(word.toLowerCase()),
          ),
      )
      return {
        schema_version: 1,
        read_scope: "full",
        counts,
        open: allowed,
        withheld_count: listed.length - allowed.length,
      }
    }
    return { request }
  }
}
