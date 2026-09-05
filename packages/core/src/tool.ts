export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, PolicyDeniedError, TextContent } from "@opencode-ai/schema/tool"
export type { Context, Info, Metadata, Namespace, Options, Result } from "@opencode-ai/schema/tool"

import { ToolDefinition, type ToolCall } from "@opencode-ai/ai"
import { Tool } from "@opencode-ai/schema/tool"
import { Context, Effect, Layer, Result, Schema, SchemaIssue, Types } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import type { Agent } from "./agent.js"
import { CodeModeCatalog } from "./codemode/catalog.js"
import { CodeModeTool } from "./codemode/tool.js"
import { Config } from "./config.js"
import { Image } from "./image.js"
import { Permission } from "./permission.js"
import { PluginHooks } from "./plugin/hooks.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { State } from "./state.js"
import { definition, effectiveName, execute, normalizedName, normalizeContent } from "./tool/runtime.js"
import { Wildcard } from "./util/wildcard.js"
import type { SessionPolicy } from "@opencode-ai/schema/session-policy"

const MAX_METADATA_BYTES = 64 * 1024
const Metadata = Schema.Record(Schema.String, Schema.Json)

export class RegistrationError extends Schema.TaggedError<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export interface Editor {
  readonly list: () => readonly (Tool.Info & { readonly id: string })[]
  readonly get: (id: string) => (Tool.Info & { readonly id: string }) | undefined
  readonly namespace: (namespace: Tool.Namespace) => void
  readonly add: (tool: Tool.Info) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
}

