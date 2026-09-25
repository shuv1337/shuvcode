export * as SessionCompaction from "./compaction.js"

import {
  AIError,
  InvalidProviderOutputError,
  UnknownProviderError,
  isContextOverflowFailure,
  LLMClient,
  LLMEvent,
  LLMRequest,
  Message,
  type ContentPart,
  type ToolResultPart,
  type Usage,
} from "@opencode/ai"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionCompactionResult } from "@opencode/plugin/effect/session"
import { SessionError } from "@opencode/schema/session-error"
import { Context, Effect, Layer, Ref, Stream } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionEvent } from "./event.js"
import type { SessionContext } from "./context.js"
import { SessionHistory } from "./history.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionProviderContext } from "./provider-context.js"
import type { SessionRunnerModel } from "./runner/model.js"
import { SessionRunnerRetry } from "./runner/retry.js"
import { SessionSchema } from "./schema.js"
import { toSessionError } from "./to-session-error.js"
import { Token } from "../util/token.js"
import { SessionUsage } from "./usage.js"
import { State } from "../state.js"
import { toLLMMessages } from "./runner/to-llm-message.js"
import type { AgentNotFoundError } from "./error.js"
import type { Instructions } from "../instructions/index.js"

const AUTO_THRESHOLD = 0.9
const DEFAULT_KEEP_TOKENS = 15_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const FALLBACK_TOOL_CHARS = 1_000
const FALLBACK_OVERFLOW_RETRIES = 3
const IMAGE_TOKEN_ESTIMATE = 1_500
const PDF_TOKEN_ESTIMATE = 2_000
const usableWindow = (limit: SessionRunnerModel.Resolved["limit"]) =>
  Math.min(limit.context > 0 ? limit.context : (limit.input ?? 0), limit.input ?? Number.POSITIVE_INFINITY)
const compactionCeiling = (usable: number, buffer?: number) =>
  buffer === undefined ? Math.floor(usable * AUTO_THRESHOLD) : usable - buffer
const SUMMARY_TEMPLATE = `You MUST use this format for your response (you may omit sections that aren't applicable). Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Requirements
- [constraints, preferences, requirements, and scope boundaries stated by the user, or "(none)"]

## Decisions
- [decisions already made and why, or "(none)"]

## Work State
Break the objective into smaller goals and report which are completed, which are being worked on, and which are blocked.
### Completed
- [goals that have been completed; otherwise "(none)"]

### Active
- [goals currently being worked on; otherwise "(none)"]

### Blocked
- [anything blocking progress, and why; otherwise "(none)"]

## Next Move
1. [ordered list of next actions, or "(none)"]

## Relevant Files
List the files and directories, other than the current working directory, that another agent would need to open to continue this work. Include at most 15, most important first. Do not list every file that was read or changed. Include paths outside the current working directory when relevant. If none, write "(none)".
- \`[file or directory path]\`: [brief reason it matters]

## Important Context
- [facts the next agent cannot continue without and cannot easily find on its own; or "(none)"]
</template>`

const SUMMARY_RULES = `Rules:
- Keep each section concise. Use terse, single-line bullets, not prose paragraphs or nested lists.
- Prefer short references over detailed restatement. It is fine to leave out information the next agent can recover from the code or the files listed above.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers.
- Carry forward only user questions or requests that remain unanswered or require further action. Do not repeat ones that newer history has answered or resolved. Preserve exact wording when carrying one forward.
- Preserve consequential workflow state, including whether changes are uncommitted, committed, pushed, under review, or merged.
- Do not mention the summary process or that context was compacted.`

const SUMMARY_HEADINGS = SUMMARY_TEMPLATE.split("\n").filter((line) => line.startsWith("##"))
const LEGACY_HEADING = "## Additional Context"

export type Settings = {
  auto: boolean
  buffer?: number
  tokens: number
}

export type NativeInput = {
  readonly request: LLMRequest
  readonly options: StreamOptions
  /** Whole, real user messages within the retained-token allowance, for checkpoint-only mechanisms. */
  readonly retained: Effect.Effect<ReadonlyArray<Message>>
}

export type NativeResult = {
  readonly replacement: ReadonlyArray<Message>
  readonly usage?: Usage
}

/** Returns the provider's replacement window, or `undefined` when this strategy has no mechanism for the route. */
export type NativeStrategy = (input: NativeInput) => Effect.Effect<NativeResult, AIError> | undefined

