import { OpenCode } from "@opencode/client"
import { ClientError } from "@opencode/client"
import type {
  ModelRef,
  MessageListInput,
  PermissionRequest,
  PermissionRuleset,
  ServerInfo,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client"
import path from "node:path"

export namespace SupervisorNative {
  export type Model = ModelRef
  export type Permissions = PermissionRuleset
  export type Session = SessionInfo
  export type Message = SessionMessageInfo
  export type PendingPermission = PermissionRequest
  export type Info = ServerInfo
  export type Event = { seq: number; name: string; data: unknown }
  export type InboxItem = { id: string; type: string; delivery: "steer" | "queue"; text?: string }
  export type CreateInput = {
    sessionID: string
    directory: string
    agent: string
    model: Model
    permissions: Permissions
    title?: string
  }
  export type PromptInput = {
    sessionID: string
    id: string
    text: string
    delivery: "steer" | "queue"
    resume: boolean
  }
  export type ConnectInput = { url: string; password?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }

  /** The HTTP request may have committed before the connection failed. Reconcile with this same ID. */
  export class AdmissionOutcomeUnknownError extends Error {
    override readonly name = "AdmissionOutcomeUnknownError"
    constructor(
      readonly operation: "create" | "prompt",
      readonly id: string,
      options?: ErrorOptions,
    ) {
      super(`${operation} outcome unknown for ${id}; reconcile before retrying with the same ID`, options)
    }
  }

  export function connect(input: ConnectInput) {
    const endpoint = new URL(input.url)
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error("Supervisor requires an explicit HTTP endpoint without URL credentials or query parameters")
    if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0))
      throw new Error("Supervisor request timeout must be positive")
    const timeoutMs = input.timeoutMs ?? 15_000
    const client = OpenCode.make({
      baseUrl: endpoint.toString(),
      fetch: input.fetch,
      headers:
        input.password === undefined ? undefined : { authorization: `Basic ${btoa(`opencode:${input.password}`)}` },
    })
    const request = () => ({ signal: AbortSignal.timeout(timeoutMs) })

    return {
      info: () => client.server.info(request()),
      async pluginReady(directory: string, id: string) {
        if (!path.isAbsolute(directory) || !id) throw new Error("Plugin readiness requires a location and plugin ID")
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const plugins = await client.plugin.list(
            { location: { directory } },
            { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) },
          )
          const plugin = plugins.data.find((item) => item.id === id)
          if (plugin?.state.status === "active") return plugin
          if (plugin?.state.status === "failed") throw new Error(`Plugin ${id} failed to activate at ${directory}`)
          await Bun.sleep(50)
        }
        throw new Error(`Plugin ${id} did not activate at ${directory}`)
      },
      async create(options: CreateInput) {
        if (
          !options.sessionID ||
          !path.isAbsolute(options.directory) ||
          !options.agent ||
          !options.model.id ||
          !options.model.providerID
        )
          throw new Error("Supervisor session requires a fixed ID, absolute directory, agent, and provider model")
        let created: SessionInfo
        try {
          created = await client.session.create(
            {
              id: options.sessionID,
              location: { directory: options.directory },
              agent: options.agent,
              model: options.model,
              permissions: options.permissions,
              title: options.title,
            },
            request(),
          )
        } catch (error) {
          if (error instanceof ClientError)
            throw new AdmissionOutcomeUnknownError("create", options.sessionID, { cause: error })
          throw error
        }
        if (created.id !== options.sessionID || created.parentID || created.location.directory !== options.directory)
          throw new Error(`Session ${options.sessionID} has unexpected identity or placement`)
        if (
          created.agent !== options.agent ||
          created.model?.id !== options.model.id ||
          created.model.providerID !== options.model.providerID ||
          (created.model.variant ?? "default") !== (options.model.variant ?? "default")
        )
          throw new Error(`Session ${options.sessionID} has unexpected agent or model`)
        if (JSON.stringify(created.permissions ?? []) !== JSON.stringify(options.permissions))
          throw new Error(`Session ${options.sessionID} has unexpected permissions`)
        return created
      },
      get: (sessionID: string) => client.session.get({ sessionID }, request()),
      messages: (sessionID: string, options: Pick<MessageListInput, "type" | "order" | "limit"> = {}) =>
        client.message.list({ sessionID, order: "asc", ...options }, request()),
      async prompt(options: PromptInput) {
        if (
          !options.sessionID ||
          !options.id ||
          !options.text ||
          (options.delivery !== "steer" && options.delivery !== "queue")
        )
          throw new Error("Supervisor prompt requires session ID, stable item ID, text, and delivery mode")
        try {
          return await client.session.prompt(options, request())
        } catch (error) {
          if (error instanceof ClientError)
            throw new AdmissionOutcomeUnknownError("prompt", options.id, { cause: error })
          throw error
        }
      },
      async inbox(sessionID: string): Promise<InboxItem[]> {
        const items = await client.session.inbox.list({ sessionID }, request())
        return items.map((item) => ({
          id: item.id,
          type: item.type,
          delivery: item.delivery,
          text: item.type === "user" || item.type === "synthetic" ? item.payload.text : undefined,
        }))
      },
      cancel: (input: { sessionID: string; inboxID: string }) => client.session.inbox.cancel(input, request()),
      interrupt: (sessionID: string) => client.session.interrupt({ sessionID }, request()),
      async active() {
        return Object.keys(await client.session.active(request()))
      },
      async permissions(directory: string, sessionID?: string) {
        const pending = await client.permission.request.list({ location: { directory } }, request())
        return pending.data.filter((item) => !sessionID || item.sessionID === sessionID)
      },
      async forms(directory: string) {
        return (await client.form.list({ location: { directory } }, request())).data
      },
      async log(input: {
        sessionID: string
        after?: number
      }): Promise<{ events: Event[]; cursor: number | undefined }> {
        if (input.after !== undefined && (!Number.isSafeInteger(input.after) || input.after < 0))
          throw new Error("Supervisor event cursor must be a nonnegative integer")
        const events: Event[] = []
        const signal = AbortSignal.timeout(timeoutMs)
        for await (const event of client.session.log(
          { sessionID: input.sessionID, after: input.after, follow: false },
          { signal },
        )) {
          if (event.type === "log.synced") {
            if (event.aggregateID !== input.sessionID) throw new Error("Session log returned a different aggregate")
            continue
          }
          if (event.durable.aggregateID !== input.sessionID)
            throw new Error("Session log returned a different aggregate")
          events.push({ seq: event.durable.seq, name: event.type, data: event.data })
        }
        return { events, cursor: events.at(-1)?.seq ?? input.after }
      },
    }
  }
}
