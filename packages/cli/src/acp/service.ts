import { isSessionNotFoundError, type CommandInfo, type ModelRef, type OpenCodeClient } from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Option, Ref, Stream, type Scope } from "effect"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import type {
  AgentConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  AuthMethod,
  CancelNotification,
  CloseSessionRequest,
  CloseSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  RequestError,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { OPENCODE_VERSION } from "../version"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ACPCatalog, Catalog } from "./catalog"
import { DEFAULT_VARIANT_VALUE, parseModelSelection } from "./config-option"
import { ACPConnection } from "./connection"
import { promptContentToParts } from "./content"
import {
  ChildSessionUpdateMethod,
  ChildSessionUpdatesCapability,
  replayMessages,
  streamTurn,
  type ChildSessionUpdate,
  type TurnControl,
  type TurnStart,
} from "./event"
import { ACPError } from "./error"
import { ACPSessions, builtinCommands, type Attached } from "./sessions"

export const AuthMethodID = "opencode-login"

type PreparedPrompt = {
  readonly start: TurnStart
  readonly text: string
  readonly files: Array<{ readonly uri: string; readonly name?: string }>
  readonly synthetic: ReadonlyArray<string>
  readonly slash?: { readonly name: string; readonly args: string }
  readonly command?: CommandInfo
}

export type Failure = ACPError.Error | RequestError | ACPCatalog.Error