export type Editor = {
  configure: (settings: Partial<Settings>) => void
  /** Later registrations take precedence. */
  native: (strategy: NativeStrategy) => void
}

export type AutoInput = {
  readonly context: SessionContext.Loaded
  readonly prepare: SessionModelRequest.Interface["compaction"]
  /** Known overflow must recover from durable history, not submit the overflowing native window again. */
  readonly overflow?: boolean
}

type RequiredInput = {
  readonly messages: readonly SessionMessage.Info[]
  readonly resolved: SessionRunnerModel.Resolved
  readonly context: SessionContext.Loaded
}

export type ManualInput = {
  readonly session: SessionSchema.Info
  readonly messages: readonly SessionMessage.Info[]
  readonly inputID: SessionMessage.ID
  readonly started?: boolean
  /** Empty compaction controls do not preflight model or instruction availability. */
  readonly resolveContext: (
    session: SessionSchema.Info,
  ) => Effect.Effect<
    SessionContext.Loaded & { readonly instructionUpdate: string },
    SessionRunnerModel.Error | AgentNotFoundError | Instructions.InitializationBlocked
  >
  readonly prepare: SessionModelRequest.Interface["compaction"]
}

type ExecuteInput = AutoInput & {
  readonly reason: SessionMessage.Compaction["reason"]
  readonly inputID?: SessionMessage.ID
  readonly started?: boolean
  readonly instructionUpdate?: string
}

export type Outcome =
  | (Pick<SessionMessage.CompactionCompleted, "status"> & {
      /** Consumes the logical step's one overflow rebuild even when the native attempt overflowed first. */
      readonly recoveredOverflow?: boolean
    })
  | Pick<SessionMessage.CompactionFailed, "status" | "error">

export interface Interface extends State.Transformable<Editor> {
  readonly enabled: () => boolean
  readonly required: (input: RequiredInput) => boolean
  readonly compact: (input: AutoInput) => Effect.Effect<Outcome>
  readonly compactManual: (input: ManualInput) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

const inputTokens = (tokens: SessionMessage.Assistant["tokens"] & {}) =>
  tokens.input + tokens.cache.read + tokens.cache.write

const hasInputUsage = (message: SessionMessage.Info) =>
  message.type === "assistant" && !message.error && message.tokens !== undefined && inputTokens(message.tokens) > 0

const lastCheckpoint = (messages: readonly SessionMessage.Info[]) =>
  messages.findLast(
    (message): message is SessionMessage.CompactionCompleted =>
      message.type === "compaction" && message.status === "completed",
  )

/** Index of the oldest item in the newest run whose sizes total at most `budget`. */
const fitNewest = <T>(items: readonly T[], size: (item: T) => number, budget: number) => {
  let total = 0
  let start = items.length
  while (start > 0) {
    const next = total + size(items[start - 1])
    if (next > budget) break
    total = next
    start--
  }
  return start
}

/** System prompt and tool definitions: sent with every request but outside the message history. */
const estimateFixed = (system: ReadonlyArray<{ readonly text: string }>, tools: SessionContext.Loaded["tools"]) =>
  system.reduce((sum, part) => sum + Token.estimate(part.text), 0) +
  tools.definitions.reduce(
    (sum, tool) => sum + Token.estimate(tool.name + tool.description + JSON.stringify(tool.inputSchema)),
    0,
  )

export const estimateTokens = (input: RequiredInput) => {
  const prompt = estimatePrompt(input)
  return prompt.measured + prompt.estimated
}

/** The prompt size: `measured` is what the provider reported at the latest response, `estimated` is the text since. */
export const estimatePrompt = (input: RequiredInput) => {
  const index = input.messages.findLastIndex(hasInputUsage)
  const last = input.messages[index]
  // Keep the anchor's local tool results: they are not covered by its provider usage.
  const added = SessionModelRequest.unsupportedParts(
    toLLMMessages(input.messages.slice(Math.max(0, index)), input.resolved.ref),
    input.resolved.capabilities,
  )
    .filter((message) => message.role !== "assistant" || message.id !== last?.id)
    .reduce((sum, message) => sum + message.content.reduce((sum, part) => sum + estimatePart(part), 0), 0)
  if (last?.type === "assistant" && last.tokens)
    return { measured: inputTokens(last.tokens) + last.tokens.output + last.tokens.reasoning, estimated: added }
  const transcript = SessionModelRequest.baseTranscript({
    agent: input.context.agent.info,
    model: input.resolved,
    tools: input.context.tools,
    initial: input.context.initial,
    messages: [],
  })
  return { measured: 0, estimated: added + estimateFixed(transcript.system, input.context.tools) }
}

const estimateMedia = (mime: string) => {
  const type = mime.toLowerCase()
  return type.startsWith("image/") ? IMAGE_TOKEN_ESTIMATE : type === "application/pdf" ? PDF_TOKEN_ESTIMATE : 0
}

const estimatePart = (part: ContentPart): number => {
  // Encrypted checkpoints have no locally measurable token size.
  if (part.type === "compaction") return Token.estimate(part.text ?? "")
  if (part.type === "effort") return 0
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "media") return estimateMedia(part.media.mediaType)
  if (part.type === "tool-call") return Token.estimate(part.name + (JSON.stringify(part.input) ?? ""))
  if (part.result.type === "content")
    return part.result.value.reduce(
      (sum, content) => sum + (content.type === "text" ? Token.estimate(content.text) : estimateMedia(content.mime)),
      0,
    )
  return Token.estimate(toolResultText(part.result))
}

