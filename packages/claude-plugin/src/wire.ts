import { Option, Schema } from "effect"
import { userAgent } from "./oauth.js"

export const betaFlags =
  "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05"

export const systemIdentity = "You are Claude Code, Anthropic's official CLI for Claude."

/** Claude Code 2.x canonical tool names. */
const tools = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
]
const canonical = new Map(tools.map((name) => [name.toLowerCase(), name]))
const toCanonical = (name: string) => canonical.get(name.toLowerCase()) ?? name

/**
 * The canonical `<env>` shape genuine Claude Code sends.
 *
 * MAINTENANCE LIABILITY. Anthropic fuzzy-matches this block to decide whether a
 * request is really Claude Code. A block that diverges — an extra harness key,
 * different indentation, the date outside the tag — is billed as "extra usage"
 * against the account instead of drawing from the subscription. The failure is
 * silent: requests still succeed, they just cost money. Header, tool and
 * identity shaping alone do not satisfy the check.
 *
 * Verified against build 0.0.0-next-15329 on 2026-07-11. If opencode's own
 * prompt format changes, `isCanonical` below stops matching and the middleware
 * warns; that warning is the only early signal of a billing regression, so do
 * not silence it without re-verifying against a real subscription.
 */
export function normalizeEnv(text: string): string {
  return text.replace(
    /(?:[^\n]*(?:useful )?information about the environment you are running in:\n)?<env>\n([\s\S]*?)\n<\/env>((?:\n+Today's date:[^\n]*)?)/,
    (_match, inner: string, trailingDate: string) => {
      const lines = String(inner)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        // Harness-specific keys never appear in genuine Claude Code.
        .filter((line) => !/^Workspace root folder:/i.test(line))
      const date = trailingDate.match(/Today's date:\s*(.+)\s*$/)
      if (date && !lines.some((line) => /^Today's date:/i.test(line))) lines.push(`Today's date: ${date[1].trim()}`)
      return `Here is useful information about the environment you are running in:\n<env>\n${lines.join("\n")}\n</env>`
    },
  )
}

/**
 * Canary for the above. True when the text carries no `<env>` block at all, or
 * carries one already in canonical form. False means normalization did not
 * produce what Anthropic expects and billing has probably silently moved to
 * "extra usage".
 */
export function isCanonical(text: string): boolean {
  if (!text.includes("<env>")) return true
  return /Here is useful information about the environment you are running in:\n<env>\n(?:[^\n ][^\n]*\n)*<\/env>/.test(
    text,
  )
}

const Block = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const Body = Schema.StructWithRest(
  Schema.Struct({
    system: Schema.optional(Schema.Union([Schema.String, Schema.Array(Block)])),
    tools: Schema.optional(Schema.Array(Block)),
    tool_choice: Schema.optional(Block),
    messages: Schema.optional(
      Schema.Array(
        Schema.StructWithRest(
          Schema.Struct({
            content: Schema.optional(Schema.Union([Schema.String, Schema.Array(Block)])),
          }),
          [Schema.Record(Schema.String, Schema.Unknown)],
        ),
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export type Body = typeof Body.Type
export const decodeBody = Schema.decodeUnknownSync(Body)

/** Keep the exact request's spelling; do not lowercase unrelated JSON fields in the response. */
export function toolNames(body: Body) {
  return new Map(body.tools?.flatMap((tool) => (tool.name ? [[toCanonical(tool.name), tool.name] as const] : [])))
}

export function shapeRequestBody(body: Body, warn?: (message: string) => void): Body {
  const normalize = (text: string) => {
    const next = normalizeEnv(text)
    if (!isCanonical(next))
      warn?.("Claude Code <env> block is not canonical; subscription requests may be billed as extra usage")
    return next
  }
  const system = typeof body.system === "string" ? [{ type: "text", text: body.system }] : (body.system ?? [])
  // Prepending rather than replacing avoids discarding a caller's first instruction block.
  // Provider body overrides can accidentally include the credential slot; Anthropic rejects it.
  const payload = { ...body }
  delete payload.apiKey
  return {
    ...payload,
    system: [
      { type: "text", text: systemIdentity },
      ...system
        .filter((entry) => entry.text !== systemIdentity)
        .map((entry) => (typeof entry.text === "string" ? { ...entry, text: normalize(entry.text) } : entry)),
    ],
    ...(body.tools && {
      tools: body.tools.map((tool) => ({ ...tool, ...(tool.name && { name: toCanonical(tool.name) }) })),
    }),
    ...(body.tool_choice?.type === "tool" &&
      body.tool_choice.name && {
        tool_choice: { ...body.tool_choice, name: toCanonical(body.tool_choice.name) },
      }),
    ...(body.messages && {
      messages: body.messages.map((message) => ({
        ...message,
        ...(Array.isArray(message.content) && {
          content: message.content.map((block) =>
            block.type === "tool_use" && block.name ? { ...block, name: toCanonical(block.name) } : block,
          ),
        }),
      })),
    }),
  }
}

const ToolEvent = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.Literal("content_block_start"),
    content_block: Schema.StructWithRest(
      Schema.Struct({
        type: Schema.Literal("tool_use"),
        name: Schema.String,
      }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(ToolEvent))

/** Rewrites only the tool-use envelope, never input arguments or text containing a name field. */
export function restoreToolNames(event: string, names: ReadonlyMap<string, string>) {
  const lines = event.split(/\r\n|\n|\r/)
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
  const value = Option.getOrUndefined(decodeEvent(data))
  if (!value) return event
  const name = names.get(value.content_block.name)
  if (!name || name === value.content_block.name) return event
  const newline = event.includes("\r\n") ? "\r\n" : "\n"
  const first = lines.findIndex((line) => line.startsWith("data:"))
  return lines
    .flatMap((line, index) =>
      index === first
        ? [`data: ${JSON.stringify({ ...value, content_block: { ...value.content_block, name } })}`]
        : line.startsWith("data:")
          ? []
          : [line],
    )
    .join(newline)
}

/** Buffer complete SSE events and streaming UTF-8, including CRLF split between network chunks. */
export function restoreStream(names: ReadonlyMap<string, string>) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, final: boolean) => {
    // Leave a trailing CR pending until it is known whether it belongs to a CRLF pair.
    const available = !final && pending.endsWith("\r") ? pending.slice(0, -1) : pending
    const boundary = /(?:\r\n|\r(?!\n)|\n){2}/g
    let start = 0
    for (const match of available.matchAll(boundary)) {
      const end = match.index + match[0].length
      controller.enqueue(encoder.encode(restoreToolNames(available.slice(start, match.index), names) + match[0]))
      start = end
    }
    pending = pending.slice(start)
    if (final && pending) controller.enqueue(encoder.encode(restoreToolNames(pending, names)))
  }
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      emit(controller, false)
    },
    flush(controller) {
      pending += decoder.decode()
      emit(controller, true)
    },
  })
}

/**
 * Headers Claude Code sends. `anthropic-beta` is merged rather than replaced so
 * a provider- or config-supplied flag survives alongside the required ones.
 */
export function headers(existing?: Record<string, string>): Record<string, string> {
  const incoming = Object.entries(existing ?? {}).find(([key]) => key.toLowerCase() === "anthropic-beta")?.[1] ?? ""
  const merged = [
    ...new Set([
      ...betaFlags.split(","),
      ...incoming
        .split(",")
        .map((flag) => flag.trim())
        .filter(Boolean),
    ]),
  ].join(",")
  return {
    "anthropic-beta": merged,
    "anthropic-dangerous-direct-browser-access": "true",
    "user-agent": userAgent,
    "x-app": "cli",
  }
}