export interface Interface {
  readonly initialize: (input: InitializeRequest) => Effect.Effect<InitializeResponse>
  readonly authenticate: (input: AuthenticateRequest) => Effect.Effect<AuthenticateResponse, Failure>
  readonly newSession: (input: NewSessionRequest) => Effect.Effect<NewSessionResponse, Failure>
  readonly loadSession: (input: LoadSessionRequest) => Effect.Effect<LoadSessionResponse, Failure>
  readonly listSessions: (input: ListSessionsRequest) => Effect.Effect<ListSessionsResponse, Failure>
  readonly deleteSession: (input: DeleteSessionRequest) => Effect.Effect<DeleteSessionResponse, Failure>
  readonly resumeSession: (input: ResumeSessionRequest) => Effect.Effect<ResumeSessionResponse, Failure>
  readonly forkSession: (input: ForkSessionRequest) => Effect.Effect<ForkSessionResponse, Failure>
  readonly setSessionConfigOption: (
    input: SetSessionConfigOptionRequest,
  ) => Effect.Effect<SetSessionConfigOptionResponse, Failure>
  readonly setSessionMode: (input: SetSessionModeRequest) => Effect.Effect<SetSessionModeResponse, Failure>
  closeSession(input: CloseSessionRequest): Promise<CloseSessionResponse>
  prompt(input: PromptRequest, signal?: AbortSignal): Promise<PromptResponse>
  cancel(input: CancelNotification): Promise<void>
}

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OpenCodeClient
  readonly connection: AgentConnection
  readonly catalog: ACPCatalog.Interface
  readonly run: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Promise<A>
}) {
  const connection = ACPConnection.service(input.connection)
  // The turn still runs on promises.
  const turnConnection = ACPConnection.make(input.connection)
  const sessions = yield* ACPSessions.make({ client: input.client, connection, catalog: input.catalog })
  const capabilities = yield* Ref.make({ childSessionUpdates: false })
  const active = new Map<string, { readonly control: TurnControl; readonly turn: Promise<PromptResponse> }>()

  const configOptions = Effect.fnUntraced(function* (attached: Attached) {
    const catalog = yield* input.catalog.get(attached.cwd)
    return ACPSessions.configOptions(catalog, yield* Ref.get(attached.selection))
  })

  // A selection the catalog has not seen may be new on the server, so reload once before rejecting it.
  const withReload = <A>(attached: Attached, select: Effect.Effect<A, Failure>) => {
    const retry = () => input.catalog.reload(attached.cwd).pipe(Effect.andThen(select))
    return select.pipe(
      Effect.catchTags({ ACPInvalidModelError: retry, ACPInvalidModeError: retry, ACPInvalidEffortError: retry }),
    )
  }

  const selectOption = Effect.fnUntraced(function* (attached: Attached, configId: string, value: string) {
    if (configId === "mode") return yield* selectMode(attached, value)
    if (configId !== "model" && configId !== "effort") return yield* new ACPError.InvalidConfigOptionError({ configId })
    const catalog = yield* input.catalog.get(attached.cwd)
    const current = ACPSessions.currentModel(catalog, yield* Ref.get(attached.selection))
    const model =
      configId === "model"
        ? yield* requireModel(catalog, value, current)
        : yield* requireEffort(catalog, value, current)
    yield* Ref.update(attached.selection, (selection) => ({ ...selection, model }))
    yield* ACPError.promise(() => input.client.session.switchModel({ sessionID: attached.id, model }))
  })

  const selectMode = Effect.fnUntraced(function* (attached: Attached, modeID: string) {
    const catalog = yield* input.catalog.get(attached.cwd)
    if (!catalog.modes.some((mode) => mode.id === modeID)) return yield* new ACPError.InvalidModeError({ mode: modeID })
    yield* Ref.update(attached.selection, (selection) => ({ ...selection, modeID }))
    yield* ACPError.promise(() => input.client.session.switchAgent({ sessionID: attached.id, agent: modeID }))
  })

  const getSession = Effect.fnUntraced(function* (sessionID: string, cwd: string) {
    const session = yield* ACPError.promise(() => input.client.session.get({ sessionID }).catch(notFound(sessionID)))
    if (FSUtil.resolve(cwd) !== FSUtil.resolve(session.location.directory))
      return yield* new ACPError.SessionDirectoryMismatchError({ sessionId: sessionID, cwd })
    return session
  })

  const replay = (attached: Attached) =>
    Stream.paginate(Option.none<string>(), (cursor) =>
      ACPError.promise(() =>
        Option.isSome(cursor)
          ? input.client.message.list({ sessionID: attached.id, limit: 200, cursor: cursor.value })
          : input.client.message.list({ sessionID: attached.id, limit: 200, order: "asc" }),
      ).pipe(
        Effect.map(
          (page) => [page.data, Option.fromNullishOr(page.cursor.next).pipe(Option.map(Option.some))] as const,
        ),
      ),
    ).pipe(
      Stream.runCollect,
      Effect.flatMap((messages) =>
        ACPError.promise(() => replayMessages(turnConnection, attached.id, attached.cwd, messages)),
      ),
    )

  const sendUsageUpdate = Effect.fnUntraced(function* (attached: Attached, used: number | undefined) {
    if (!used) return
    const catalog = yield* input.catalog.get(attached.cwd)
    const current = ACPSessions.currentModel(catalog, yield* Ref.get(attached.selection))
    const model = catalog.models.find((item) => item.providerID === current.providerID && item.id === current.id)
    if (!model?.limit.context) return
    const info = yield* ACPError.promise(() => input.client.session.get({ sessionID: attached.id }))
    yield* connection.sessionUpdate({
      sessionId: attached.id,
      update: {
        sessionUpdate: "usage_update",
        used,
        size: model.limit.context,
        cost: { amount: info.cost, currency: "USD" },
      },
    })
  })

  const cancelTurn = (sessionID: string) => {
    const turn = active.get(sessionID)
    if (turn) {
      turn.control.cancelled = true
      turn.control.admission.abort()
    }
    return input.client.session.interrupt({ sessionID })
  }

  return {
    initialize: Effect.fnUntraced(function* (params) {
      yield* Ref.set(capabilities, {
        childSessionUpdates: params.clientCapabilities?._meta?.[ChildSessionUpdatesCapability] === true,
      })
      const authMethod: AuthMethod = {
        description: "Run `opencode auth login` in the terminal",
        name: "Login with opencode",
        id: AuthMethodID,
      }
      if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
        authMethod._meta = {
          "terminal-auth": { command: "opencode", args: ["auth", "login"], label: "OpenCode Login" },
        }
      }
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true, sse: false },
          promptCapabilities: { embeddedContext: true, image: true },
          sessionCapabilities: { close: {}, delete: {}, fork: {}, list: {}, resume: {} },
          _meta: { [ChildSessionUpdatesCapability]: true },
        },
        authMethods: [authMethod],
        agentInfo: { name: "OpenCode", version: OPENCODE_VERSION },
      }
    }),
    authenticate: Effect.fnUntraced(function* (params) {
      if (params.methodId !== AuthMethodID)
        return yield* new ACPError.UnknownAuthMethodError({ methodId: params.methodId })
      return {}
    }),
    newSession: Effect.fnUntraced(function* (params) {
      // Load before creating so a catalog failure leaves no session behind. Agent and model stay unset
      // so the server resolves its defaults after plugins activate.
      yield* input.catalog.get(params.cwd)
      const created = yield* ACPError.promise(() =>
        input.client.session.create({ location: { directory: params.cwd } }),
      )
      const attached = yield* sessions.attach(created, params.cwd, params.mcpServers)
      return { sessionId: attached.id, configOptions: yield* configOptions(attached) }
    }),
    loadSession: Effect.fnUntraced(function* (params) {
      const session = yield* getSession(params.sessionId, params.cwd)
      const attached = yield* sessions.attach(session, session.location.directory, params.mcpServers)
      yield* replay(attached)
      return { configOptions: yield* configOptions(attached) }
    }),
    listSessions: Effect.fnUntraced(function* (params) {
      const page = yield* ACPError.promise(() =>
        input.client.session.list({
          ...(params.cwd ? { directory: params.cwd } : {}),
          order: "desc",
          limit: 100,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        }),
      )
      return {
        sessions: page.data.map((session) => ({
          sessionId: session.id,
          cwd: session.location.directory,
          title: withTimestampedFallback(session),
          updatedAt: new Date(session.time.updated).toISOString(),
        })),
        ...(page.cursor.next ? { nextCursor: page.cursor.next } : {}),
      }
    }),
    deleteSession: Effect.fnUntraced(function* (params) {
      yield* ACPError.promise(() =>
        input.client.session.remove({ sessionID: params.sessionId }).catch(notFound(params.sessionId)),
      ).pipe(Effect.catchTag("ACPSessionNotFoundError", () => Effect.void))
      yield* sessions.detach(params.sessionId)
      return {}
    }),
    resumeSession: Effect.fnUntraced(function* (params) {
      const session = yield* getSession(params.sessionId, params.cwd)
      const attached = yield* sessions.attach(session, session.location.directory, params.mcpServers ?? [])
      return { configOptions: yield* configOptions(attached) }
    }),
    forkSession: Effect.fnUntraced(function* (params) {
      const forked = yield* ACPError.promise(() => input.client.session.fork({ sessionID: params.sessionId }))
      const attached = yield* sessions.attach(forked, forked.location.directory, params.mcpServers ?? [])
      yield* replay(attached)
      return { sessionId: attached.id, configOptions: yield* configOptions(attached) }
    }),
    setSessionConfigOption: Effect.fnUntraced(function* (params) {
      const attached = yield* sessions.require(params.sessionId)
      const value = params.value
      if (typeof value !== "string") return yield* new ACPError.InvalidConfigOptionError({ configId: params.configId })
      yield* withReload(attached, selectOption(attached, params.configId, value))
      return { configOptions: yield* configOptions(attached) }
    }),
    setSessionMode: Effect.fnUntraced(function* (params) {
      const attached = yield* sessions.require(params.sessionId)
      yield* withReload(attached, selectMode(attached, params.modeId))
      return {}
    }),
    closeSession: async (params) => {
      const turn = active.get(params.sessionId)
      await cancelTurn(params.sessionId).catch((error) => {
        if (!isSessionNotFoundError(error)) throw error
      })
      await turn?.turn.catch(() => {})
      await input.run(sessions.detach(params.sessionId))
      return {}
    },
    prompt: async (params, signal) => {
      // Read everything first so the active check and registration below stay synchronous.
      const resolved = await input.run(
        Effect.gen(function* () {
          const attached = yield* sessions.require(params.sessionId)
          return {
            attached,
            catalog: yield* input.catalog.get(attached.cwd),
            childSessionUpdates: (yield* Ref.get(capabilities)).childSessionUpdates,
          }
        }),
      )
      const state = resolved.attached
      if (active.has(state.id)) {
        throw new ACPError.ServiceFailureError({
          safeMessage: `Session already has an active ACP prompt: ${state.id}`,
          service: "session",
        })
      }
      const messageID = SessionMessage.ID.create()
      const prepared = preparePrompt(resolved.catalog, params.prompt, messageID)
      const control: TurnControl = { cancelled: false, admission: new AbortController() }
      const extNotification = turnConnection.extNotification
      const childSessionUpdate =
        resolved.childSessionUpdates && extNotification
          ? (update: ChildSessionUpdate) => extNotification(ChildSessionUpdateMethod, update).then(() => {})
          : undefined
      // A `$/cancel_request` for this prompt behaves like `session/cancel` for its turn.
      const cancel = () => void cancelTurn(state.id).catch(() => {})
      const turn = streamTurn({
        client: input.client,
        connection: turnConnection,
        sessionID: state.id,
        cwd: state.cwd,
        start: prepared.start,
        action: prepared.command !== undefined,
        control,
        connectionSignal: turnConnection.signal,
        sessionSignal: state.signal,
        submit: (signal) => submitPrompt(input.client, state, prepared, signal),
        ...(childSessionUpdate ? { childSessionUpdate } : {}),
      })
        .then(async (result) => {
          await input.run(sendUsageUpdate(state, result.contextTokens)).catch(() => {})
          return result.response
        })
        .finally(() => {
          signal?.removeEventListener("abort", cancel)
          if (active.get(state.id)?.control === control) active.delete(state.id)
        })
      active.set(state.id, { control, turn })
      signal?.addEventListener("abort", cancel, { once: true })
      // The cancel may already be buffered behind the awaits above.
      if (signal?.aborted) cancel()
      return turn
    },
    cancel: async (params) => {
      await cancelTurn(params.sessionId).catch(() => {})
    },
  } satisfies Interface
})

