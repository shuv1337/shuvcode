import { isDeepStrictEqual } from "node:util"
import type { McpServer, RequestError } from "@agentclientprotocol/sdk"
import type { ModelRef, OpenCodeClient, SessionInfo } from "@opencode/client/promise"
import { Cause, Context, Effect, Exit, Ref, Scope, Stream } from "effect"
import type { ACPCatalog, Catalog } from "./catalog"
import { buildConfigOptions } from "./config-option"
import type { ACPConnection } from "./connection"
import { ACPError } from "./error"

// ACP runs these itself; they take precedence over server commands with the same name.
export const builtinCommands = new Map([
  ["compact", { description: "Compact the session", start: "compaction" as const }],
])

/** Unset fields follow the server defaults. */
export type Selection = {
  readonly model?: ModelRef
  readonly modeID?: string
}

export type Attached = {
  readonly id: string
  readonly cwd: string
  readonly selection: Ref.Ref<Selection>
  /** Aborted when the session detaches, for the promise-based turn. */
  readonly signal: AbortSignal
}

export interface Interface {
  /**
   * Attaches a session in its own scope, closing any previous attachment of the same ID. The scope follows the
   * cwd's catalog and pushes config option and command updates while it is open.
   */
  readonly attach: (
    session: SessionInfo,
    cwd: string,
    mcpServers: readonly McpServer[],
  ) => Effect.Effect<Attached, ACPError.Error | RequestError | ACPCatalog.Error>
  /** Closes the session scope. No-op when the session is not attached. */
  readonly detach: (sessionID: string) => Effect.Effect<void>
  readonly require: (sessionID: string) => Effect.Effect<Attached, ACPError.SessionNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/acp/Sessions") {}

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly catalog: ACPCatalog.Interface
}) {
  const scope = yield* Effect.scope
  const sessions = new Map<string, { readonly attached: Attached; readonly scope: Scope.Closeable }>()
  // Kept across re-attachment so resuming with the same servers does not add them again.
  const registeredMcp = new Map<string, Set<string>>()

  const sendCommands = (sessionID: string, catalog: Catalog) =>
    input.connection.sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          ...catalog.commands
            .filter((command) => !builtinCommands.has(command.name))
            .map((command) => ({ name: command.name, description: command.description ?? "" })),
          ...Array.from(builtinCommands, ([name, command]) => ({ name, description: command.description })),
        ],
      },
    })

  const changed = Effect.fnUntraced(function* (attached: Attached, previous: Catalog, next: Catalog) {
    const selection = yield* Ref.get(attached.selection)
    const options = configOptions(next, selection)
    if (!isDeepStrictEqual(options, configOptions(previous, selection))) {
      yield* input.connection.sessionUpdate({
        sessionId: attached.id,
        update: { sessionUpdate: "config_option_update", configOptions: options },
      })
    }
    if (!isDeepStrictEqual(next.commands, previous.commands)) yield* sendCommands(attached.id, next)
  })

  const registerMcp = (attached: Attached, servers: readonly McpServer[]) =>
    Effect.suspend(() => {
      const registered = registeredMcp.get(attached.id) ?? new Set<string>()
      registeredMcp.set(attached.id, registered)
      return Effect.forEach(
        servers,
        (server) =>
          Effect.suspend(() => {
            const config = mcpConfig(server)
            const key = `${server.name}:${stableStringify(config)}`
            if (registered.has(key)) return Effect.void
            registered.add(key)
            return ACPError.promise(() =>
              input.client.mcp.add({ server: server.name, location: { directory: attached.cwd }, config }),
            ).pipe(
              // An interrupted add still completes on the server, so only a failed one is forgotten.
              Effect.tapCause((cause) =>
                Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => registered.delete(key)),
              ),
            )
          }),
        { concurrency: "unbounded", discard: true },
      )
    })

  return Service.of({
    attach: Effect.fn("cli.acp.sessions.attach")(function* (session, cwd, mcpServers) {
      const current = yield* input.catalog.get(cwd)
      const abort = new AbortController()
      const attached: Attached = {
        id: session.id,
        cwd,
        selection: yield* Ref.make<Selection>({ model: session.model, modeID: session.agent }),
        signal: abort.signal,
      }
      // Swap synchronously so concurrent attaches of one ID cannot both keep a scope.
      const sessionScope = Scope.forkUnsafe(scope)
      const replaced = sessions.get(session.id)
      sessions.set(session.id, { attached, scope: sessionScope })
      if (replaced) yield* Scope.close(replaced.scope, Exit.void)
      yield* Scope.addFinalizer(
        sessionScope,
        Effect.sync(() => abort.abort()),
      )
      yield* input.catalog.changes(cwd).pipe(
        Stream.runFoldEffect(
          () => current,
          (previous, next) =>
            next === previous
              ? Effect.succeed(previous)
              : changed(attached, previous, next).pipe(Effect.ignore, Effect.as(next)),
        ),
        Effect.ignore,
        Effect.forkIn(sessionScope),
      )
      yield* registerMcp(attached, mcpServers)
      yield* sendCommands(attached.id, yield* input.catalog.get(cwd))
      return attached
    }),
    detach: Effect.fn("cli.acp.sessions.detach")(function* (sessionID) {
      const entry = sessions.get(sessionID)
      sessions.delete(sessionID)
      registeredMcp.delete(sessionID)
      if (entry) yield* Scope.close(entry.scope, Exit.void)
    }),
    require: Effect.fn("cli.acp.sessions.require")(function* (sessionID) {
      const entry = sessions.get(sessionID)
      if (!entry) return yield* new ACPError.SessionNotFoundError({ sessionId: sessionID })
      return entry.attached
    }),
  })
})

export function currentModel(catalog: Catalog, selection: Selection) {
  return selection.model ?? catalog.defaultModel
}

export function configOptions(catalog: Catalog, selection: Selection) {
  const model = currentModel(catalog, selection)
  return buildConfigOptions({
    providers: catalog.providers,
    currentModel: { providerID: model.providerID, modelID: model.id },
    currentVariant: model.variant,
    modes: catalog.modes,
    currentModeId: selection.modeID ?? catalog.defaultModeID,
  })
}

function mcpConfig(server: McpServer) {
  if ("type" in server) {
    if (server.type === "acp") throw new Error("MCP-over-ACP is not supported")
    return {
      type: "remote" as const,
      url: server.url,
      headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
      oauth: false as const,
    }
  }
  return {
    type: "local" as const,
    command: [server.command, ...server.args],
    environment: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.entries(value)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

export * as ACPSessions from "./sessions"