const toolResultText = (result: ToolResultPart["result"]) => {
  if (result.type === "content") return serializeToolContent(result.value)
  return typeof result.value === "string" ? result.value : (JSON.stringify(result.value) ?? "")
}

/** Keep whole, real user messages, never synthetic guidance or half an attachment/tool exchange. */
export const retainUsers = (
  messages: readonly SessionMessage.Info[],
  model: Pick<SessionRunnerModel.Resolved, "ref" | "capabilities">,
  keepTokens: number,
) => {
  const users = SessionModelRequest.boundImages(
    SessionModelRequest.unsupportedParts(
      toLLMMessages(
        messages.filter((message) => message.type === "user").map((message) => ({ ...message, skills: undefined })),
        model.ref,
      ),
      model.capabilities,
    ),
  )
  const size = (message: Message) => message.content.reduce((sum, part) => sum + estimatePart(part), 0)
  return users.slice(fitNewest(users, size, keepTokens))
}

export const truncateToolOutput = (value: string, maxChars = TOOL_OUTPUT_MAX_CHARS) => {
  if (value.length <= maxChars) return value
  let end = 0
  for (let count = 0; count < maxChars && end < value.length; count++) {
    const code = value.charCodeAt(end)
    end +=
      code >= 0xd800 && code <= 0xdbff && value.charCodeAt(end + 1) >= 0xdc00 && value.charCodeAt(end + 1) <= 0xdfff
        ? 2
        : 1
  }
  if (end === value.length) return value
  return `${value.slice(0, end)}\n[truncated]`
}