function notFound(sessionID: string) {
  return (error: unknown): never => {
    throw isSessionNotFoundError(error) ? new ACPError.SessionNotFoundError({ sessionId: sessionID }) : error
  }
}

function preparePrompt(catalog: Catalog, prompt: PromptRequest["prompt"], messageID: string): PreparedPrompt {
  const parts = promptContentToParts(prompt)
  const visible = parts.filter((part) => part.type !== "text" || (!part.synthetic && !part.ignored))
  const synthetic = parts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : []))
  const text = visible.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const files = visible.flatMap((part) => (part.type === "file" ? [{ uri: part.url, name: part.filename }] : []))
  const slash = detectSlashCommand(text)
  const command =
    slash && !builtinCommands.has(slash.name) ? catalog.commands.find((item) => item.name === slash.name) : undefined
  const start = turnStart(messageID, slash)
  return { start, text, files, synthetic, slash, command }
}

async function submitPrompt(client: OpenCodeClient, session: Attached, prompt: PreparedPrompt, signal: AbortSignal) {
  if (prompt.synthetic.length > 0) {
    await client.session.synthetic({
      sessionID: session.id,
      text: prompt.synthetic.join("\n\n"),
      description: "ACP embedded context",
      delivery: "steer",
      resume: false,
    })
  }
  if (prompt.start.type === "compaction") return client.session.compact({ sessionID: session.id, id: prompt.start.id })
  if (prompt.command) {
    return client.session.command(
      {
        sessionID: session.id,
        name: prompt.command.name,
        text: prompt.slash?.args ?? "",
        files: prompt.files,
        delivery: "steer",
      },
      { signal },
    )
  }
  return client.session.prompt(
    { sessionID: session.id, id: prompt.start.id, text: prompt.text, files: prompt.files, delivery: "steer" },
    { signal },
  )
}

