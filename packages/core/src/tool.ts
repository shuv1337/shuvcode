export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, TextContent } from "@opencode-ai/schema/tool"
export type { Context, Metadata, Options, Result } from "@opencode-ai/schema/tool"

import type { ToolCall, ToolDefinition } from "@opencode-ai/ai"
import { Tool } from "@opencode-ai/schema/tool"
import { Context, Effect, Layer, Schema, Scope, Semaphore } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import type { Agent } from "./agent"
import { CodeModeCatalog } from "./codemode/catalog"
import { CodeModeTool } from "./codemode/tool"
import { Config } from "./config"
import { ConfigCodeMode } from "./config/codemode"
import { Image } from "./image"
import { Permission } from "./permission"
import { PluginHooks } from "./plugin/hooks"
import { SessionMessage } from "./session/message"
import { SessionSchema } from "./session/schema"
import { definition, execute, normalizeContent } from "./tool/runtime"
import { Wildcard } from "./util/wildcard"

const MAX_METADATA_BYTES = 64 * 1024
const Metadata = Schema.Record(Schema.String, Schema.Json)

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly transform: (
    callback: (draft: { readonly add: (tool: Tool.Info) => void }) => void,
  ) => Effect.Effect<void, RegistrationError, Scope.Scope>
  readonly snapshot: (permissions?: Permission.Ruleset) => Effect.Effect<Snapshot>
}

export interface Snapshot {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeCatalog?: ReadonlyArray<CodeModeCatalog.Entry>
  readonly execute: (input: {
    readonly sessionID: SessionSchema.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly call: ToolCall
    readonly progress?: (update: Tool.Metadata) => Effect.Effect<void>
  }) => Effect.Effect<Tool.Result & { readonly content: ReadonlyArray<Tool.Content> }, Tool.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Tool") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const image = yield* Image.Service
    const config = yield* Config.Service

