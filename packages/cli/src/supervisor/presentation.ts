import { Schema } from "effect"
import { SupervisorNative } from "./native"
import { SupervisorSettings } from "./settings"

export namespace SupervisorPresentation {
  const Candidate = Schema.Struct({
    id: Schema.String,
    role: Schema.Literals(["lead", "ship", "scout"]),
    taskID: Schema.optional(Schema.String),
    workID: Schema.optional(Schema.String),
    projectID: Schema.optional(Schema.String),
    title: Schema.String,
    sessionID: Schema.String,
    location: Schema.String,
    lifecycle: Schema.Literals(["active", "cancelling", "cancelled", "completed"]),
    decisions: Schema.Number,
    uncertain: Schema.Boolean,
    retired: Schema.Boolean,
  })
  export const Facts = Schema.Struct({ entries: Schema.Array(Candidate) })
  export const Attachment = Schema.Struct({
    provider: Schema.Literal("shuvcode"),
    home_id: Schema.String,
    session_id: Schema.String,
    location: Schema.String,
    host_id: Schema.String,
    attach_argv: Schema.Array(Schema.String),
  })
  const Entry = Schema.Struct({
    id: Schema.String,
    role: Candidate.fields.role,
    taskID: Schema.optional(Schema.String),
    workID: Schema.optional(Schema.String),
    projectID: Schema.optional(Schema.String),
    title: Schema.String,
    sessionID: Schema.String,
    location: Schema.String,
    state: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
    label: Schema.optional(Schema.String),
    available: Schema.Boolean,
    settled: Schema.Boolean,
    retired: Schema.Boolean,
    attachment: Attachment,
  })
  export const Snapshot = Schema.Struct({
    version: Schema.Literal(1),
    homeID: Schema.String,
    home: Schema.String,
    endpoint: Schema.String,
    observedAt: Schema.Number,
    entries: Schema.Array(Entry),
  })
  export type Snapshot = typeof Snapshot.Type

  export function attachment(input: {
    settings: SupervisorSettings.Value & { home: string }
    sessionID: string
    location: string
    command: readonly string[]
  }): typeof Attachment.Type {
    return {
      provider: "shuvcode",
      home_id: input.settings.pilotID,
      session_id: input.sessionID,
      location: input.location,
      host_id: "local",
      attach_argv: [
        ...input.command,
        "supervisor",
        "attach",
        "--home",
        input.settings.home,
        "--home-id",
        input.settings.pilotID,
        "--session",
        input.sessionID,
        "--location",
        input.location,
      ],
    }
  }

  export async function read(input: {
    settings: SupervisorSettings.Value & { home: string }
    facts: typeof Facts.Type
    native: ReturnType<typeof SupervisorNative.connect>
    command: readonly string[]
  }): Promise<Snapshot> {
    const observations = new Map<string, Promise<SupervisorNative.Session | undefined>>()
    const observe = (id: string) => {
      const existing = observations.get(id)
      if (existing) return existing
      const pending = input.native.get(id).catch(() => undefined)
      observations.set(id, pending)
      return pending
    }
    const root = async (id: string): Promise<string | undefined> => {
      const session = await observe(id)
      if (!session) return undefined
      return session.parentID ? root(session.parentID) : session.id
    }
    const active = await input.native.active().catch(() => undefined)
    const running = active ? await Promise.all(active.map(root)) : undefined
    const sessions = await Promise.all(input.facts.entries.map((entry) => observe(entry.sessionID)))
    const family = await Promise.all(observations.values())
    const locations = await Promise.all(
      [...new Set(family.flatMap((session) => (session ? [session.location.directory] : [])))].map(
        async (directory) => {
          const [permissions, forms] = await Promise.all([
            input.native.permissions(directory).catch(() => undefined),
            input.native.forms(directory).catch(() => undefined),
          ])
          const blocked =
            permissions && forms
              ? await Promise.all([...permissions, ...forms].map((request) => root(request.sessionID)))
              : undefined
          return blocked
        },
      ),
    )
    const blocked = locations.every((items) => items !== undefined) ? locations.flat() : undefined
    return {
      version: 1,
      homeID: input.settings.pilotID,
      home: input.settings.home,
      endpoint: input.settings.endpoint,
      observedAt: Date.now(),
      entries: input.facts.entries.map((entry, index) => {
        const session = sessions[index]
        const location = session?.location.directory ?? entry.location
        const expectedLocation = entry.role === "lead" ? location : entry.location
        const identity = Boolean(session && !session.parentID && location === expectedLocation)
        const available = identity && !entry.retired
        const known = Boolean(
          identity && running && !running.includes(undefined) && blocked && !blocked.includes(undefined),
        )
        const busy = running?.includes(entry.sessionID) ?? false
        const terminal = entry.lifecycle === "completed" || entry.lifecycle === "cancelled"
        const waiting =
          (entry.lifecycle !== "cancelled" && entry.decisions > 0) || (blocked?.includes(entry.sessionID) ?? false)
        const state =
          !known || entry.uncertain ? "unknown" : waiting ? "blocked" : busy ? "working" : terminal ? "done" : "idle"
        return {
          id: entry.id,
          role: entry.role,
          taskID: entry.taskID,
          workID: entry.workID,
          projectID: entry.projectID,
          title: entry.title,
          sessionID: entry.sessionID,
          location,
          state,
          label: entry.retired
            ? "Cleaned up"
            : location !== expectedLocation
              ? "Location changed"
              : state === "unknown"
                ? "Unavailable"
                : entry.lifecycle === "cancelling"
                  ? "Cancelling"
                  : entry.lifecycle === "cancelled"
                    ? "Cancelled"
                    : waiting
                      ? "Needs input"
                      : session?.outcome === "failed"
                        ? "Failed"
                        : session?.outcome === "interrupted"
                          ? "Interrupted"
                          : undefined,
          available,
          settled: terminal && known && !busy && !waiting && !entry.uncertain,
          retired: entry.retired,
          attachment: attachment({
            settings: input.settings,
            sessionID: entry.sessionID,
            location: expectedLocation,
            command: input.command,
          }),
        }
      }),
    }
  }
}