function turnStart(messageID: string, slash: PreparedPrompt["slash"]): TurnStart {
  if (slash && builtinCommands.get(slash.name)?.start === "compaction") return { type: "compaction", id: messageID }
  return { type: "input", id: messageID }
}

const requireModel = Effect.fnUntraced(function* (catalog: Catalog, modelID: string, current: ModelRef) {
  const selected = parseModelSelection(modelID, catalog.providers)
  const model = catalog.models.find(
    (item) => item.providerID === selected.model.providerID && item.id === selected.model.modelID,
  )
  if (!model) return yield* new ACPError.InvalidModelError({ providerId: selected.model.providerID, modelId: modelID })
  if (selected.variant && !model.variants.some((variant) => variant.id === selected.variant))
    return yield* new ACPError.InvalidEffortError({ effort: selected.variant })
  const variant =
    selected.variant ??
    (current.providerID === model.providerID &&
    current.id === model.id &&
    (current.variant === DEFAULT_VARIANT_VALUE || model.variants.some((variant) => variant.id === current.variant))
      ? current.variant
      : undefined)
  return { providerID: model.providerID, id: model.id, variant } satisfies ModelRef
})

const requireEffort = Effect.fnUntraced(function* (catalog: Catalog, effort: string, current: ModelRef) {
  const model = catalog.models.find((item) => item.providerID === current.providerID && item.id === current.id)
  if (!model || (effort !== DEFAULT_VARIANT_VALUE && !model.variants.some((variant) => variant.id === effort)))
    return yield* new ACPError.InvalidEffortError({ effort })
  return { ...current, variant: effort } satisfies ModelRef
})

function detectSlashCommand(text: string): { readonly name: string; readonly args: string } | undefined {
  const value = text.trim()
  if (!value.startsWith("/")) return undefined
  const [name, ...rest] = value.slice(1).split(/\s+/)
  if (!name) return undefined
  return { name, args: rest.join(" ").trim() }
}

export * as ACPService from "./service"