export const serializeToolContent = (content: ReadonlyArray<SessionMessage.ToolStateCompleted["content"][number]>) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serializeRecentMessage = (message: SessionMessage.Info) => {
  // Checkpoints and instruction updates are handled outside the serialized tail.
  if (message.type === "compaction" || message.type === "system") return ""
  if (message.type === "user") {
    const files =
      message.files?.map(
        (file) =>
          `[Attached ${file.mime}: ${file.name ?? (file.source.type === "uri" ? file.source.uri : "inline attachment")}]`,
      ) ?? []
    const skills =
      message.skills?.flatMap((skill) =>
        skill.text === undefined ? [] : [`[Skill activated: ${skill.name}]\n${skill.text}`],
      ) ?? []
    return [...skills, `[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "location-switched")
    return `[User]: The working directory has been changed to ${message.location.directory}.`
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        const call = `[Assistant tool call]: ${part.name}(${input})`
        if (part.state.status === "completed")
          return [call, `[Tool result]: ${truncateToolOutput(serializeToolContent(part.state.content))}`]
        if (part.state.status === "error") return [call, `[Tool error]: ${part.state.error.message}`]
        return [call]
      })
      .join("\n")
  }
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "skill") return `[Skill activated: ${message.name}]\n${message.text}`
  if (message.type === "shell")
    return message.metadata?.background === true
      ? ""
      : `[Shell]: ${message.command}\n${truncateToolOutput(message.output?.output ?? "")}`
  return ""
}

/** Flatten provider-bound history into text so a reduced summary request carries no tool pairs or reasoning signatures. */
const serializeFallback = (messages: readonly Message[]) =>
  messages.flatMap((message) => {
    const parts = message.content.flatMap((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.text ? [part.text] : []
      if (part.type === "media")
        return [`[Attached ${part.media.mediaType}${part.filename ? `: ${part.filename}` : ""}; content omitted]`]
      if (part.type === "tool-call") return [`[Tool call ${part.name}(${JSON.stringify(part.input)})]`]
      if (part.type === "tool-result")
        return [`[Tool result ${part.name}]: ${truncateToolOutput(toolResultText(part.result), FALLBACK_TOOL_CHARS)}`]
      if (part.type === "compaction" && part.text) return [part.text]
      return []
    })
    return parts.length ? [{ role: message.role, text: `[${message.role}]: ${parts.join("\n")}` }] : []
  })

/** Retain a prior checkpoint and the newest complete exchanges that fit the summary input budget. */
const fitFallback = (entries: ReturnType<typeof serializeFallback>, budget: number) => {
  const previous = entries[0]?.text.includes("<conversation-checkpoint>") ? entries[0] : undefined
  const rest = previous ? entries.slice(1) : entries
  const groups = rest.reduce<Array<string>>((groups, entry) => {
    if (entry.role === "user" || groups.length === 0) groups.push(entry.text)
    else groups[groups.length - 1] += `\n\n${entry.text}`
    return groups
  }, [])
  const header = previous ? `${previous.text}\n\n` : ""
  const allowance = budget - Token.estimate(header)
  if (allowance <= 0) return
  const start = fitNewest(groups, Token.estimate, allowance)
  if (groups.length && start === groups.length) return
  return {
    text: `${header}${start ? `[${start} older exchanges omitted from this summary input]\n\n` : ""}${groups.slice(start).join("\n\n")}`,
    omitted: start,
  }
}

const splitHistory = (messages: readonly SessionMessage.Info[], keepTokens: number) => {
  const tailStart = findTailStart(messages, keepTokens)
  if (tailStart === undefined) return
  return {
    messages: messages.slice(0, tailStart),
    recent: messages.slice(tailStart).map(serializeRecentMessage).filter(Boolean).join("\n\n"),
  }
}

const findTailStart = (messages: readonly SessionMessage.Info[], keepTokens: number) => {
  const conversation = messages.flatMap((message, index) => {
    const text = serializeRecentMessage(message)
    return text ? [{ message, text, index }] : []
  })
  if (conversation.length === 0) return undefined

  // Keep at least the newest entry, even if it exceeds the allowance.
  const fitted = Math.min(
    fitNewest(conversation, (item) => Token.estimate(item.text), keepTokens),
    conversation.length - 1,
  )
  // Start at a user boundary so an assistant's tool calls and results stay together.
  const start = conversation.findLastIndex((item, index) => index <= fitted && item.message.type === "user")
  if (start > 0) return conversation[start].index

  // If everything fits, retain only the latest exchange to leave an older prefix to summarize.
  const latestUser = conversation.findLastIndex((item) => item.message.type === "user")
  if (latestUser > 0) return conversation[latestUser].index

  // Without an older retained tail to summarize, summarize everything and retain nothing.
  return lastCheckpoint(messages)?.recent ? conversation[0].index : messages.length
}

export const buildPrompt = (update: boolean, legacy = false) => {
  const shared = [
    "Summarize only what the user and the assistant said and did. Leave out instructions and setup the assistant was given rather than told by the user: repository conventions, instruction files such as AGENTS.md, and environment details like the session ID. The next agent receives current versions of all of these separately.",
    SUMMARY_TEMPLATE,
    SUMMARY_RULES,
    "Do not continue the task or call tools.",
    "Return only the structured summary in the requested format. Do not include a preamble, explanation, or other commentary.",
  ]
  if (update) {
    return [
      "Update the existing checkpoint in the conversation above into one consolidated summary.",
      ...(legacy
        ? [
            "The existing checkpoint was written with an earlier format that recorded far more detail than this one asks for. Rewrite it at the level of detail described below rather than carrying its detail forward. Keep its requirements, decisions, and open questions; they came from earlier conversation with the user.",
          ]
        : []),
      "Newer history always takes precedence over the existing checkpoint. Preserve previous information unless newer history clearly contradicts, supersedes, resolves, or makes it stale. If something is no longer relevant to continuing the work, you may remove it.",
      "Incorporate newer requirements, decisions, progress, and context. Reconcile Work State and Next Move: move completed work out of Active, remove resolved blockers and answered questions, and preserve unresolved or pending work.",
      "Return only the updated Markdown sections. Do not reproduce the `<conversation-checkpoint>`, `<summary>`, or `<recent-context>` wrapper tags from the previous checkpoint.",
      ...shared,
    ].join("\n\n")
  }
  return [
    "You MUST summarize the conversation above into a structured summary that will be given to another agent to resume the work.",
    ...shared,
  ].join("\n\n")
}

const hasSummarySection = (summary: string) =>
  summary.split("\n").some((line) => SUMMARY_HEADINGS.includes(line.trim()))

type Envelope = Pick<SessionEvent.Compaction.Failed["data"], "sessionID" | "reason" | "inputID">

/** One summary attempt: text so far plus the first failure, if any, and whether it was a context overflow. */
type Summary = {
  readonly summary: string
  readonly overflow: boolean
  readonly failure?: SessionError.Error
  readonly providerState?: SessionMessage.ProviderState
}

const NUDGE =
  "The previous response did not fill in the required summary template. Do not call tools. Return the summary as text using the exact section headings from the template."

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const db = (yield* Database.Service).db

    const state = State.create<Settings & { readonly native: NativeStrategy[] }, Editor>({
      name: "session-compaction",
      initial: () => ({ auto: true, tokens: DEFAULT_KEEP_TOKENS, native: [] }),
      editor: (editor) => ({
        configure: (settings) => {
          if (settings.auto !== undefined) editor.auto = settings.auto
          if (settings.buffer !== undefined) editor.buffer = settings.buffer
          if (settings.tokens !== undefined) editor.tokens = settings.tokens
        },
        native: (strategy) => {
          editor.native.push(strategy)
        },
      }),
    })
    const envelope = (input: ExecuteInput): Envelope => ({
      sessionID: input.context.session.id,
      reason: input.reason,
      inputID: input.inputID,
    })
    const recordUsage = (sessionID: SessionSchema.ID, usage: SessionUsage.Recorded | undefined) =>
      usage ? bus.publish(SessionEvent.UsageRecorded, { sessionID, source: "compaction", ...usage }) : Effect.void
    const failed = Effect.fnUntraced(function* (
      target: Envelope,
      error: SessionError.Error,
      usage?: SessionUsage.Recorded,
    ) {
      yield* recordUsage(target.sessionID, usage)
      yield* bus.publish(SessionEvent.Compaction.Failed, { ...target, error, ...usage })
      return { status: "failed" as const, error }
    })
    const ended = Effect.fnUntraced(function* (
      input: ExecuteInput,
      result: {
        readonly text: string
        readonly recent: string
        readonly providerState?: SessionMessage.ProviderState
        readonly providerContext?: SessionProviderContext.Info
        readonly usage?: SessionUsage.Recorded
        readonly metadata?: Record<string, unknown>
      },
    ) {
      const context = input.context
      yield* recordUsage(context.session.id, result.usage)
      yield* bus.publish(
        SessionEvent.Compaction.Ended,
        {
          sessionID: context.session.id,
          reason: input.reason,
          model: context.model.ref,
          providerState: result.providerState,
          providerContext: result.providerContext,
          text: result.text,
          recent: result.recent,
          ...result.usage,
        },
        { metadata: result.metadata },
      )
      return { status: "completed" as const }
    })
    const started = (input: ExecuteInput, recent: string) =>
      input.started ? Effect.void : bus.publish(SessionEvent.Compaction.Started, { ...envelope(input), recent })
    /** A hook answered the request itself. */
    const supplied = (input: ExecuteInput, result: SessionCompactionResult, recent: string) =>
      ended(input, {
        text: result.summary,
        recent,
        providerState: result.providerState,
        usage: result.tokens && {
          tokens: result.tokens,
          cost: SessionUsage.calculateCost(input.context.model.cost, result.tokens),
        },
        metadata: result.metadata,
      })
    // Manual controls settle through the inbox; only automatic work needs a durable interruption record.
    const interrupted = (input: ExecuteInput, usage?: SessionUsage.Recorded) =>
      Effect.gen(function* () {
        yield* recordUsage(input.context.session.id, usage)
        if (input.reason !== "auto") return
        yield* failed(envelope(input), { type: "compaction.interrupted", message: "Compaction was interrupted" })
      })
    const prepare = (
      input: ExecuteInput,
      transcript: Pick<SessionModelRequest.Input, "system" | "messages">,
      inputTokens: { readonly measured: number; readonly estimated: number },
      webSocket?: "session",
    ) =>
      input.prepare({
        session: input.context.session,
        agent: input.context.agent.id,
        model: input.context.model,
        tools: input.context.tools,
        system: transcript.system,
        messages: transcript.messages,
        webSocket,
        inputTokens,
      })
    const transcript = (input: ExecuteInput, messages: readonly SessionMessage.Info[]) =>
      SessionModelRequest.baseTranscript({
        agent: input.context.agent.info,
        model: input.context.model,
        tools: input.context.tools,
        initial: input.context.initial,
        messages,
      })
    const compactionRequest = (
      input: ExecuteInput,
      messages: readonly SessionMessage.Info[],
      webSocket?: "session",
      summaryPrompt?: string,
    ) => {
      const base = transcript(input, messages)
      const prompt = estimatePrompt({ messages, resolved: input.context.model, context: input.context })
      return prepare(
        input,
        {
          system: base.system,
          messages: [...base.messages, ...(input.instructionUpdate ? [Message.system(input.instructionUpdate)] : [])],
        },
        // The instruction update and summary prompt are sent outside the history, so count them too.
        {
          measured: prompt.measured,
          estimated: prompt.estimated + Token.estimate((input.instructionUpdate ?? "") + (summaryPrompt ?? "")),
        },
        webSocket,
      )
    }
    const retry = Effect.fnUntraced(function* (input: ExecuteInput, hook: SessionModelRequest.Prepared["retry"]) {
      return SessionRunnerRetry.transient(yield* SessionRunnerRetry.policy(input.context.session.id), {
        agent: input.context.agent.id,
        model: input.context.model.ref,
        hook,
      })
    })
    /** The durable transcript since the last local summary, re-expanding every native window. */
    const original = (sessionID: SessionSchema.ID) => SessionHistory.load(db, sessionID, "local").pipe(Effect.orDie)
    const recoverLocally = (input: ExecuteInput) =>
      original(input.context.session.id).pipe(
        Effect.flatMap((messages) => summarize({ ...input, context: { ...input.context, messages } })),
      )

    const native = Effect.fn("SessionCompaction.native")(function* (input: ExecuteInput) {
      const context = input.context
      const reject = (message: string) => failed(envelope(input), { type: "provider.unsupported-operation", message })
      const prepared = yield* compactionRequest(input, context.messages, "session")
      if (prepared.event.result) {
        yield* started(input, "")
        return yield* supplied(input, prepared.event.result, "")
      }
      const request = prepared.request
      const provenance = SessionProviderContext.provenance(context.model)
      if (!provenance) return yield* reject("Provider compaction requires a stable, configured endpoint")
      // History is selected before request hooks. Until that interface can select on the final route,
      // require routing in the catalog; never install a checkpoint that the next request would skip.
      const routed = SessionProviderContext.provenance({ model: request.model, ref: context.model.ref })
      if (!SessionProviderContext.compatible(provenance, routed))
        return yield* reject(
          "Provider compaction requires the endpoint in provider/model settings, not a model.request rewrite",
        )
      const strategy = state
        .get()
        .native.toReversed()
        .map((strategy) =>
          strategy({
            request,
            options: prepared.options,
            retained: original(context.session.id).pipe(
              Effect.map((messages) => retainUsers(messages, context.model, state.get().tokens)),
            ),
          }),
        )
        .find((effect) => effect !== undefined)
      if (!strategy)
        return yield* reject(
          `No plugin provides native compaction for ${request.model.provider}/${request.model.route.id}`,
        )
      const transient = yield* retry(input, prepared.retry)
      yield* started(input, "")
      // Transient provider failures retry like any other request; only a known automatic overflow permits
      // local recovery, and nothing is installed until the provider returns a checkpoint.
      return yield* Effect.uninterruptibleMask((restore) =>
        restore(strategy.pipe(transient)).pipe(
          Effect.flatMap((result) =>
            ended(input, {
              text: "",
              recent: "",
              providerContext: SessionProviderContext.encode(provenance, result.replacement),
              usage: result.usage && SessionUsage.record(result.usage, context.model.cost),
            }),
          ),
        ),
      ).pipe(
        Effect.onInterrupt(() => interrupted(input)),
        Effect.catchTag(
          "AI.Error",
          (cause): Effect.Effect<Outcome> =>
            input.reason === "auto" && isContextOverflowFailure(cause)
              ? recoverLocally({ ...input, started: true }).pipe(
                  Effect.map((result) =>
                    result.status === "completed" ? { ...result, recoveredOverflow: true } : result,
                  ),
                )
              : failed(envelope(input), toSessionError(cause)),
        ),
      )
    })

    /** One summary request. Usage accumulates in `usage` so an interruption can still account for it. */
    const stream = (
      input: ExecuteInput,
      request: LLMRequest,
      options: StreamOptions,
      transient: ReturnType<typeof SessionRunnerRetry.transient>,
      usage: Ref.Ref<SessionUsage.Recorded | undefined>,
    ) => {
      const context = input.context
      const key = context.model.model.route.providerMetadataKey ?? context.model.model.provider
      return llm.stream(request, options).pipe(
        Stream.runFoldEffect(
          (): Summary => ({ summary: "", overflow: false }),
          (acc, event): Effect.Effect<Summary, AIError> => {
            if (LLMEvent.is.providerError(event)) {
              const overflow = event.classification === "context-overflow"
              return Effect.succeed({
                ...acc,
                overflow,
                failure: { type: overflow ? "provider.invalid-request" : "provider.error", message: event.message },
              })
            }
            if (LLMEvent.is.textDelta(event))
              return bus
                .publish(SessionEvent.Compaction.Delta, { sessionID: context.session.id, text: event.text })
                .pipe(Effect.as({ ...acc, summary: acc.summary + event.text }))
            if (LLMEvent.is.stepFinish(event))
              return Ref.update(usage, (total) => {
                const step = SessionUsage.record(event.usage, context.model.cost)
                return total ? SessionUsage.add(total, step) : step
              }).pipe(Effect.as({ ...acc, providerState: event.providerMetadata?.[key] }))
            if (!LLMEvent.is.finish(event)) return Effect.succeed(acc)
            const reason = event.reason.normalized
            if (reason === "unknown")
              return Effect.fail(
                new AIError({
                  reason: new InvalidProviderOutputError({
                    message: "The provider response ended with an unknown finish reason.",
                    classification: "incomplete-stream",
                  }),
                }),
              )
            if (reason === "error")
              return Effect.fail(
                new AIError({ reason: new UnknownProviderError({ message: "Compaction generation failed" }) }),
              )
            if (reason === "length")
              return Effect.succeed({
                ...acc,
                failure: { type: "compaction.failed", message: "Compaction summary reached the output token limit" },
              })
            if (reason === "content-filter")
              return Effect.succeed({
                ...acc,
                failure: { type: "provider.content-filter", message: "Compaction summary was blocked by the provider" },
              })
            return Effect.succeed(acc)
          },
        ),
        transient,
        Effect.catchTag("AI.Error", (error) =>
          Effect.succeed<Summary>({
            summary: "",
            overflow: isContextOverflowFailure(error),
            failure: toSessionError(error),
          }),
        ),
        Effect.onInterrupt(() => Ref.get(usage).pipe(Effect.flatMap((total) => interrupted(input, total)))),
      )
    }

    const summarize = Effect.fn("SessionCompaction.summarize")(function* (input: ExecuteInput) {
      const context = input.context
      const history = splitHistory(context.messages, state.get().tokens)
      if (!history)
        return yield* failed(envelope(input), { type: "compaction.unavailable", message: "Nothing to compact yet" })
      yield* started(input, history.recent)
      const previous = lastCheckpoint(history.messages)
      // Checkpoints from the previous template ran far longer than this one asks for; its catch-all heading identifies them.
      const prompt = buildPrompt(previous !== undefined, previous?.summary.includes(LEGACY_HEADING) ?? false)
      const prepared = yield* compactionRequest(input, history.messages, undefined, prompt)
      if (prepared.event.result) return yield* supplied(input, prepared.event.result, history.recent)
      // Both requests share the retry allowance; rejected output never enters the reminder request.
      const transient = yield* retry(input, prepared.retry)
      const usage = yield* Ref.make<SessionUsage.Recorded | undefined>(undefined)
      // Hooks see the transcript alone; the summary prompt is appended after they run.
      const generate = Effect.fnUntraced(function* (request: LLMRequest, options: StreamOptions) {
        const prompted = LLMRequest.update(request, { messages: [...request.messages, Message.user(prompt)] })
        const first = yield* stream(input, prompted, options, transient, usage)
        if (first.failure || hasSummarySection(first.summary)) return first
        const nudged = LLMRequest.update(prompted, { messages: [...prompted.messages, Message.user(NUDGE)] })
        return yield* stream(input, nudged, options, transient, usage)
      })
      const finish = Effect.fnUntraced(function* (result: Summary, omitted: number) {
        const total = yield* Ref.get(usage)
        if (result.failure || !hasSummarySection(result.summary))
          return yield* failed(
            envelope(input),
            result.failure ?? {
              type: "compaction.failed",
              message: result.summary.trim()
                ? "Compaction summary did not match the required template"
                : "Compaction produced no summary",
            },
            total,
          )
        return yield* ended(input, {
          text: omitted
            ? `${result.summary}\n\n[${omitted} older exchanges were omitted from the summary input; original session history is retained.]`
            : result.summary,
          recent: history.recent,
          providerState: result.providerState,
          usage: total,
        })
      })

      const usable = usableWindow(context.model.limit)
      const fixed = estimateFixed(prepared.request.system, context.tools) + Token.estimate(prompt)
      const ceiling = usable ? compactionCeiling(usable, state.get().buffer) - fixed : undefined
      const oversized =
        usable > 0 &&
        (ceiling ?? 0) > 0 &&
        estimateTokens({ messages: history.messages, resolved: context.model, context }) + Token.estimate(prompt) >
          usable
      const normal = oversized ? undefined : yield* generate(prepared.request, prepared.options)
      if (normal && !normal.overflow) return yield* finish(normal, 0)

      // Flatten the history to text and drop the oldest exchanges until the provider accepts the request.
      const entries = serializeFallback(prepared.request.messages)
      const system = transcript(input, []).system
      let budget = ceiling ?? Token.estimate(entries.map((entry) => entry.text).join("\n\n"))
      let last: string | undefined
      for (let attempt = 1; ; attempt++) {
        const fitted = fitFallback(entries, budget)
        if (!fitted || fitted.text === last)
          return yield* failed(
            envelope(input),
            {
              type: "compaction.failed",
              message: "The summary input cannot be reduced further without losing the latest exchange or checkpoint",
            },
            yield* Ref.get(usage),
          )
        const reduced = yield* prepare(
          input,
          { system, messages: [Message.user(fitted.text)] },
          { measured: 0, estimated: fixed + Token.estimate(fitted.text) },
        )
        if (reduced.event.result) {
          yield* recordUsage(context.session.id, yield* Ref.get(usage))
          return yield* supplied(input, reduced.event.result, history.recent)
        }
        const result = yield* generate(reduced.request, reduced.options)
        if (!result.overflow || attempt === FALLBACK_OVERFLOW_RETRIES) return yield* finish(result, fitted.omitted)
        budget = Math.floor(budget / 2)
        last = fitted.text
      }
    })

    const run = (input: ExecuteInput) =>
      input.context.model.compaction?.type === "native" ? native(input) : summarize(input)
    const compact = Effect.fn("SessionCompaction.compact")(function* (input: AutoInput): Effect.fn.Return<Outcome> {
      const request = { ...input, reason: "auto" as const }
      return yield* input.overflow ? recoverLocally(request) : run(request)
    })
    const required = (input: RequiredInput) => {
      const config = state.get()
      if (!config.auto) return false
      // Run the completed checkpoint before considering another automatic compaction.
      const last = input.messages.at(-1)
      if (last?.type === "compaction" && last.status === "completed") return false
      // Native usage describes the compaction operation, not the replacement's size. Wait for
      // a primary response to anchor the new window, including after restart or new admission.
      if (
        input.messages.findLastIndex(hasInputUsage) < input.messages.findLastIndex(SessionProviderContext.isCheckpoint)
      )
        return false
      const limit = input.resolved.limit
      if (limit.context <= 0) return false
      return estimateTokens(input) >= compactionCeiling(usableWindow(limit), config.buffer)
    }
    const compactManual = Effect.fn("SessionCompaction.compactManual")(function* (input: ManualInput) {
      const target: Envelope = { sessionID: input.session.id, reason: "manual", inputID: input.inputID }
      if (findTailStart(input.messages, state.get().tokens) === undefined)
        return yield* failed(target, { type: "compaction.unavailable", message: "Nothing to compact yet" })
      return yield* input.resolveContext(input.session).pipe(
        Effect.matchEffect({
          onFailure: (cause) => failed(target, toSessionError(cause)),
          onSuccess: (context) =>
            run({
              context,
              instructionUpdate: context.instructionUpdate,
              prepare: input.prepare,
              reason: "manual",
              inputID: input.inputID,
              started: input.started,
            }),
        }),
      )
    })
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      enabled: () => state.get().auto,
      required,
      compact,
      compactManual,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, llmClient],
})
