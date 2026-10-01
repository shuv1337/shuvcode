import {
  methods,
  type AgentConnection,
  type RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SendRequestOptions,
  type SessionNotification,
} from "@agentclientprotocol/sdk"
import { Context, type Effect } from "effect"
import { ACPError } from "./error"

type Failure = ACPError.Error | RequestError

export interface Interface {
  readonly sessionUpdate: (params: SessionNotification) => Effect.Effect<void, Failure>
  /** Interrupting the request cancels it on the client. */
  readonly requestPermission: (params: RequestPermissionRequest) => Effect.Effect<RequestPermissionResponse, Failure>
  readonly extNotification: (method: string, params: Record<string, unknown>) => Effect.Effect<void, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Connection") {}

export function service(connection: AgentConnection) {
  return Service.of({
    sessionUpdate: (params) => ACPError.promise(() => connection.client.notify(methods.client.session.update, params)),
    requestPermission: (params) =>
      ACPError.promise((signal) =>
        connection.client.request(methods.client.session.requestPermission, params, { cancellationSignal: signal }),
      ),
    extNotification: (method, params) => ACPError.promise(() => connection.client.notify(method, params)),
  })
}

export type Connection = {
  readonly signal?: AbortSignal
  sessionUpdate(params: SessionNotification): Promise<void>
  requestPermission(params: RequestPermissionRequest, options?: SendRequestOptions): Promise<RequestPermissionResponse>
  extNotification?(method: string, params: Record<string, unknown>): Promise<void>
}

/** Promise view for the turn and permission code until they run as effects. */
export function make(connection: AgentConnection): Connection {
  return {
    signal: connection.signal,
    sessionUpdate: (params) => connection.client.notify(methods.client.session.update, params),
    requestPermission: (params, options) =>
      connection.client.request(methods.client.session.requestPermission, params, options),
    extNotification: (method, params) => connection.client.notify(method, params),
  }
}

export * as ACPConnection from "./connection"