type Data = {
  tools: Map<string, Tool.Info & { readonly id: string }>
  namespaces: Map<string, Tool.Namespace>
  errors: { kind: "tool" | "namespace"; name: string; namespace?: string; error: RegistrationError }[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly snapshot: (
    permissions?: Permission.Ruleset,
    policy?: SessionPolicy.Info,
    session?: ReadonlyArray<Tool.Info>,
  ) => Effect.Effect<Snapshot>
}

/** A local execution result after hooks and content normalization. */
export interface NormalizedResult extends Tool.Result {
  readonly content: ReadonlyArray<Tool.Content>
}

export interface Snapshot {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeCatalog?: CodeModeCatalog.Inventory
  readonly execute: (input: {
    readonly sessionID: SessionSchema.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly call: ToolCall
    readonly progress?: (update: Tool.Metadata) => Effect.Effect<void>
    /** Surviving request definitions, keyed by the names advertised after session context hooks. */
    readonly definitions?: ReadonlyMap<string, ToolDefinition>
  }) => Effect.Effect<NormalizedResult, Tool.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Tool") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const image = yield* Image.Service

    type NormalizedItem = Tool.Content | "decode" | "size"
    const normalizeImages = Effect.fnUntraced(function* (content: ReadonlyArray<Tool.Content>) {
      const normalized = yield* Effect.forEach(content, (item): Effect.Effect<NormalizedItem> => {
        if (item.type !== "file" || !item.mime.startsWith("image/")) return Effect.succeed(item)
        const base64 = /^data:[^,]*;base64,(.*)$/s.exec(item.uri)?.[1]
        if (base64 === undefined) return Effect.succeed(item)
        const resource = item.name ?? `${item.mime} tool output`
        return image.normalize(resource, { uri: resource, content: base64, encoding: "base64", mime: item.mime }).pipe(
          Effect.map((result) => ({
            ...item,
            uri: `data:${result.mime};base64,${result.content}`,
            mime: result.mime,
          })),
          Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(item)),
          Effect.catchTag("Image.DecodeError", () => Effect.succeed("decode" as const)),
          Effect.catchTag("Image.SizeError", () => Effect.succeed("size" as const)),
        )
      })
      const note = (reason: "decode" | "size", text: string) => {
        const count = normalized.filter((item) => item === reason).length
        if (count === 0) return []
        return [{ type: "text" as const, text: `[${count} image${count === 1 ? "" : "s"} omitted: ${text}]` }]
      }
      return [
        ...normalized.filter((item) => typeof item !== "string"),
        ...note("decode", "could not be decoded."),
        ...note("size", "could not be resized below the image size limit."),
      ]
    })

    const beforeExecute = (name: string, input: unknown, context: Tool.Context) =>
      hooks.trigger("tool", "execute.before", {
        tool: name,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      })

    const terminalMetadata = Effect.fn("Tool.terminalMetadata")(function* (
      tool: string,
      callID: string,
      metadata: Tool.Metadata | undefined,
    ) {
      if (metadata === undefined) return undefined
      const validation = (() => {
        try {
          if (!Schema.is(Metadata)(metadata)) return { reason: "not valid JSON" }
          const bytes = Buffer.byteLength(JSON.stringify(metadata), "utf8")
          if (bytes > MAX_METADATA_BYTES) return { reason: "exceeds size limit", bytes }
          return { metadata }
        } catch {
          return { reason: "not valid JSON" }
        }
      })()
      if ("metadata" in validation) return validation.metadata
      yield* Effect.logWarning("Dropping tool result metadata", {
        tool,
        callID,
        reason: validation.reason,
        ...(validation.bytes === undefined ? {} : { bytes: validation.bytes, limit: MAX_METADATA_BYTES }),
      })
      return undefined
    })

    const executeTool = Effect.fn("Tool.execute")(function* (
      tool: Tool.Info,
      name: string,
      input: unknown,
      context: Tool.Context,
    ) {
      const execution = yield* execute(tool, input, context).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (failure) => Effect.succeed({ failure })),
      )
      const base = {
        tool: name,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      }
      if ("failure" in execution) {
        const afterEvent: PluginHooks.Domains["tool"]["execute.after"] = {
          ...base,
          status: "error",
          error: execution.failure,
        }
        yield* hooks.trigger("tool", "execute.after", afterEvent)
        const metadata = yield* terminalMetadata(name, context.id, afterEvent.error.metadata)
        if (metadata === afterEvent.error.metadata) return yield* afterEvent.error
        return yield* new Tool.Error({ message: afterEvent.error.message, error: afterEvent.error.error })
      }
      const content = yield* normalizeImages(execution.value.content)
      const terminal: { result: Tool.Result; replaced: boolean } = {
        result: {
          ...(execution.value.output === undefined ? {} : { output: execution.value.output }),
          content: content.length > 0 ? content : execution.value.content,
          ...(execution.value.metadata === undefined ? {} : { metadata: execution.value.metadata }),
        },
        replaced: false,
      }
      const afterEvent: PluginHooks.Domains["tool"]["execute.after"] = {
        ...base,
        status: "completed",
        get result() {
          return {
            ...terminal.result,
            ...(Array.isArray(terminal.result.content) ? { content: [...terminal.result.content] } : {}),
            ...(terminal.result.metadata === undefined ? {} : { metadata: { ...terminal.result.metadata } }),
          }
        },
        set result(value) {
          terminal.replaced = true
          terminal.result = value
        },
      }
      yield* hooks.trigger("tool", "execute.after", afterEvent)
      const afterContent = terminal.replaced
        ? yield* normalizeImages(normalizeContent(terminal.result.content, execution.value.output))
        : content
      const metadata = yield* terminalMetadata(name, context.id, terminal.result.metadata)
      return {
        ...(execution.value.output === undefined ? {} : { output: execution.value.output }),
        content: afterContent,
        ...(metadata === undefined ? {} : { metadata }),
      }
    })

    const state = State.create<Data, Editor>({
      name: "tool",
      initial: () => ({
        tools: new Map(),
        namespaces: new Map(),
        errors: [],
      }),
      editor: (editor) => ({
        list: () => Array.from(editor.tools.values()),
        get: (id) => editor.tools.get(id),
        namespace: (namespace) => {
          const error = namespaceError(namespace.name)
          if (error) {
            editor.errors.push({ kind: "namespace", name: namespace.name, namespace: namespace.name, error })
            return
          }
          editor.namespaces.set(namespace.name, { ...namespace })
        },
        add: (tool) => {
          const error = registrationError(tool)
          if (error) {
            editor.errors.push({ kind: "tool", name: tool.name, namespace: tool.options?.namespace, error })
            return
          }
          const id = effectiveName(tool)
          editor.tools.set(id, { ...tool, id, options: tool.options && { ...tool.options } })
        },
        update: (id, update) => {
          const current = editor.tools.get(id)
          if (!current) return
          const tool = { ...current, options: current.options && { ...current.options } }
          update(tool)
          tool.name = current.name
          tool.id = id
          if (tool.options?.namespace !== current.options?.namespace)
            tool.options = { ...tool.options, namespace: current.options?.namespace }
          const error = registrationError(tool)
          if (error) {
            editor.errors.push({ kind: "tool", name: tool.name, namespace: tool.options?.namespace, error })
            return
          }
          editor.tools.set(id, tool)
        },
        remove: (id) => {
          editor.tools.delete(id)
        },
      }),
      notify: (value) =>
        Effect.forEach(
          value.errors,
          ({ kind, name, namespace, error }) =>
            Effect.logError(`Skipping invalid ${kind} registration`, {
              name,
              namespace,
              error: error.message,
            }),
          { discard: true },
        ),
    })

    const transform: Interface["transform"] = Effect.fn("Tool.transform")(function* (callback) {
      let batchError: RegistrationError | undefined
      const registration = yield* state.transform((draft) => {
        const pending: Tool.Info[] = []
        callback({
          list: draft.list,
          get: draft.get,
          namespace: draft.namespace,
          add: (tool) => {
            pending.push(tool)
            draft.add(tool)
          },
          update: draft.update,
          remove: (id) => {
            const index = pending.findLastIndex((tool) => effectiveName(tool) === id)
            if (index >= 0) pending.splice(index, 1)
            draft.remove(id)
          },
        })
        const entries = pending.map((tool) => ({ tool, key: effectiveName(tool), error: registrationError(tool) }))
        const invalid = entries.find((entry) => entry.error)?.error
        const collision = entries.find(
          (entry, index) => entries.findIndex((candidate) => candidate.key === entry.key) !== index,
        )
        batchError =
          invalid ??
          (collision
            ? new RegistrationError({
                name: collision.key,
                message: `Duplicate normalized tool name: ${collision.key}`,
              })
            : undefined)
        if (batchError) return
      })
      if (!batchError) return registration
      yield* registration.dispose
      return yield* Effect.die(batchError)
    })

    return Service.of({
      transform,
      reload: state.reload,
      snapshot: Effect.fn("Tool.snapshot")((permissions, policy, session) =>
        Effect.gen(function* () {
          const active = new Map<string, Tool.Info>()
          const rules = permissions ?? []
          const allowed = policy ? new Set(policy.tools.allow) : undefined
          const policyDenied = new Set<string>()
          const candidates = [
            ...state.get().tools,
            ...(session ?? []).map((tool) => [effectiveName(tool), tool] as const),
          ]
          for (const [name, tool] of candidates) {
            if (allowed && (!allowed.has(name) || whollyDisabled(tool.options?.permission ?? name, rules))) {
              policyDenied.add(name)
              continue
            }
            if (whollyDisabled(tool.options?.permission ?? name, rules)) continue
            active.set(name, tool)
          }
          const direct = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode === false))
          const codeModeTools = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode !== false))
          const namespaces = state.get().namespaces
          const codeModeInventory = { tools: codeModeTools, namespaces }
          const config = yield* Effect.serviceOption(Config.Service)
          const configured =
            config._tag === "Some" ? Config.latest(yield* config.value.entries(), "codemode") : undefined
          const limits = {
            timeoutMs: configured?.timeout_ms ?? CodeModeTool.DEFAULT_LIMITS.timeoutMs,
            maxToolCalls: configured?.max_tool_calls ?? CodeModeTool.DEFAULT_LIMITS.maxToolCalls,
            maxOutputBytes: configured?.max_output_bytes ?? CodeModeTool.DEFAULT_LIMITS.maxOutputBytes,
          }
          const codeModeEnabled =
            (allowed === undefined || allowed.has("execute") || codeModeTools.size > 0) &&
            !whollyDisabled("execute", rules)
          const codeModeTool = codeModeEnabled
            ? CodeModeTool.create(
                codeModeInventory,
                (name, tool, input, context) =>
                  beforeExecute(name, input, context).pipe(
                    Effect.flatMap((event) => executeTool(tool, name, event.input, context)),
                  ),
                limits,
              )
            : undefined
          const codeModeCatalog = codeModeEnabled ? CodeModeTool.catalog(codeModeInventory) : undefined
          return {
            ...(codeModeCatalog === undefined ? {} : { codeModeCatalog }),
            definitions: [
              ...Array.from(direct)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([, tool]) => definition(tool)),
              ...(codeModeTool ? [definition(codeModeTool)] : []),
            ],
            execute: Effect.fnUntraced(function* (input: Parameters<Snapshot["execute"]>[0]) {
              const context: Tool.Context = {
                sessionID: input.sessionID,
                agent: input.agent,
                messageID: input.messageID,
                id: Tool.CallID.make(input.call.id),
                progress: input.progress ?? (() => Effect.void),
              }
              const event = yield* beforeExecute(input.call.name, input.call.input, context)
              const requested = input.definitions?.get(event.tool)
              // Preserve session context removal and alias resolution, now after the repair hook.
              if (!requested && input.definitions && (direct.has(event.tool) || codeModeTool?.name === event.tool))
                return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
              const name = requested?.name ?? event.tool
              if (name === "execute" && codeModeTool)
                return yield* executeTool(codeModeTool, name, event.input, context)
              if (allowed && (!allowed.has(name) || policyDenied.has(name))) {
                const tool = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) ? name : "<invalid>"
                return yield* Effect.logWarning("Session tool policy denied execution", {
                  sessionID: input.sessionID,
                  tool,
                }).pipe(
                  Effect.andThen(
                    new Tool.Error({
                      message: `Tool denied by session policy: ${tool}`,
                      error: new Tool.PolicyDeniedError({
                        tool,
                        message: `Tool denied by session policy: ${tool}`,
                      }),
                    }),
                  ),
                )
              }
              const tool = direct.get(name)
              if (tool) return yield* executeTool(tool, name, event.input, context)
              return yield* new Tool.Error({ message: `Unknown tool: ${name}` })
            }),
          }
        }),
      ),
    })
  }),
)

const whollyDisabled = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

const formatSchemaIssue = SchemaIssue.makeFormatterDefault()

function schemaMakeError(error: unknown) {
  if (error instanceof Error && SchemaIssue.isIssue(error.cause)) return formatSchemaIssue(error.cause)
  return error instanceof Error ? error.message : String(error)
}

export function registrationError(tool: Tool.Info) {
  const namespace = tool.options?.namespace
  if (namespace !== undefined) {
    const error = namespaceError(namespace)
    if (error) return error
  }
  const name = normalizedName(tool)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return new RegistrationError({ name, message: `Invalid tool name: ${name}` })
  const id = effectiveName(tool)
  if (tool.options?.codemode === false && id === "execute")
    return new RegistrationError({ name: id, message: 'Tool name "execute" is reserved for CodeMode' })
  const result = Result.try({
    try: () => ToolDefinition.make(definition(tool)),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  return Result.isFailure(result) ? result.failure : undefined
}

function namespaceError(name: string) {
  if (name.split(".").every((segment) => /^[A-Za-z0-9_-]{1,64}$/.test(segment))) return
  return new RegistrationError({ name, message: `Invalid tool namespace: ${JSON.stringify(name)}` })
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, Image.node],
})