    const codeModeLimits = Effect.fn("Tool.codeModeLimits")(function* () {
      const configured: ConfigCodeMode.Info = Object.assign(
        {},
        ...(yield* config.entries()).flatMap((entry) =>
          entry.type === "document" && entry.info.codemode ? [entry.info.codemode] : [],
        ),
      )
      return {
        timeoutMs: configured.timeout_ms ?? CodeModeTool.DEFAULT_LIMITS.timeoutMs,
        maxToolCalls: configured.max_tool_calls ?? CodeModeTool.DEFAULT_LIMITS.maxToolCalls,
        maxOutputBytes: configured.max_output_bytes ?? CodeModeTool.DEFAULT_LIMITS.maxOutputBytes,
      }
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

    type NormalizedItem = Tool.Content | "decode" | "size"
    const normalizeImages = Effect.fn("Tool.normalizeImages")(function* (content: ReadonlyArray<Tool.Content>) {
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

    const local = new Map<string, Array<{ readonly token: object; readonly tool: Tool.Info }>>()
    const lock = Semaphore.makeUnsafe(1)

    const executeTool = Effect.fn("Tool.execute")(function* (
      tool: Tool.Info,
      name: string,
      input: unknown,
      context: Tool.Context,
    ) {
      const beforeEvent: PluginHooks.Domains["tool"]["execute.before"] = {
        tool: name,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        callID: context.callID,
        input,
      }
      yield* hooks.trigger("tool", "execute.before", beforeEvent)
      const execution = yield* execute(tool, beforeEvent.input, context).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (failure) => Effect.succeed({ failure })),
      )
      const base = {
        tool: name,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        callID: context.callID,
        input: beforeEvent.input,
      }
      if ("failure" in execution) {
        const afterEvent: PluginHooks.Domains["tool"]["execute.after"] = {
          ...base,
          status: "error",
          error: execution.failure,
        }
        yield* hooks.trigger("tool", "execute.after", afterEvent)
        const metadata = yield* terminalMetadata(name, context.callID, afterEvent.error.metadata)
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
      const metadata = yield* terminalMetadata(name, context.callID, terminal.result.metadata)
      return {
        ...(execution.value.output === undefined ? {} : { output: execution.value.output }),
        content: afterContent,
        ...(metadata === undefined ? {} : { metadata }),
      }
    })

    const transform: Interface["transform"] = Effect.fn("Tool.transform")(function* (callback) {
      const tools: Array<Tool.Info> = []
      yield* Effect.sync(() => callback({ add: (tool) => tools.push(tool) }))
      yield* Effect.forEach(
        tools.flatMap((tool) => (tool.options?.namespace === undefined ? [] : [tool.options.namespace])),
        validateNamespace,
        { discard: true },
      )
      const entries = normalizedEntries(tools)
      yield* Effect.forEach(entries, (entry) => validateName(normalizedName(entry.tool)), { discard: true })
      const collision = entries.find(
        (entry, index) => entries.findIndex((candidate) => candidate.key === entry.key) !== index,
      )
      if (collision)
        return yield* Effect.fail(
          new RegistrationError({
            name: collision.key,
            message: `Duplicate normalized tool name: ${collision.key}`,
          }),
        )
      const reserved = entries.find((entry) => entry.tool.options?.codemode === false && entry.key === "execute")
      if (reserved)
        return yield* Effect.fail(
          new RegistrationError({
            name: reserved.key,
            message: 'Tool name "execute" is reserved for CodeMode',
          }),
        )
      if (entries.length === 0) return
      yield* Effect.uninterruptible(
        lock.withPermit(
          Effect.gen(function* () {
            const token = {}
            for (const entry of entries)
              local.set(entry.key, [...(local.get(entry.key) ?? []), { token, tool: entry.tool }])
            yield* Effect.addFinalizer(() =>
              lock.withPermit(
                Effect.sync(() => {
                  for (const entry of entries) {
                    const remaining = local.get(entry.key)?.filter((item) => item.token !== token) ?? []
                    if (remaining.length > 0) local.set(entry.key, remaining)
                    else local.delete(entry.key)
                  }
                }),
              ),
            )
          }),
        ),
      )
    })

    return Service.of({
      transform,
      snapshot: Effect.fn("Tool.snapshot")((permissions) =>
        lock.withPermit(
          Effect.gen(function* () {
            const active = new Map<string, Tool.Info>()
            const rules = permissions ?? []
            for (const [name, entries] of local) {
              const tool = entries.at(-1)?.tool
              if (!tool) continue
              if (whollyDisabled(tool.options?.permission ?? name, rules)) continue
              active.set(name, tool)
            }
            const direct = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode === false))
            const codemode = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode !== false))
            const executeRule = rules.findLast((rule) => Wildcard.match("execute", rule.action))
            const codemodeEnabled = executeRule?.resource !== "*" || executeRule.effect !== "deny"
            const codemodeTool = codemodeEnabled
              ? CodeModeTool.create(
                  codemode,
                  (name, tool, input, context) => executeTool(tool, name, input, context),
                  yield* codeModeLimits(),
                )
              : undefined
            const codeModeCatalog = codemodeEnabled ? CodeModeTool.catalog(codemode) : undefined
            return {
              ...(codeModeCatalog === undefined ? {} : { codeModeCatalog }),
              definitions: [
                ...Array.from(direct)
                  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                  .map(([, tool]) => definition(tool)),
                ...(codemodeTool ? [definition(codemodeTool)] : []),
              ],
              execute: (input: {
                readonly sessionID: SessionSchema.ID
                readonly agent: Agent.ID
                readonly messageID: SessionMessage.ID
                readonly call: ToolCall
                readonly progress?: (update: Tool.Metadata) => Effect.Effect<void>
              }) => {
                const context: Tool.Context = {
                  sessionID: input.sessionID,
                  agent: input.agent,
                  messageID: input.messageID,
                  callID: Tool.CallID.make(input.call.id),
                  progress: input.progress ?? (() => Effect.void),
                }
                if (input.call.name === "execute" && codemodeTool)
                  return executeTool(codemodeTool, input.call.name, input.call.input, context)
                const tool = direct.get(input.call.name)
                if (tool) return executeTool(tool, input.call.name, input.call.input, context)
                return new Tool.Error({ message: `Unknown tool: ${input.call.name}` })
              },
            }
          }),
        ),
      ),
    })
  }),
)

const whollyDisabled = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

const validateName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? Effect.void
    : Effect.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))

const validateNamespace = (namespace: string) =>
  namespace.split(".").every((segment) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment))
    ? Effect.void
    : Effect.fail(
        new RegistrationError({
          name: namespace,
          message: `Invalid tool namespace: ${JSON.stringify(namespace)}`,
        }),
      )

const normalizedName = (tool: Tool.Info) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")

const effectiveName = (tool: Tool.Info) =>
  tool.options?.namespace === undefined
    ? normalizedName(tool)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalizedName(tool)}`

const normalizedEntries = (tools: ReadonlyArray<Tool.Info>) =>
  tools.map((tool) => ({
    key: effectiveName(tool),
    tool,
  }))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, Image.node, Config.node],
})
