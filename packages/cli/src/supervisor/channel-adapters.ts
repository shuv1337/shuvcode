import { createHash } from "node:crypto"
import { lstat, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { SupervisorChannels } from "./channels"

/** ShuvBro Relay connector contract shared by X and Discord. Pairing tokens stay in process memory. */
export namespace SupervisorChannelAdapters {
  export type Offer = { id: string; text: string; origin: SupervisorChannels.Origin }
  export class KnownNotSentError extends Error {}

  /** Read ShuvBro fm-inbox.sh notes without changing its own ack/drain state. */
  export async function pollVoice(channel: SupervisorChannels.Channel) {
    if (channel.kind !== "voice" || !channel.enabled || !channel.directory) return []
    const files = (await readdir(channel.directory))
      .filter((name) => name.endsWith(".note"))
      .sort()
      .slice(0, 32)
    const notes = await Promise.all(
      files.map(async (name) => {
        const filename = path.join(channel.directory!, name)
        const details = await lstat(filename)
        if (!details.isFile() || details.size > 256_000) return undefined
        const content = await readFile(filename, "utf8")
        const separator = /^--\r?$/m.exec(content)
        if (!separator || separator.index === undefined) return undefined
        const body = content.slice(separator.index + separator[0].length).trim()
        if (!body) return undefined
        return { id: `voice-${createHash("sha256").update(filename).digest("hex").slice(0, 40)}`, text: body }
      }),
    )
    return notes.filter((note): note is { id: string; text: string } => Boolean(note))
  }

  export async function poll(
    channel: SupervisorChannels.Channel,
    token = process.env.FMX_PAIRING_TOKEN,
  ): Promise<Offer | undefined> {
    if (channel.kind !== "relay" || !channel.enabled || !channel.endpoint) return undefined
    if (!token) throw new Error("FMX_PAIRING_TOKEN is required for Relay polling")
    const response = await fetch(new URL("connector/poll", trailingSlash(channel.endpoint)), {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    })
    if (response.status === 204) return undefined
    if (!response.ok) throw new Error(`Relay poll returned HTTP ${response.status}`)
    const payload = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(await response.json())
    const requestID = payload.request_id
    const text = payload.text
    if (typeof requestID !== "string" || !requestID || typeof text !== "string" || !text.trim()) return undefined
    const platform = platformOf(payload)
    if (!platform) return undefined
    const max = maximumOf(payload)
    const content = JSON.stringify(payload)
    if (content.length > 256_000) throw new Error("Relay offer exceeds inbox text limit")
    return {
      id: `relay-${createHash("sha256").update(requestID).digest("hex").slice(0, 40)}`,
      text: content,
      origin: {
        channel: platform,
        threadID: requestID,
        author: typeof payload.author_handle === "string" ? payload.author_handle : undefined,
        replyMaxChars: max,
      },
    }
  }

  export async function send(input: {
    channel: SupervisorChannels.Channel
    reply: SupervisorChannels.Reply
    idempotencyKey: string
    image?: { media_type: string; data_base64: string }
    token?: string
  }): Promise<Schema.Json> {
    if (input.channel.kind !== "relay" || !input.channel.enabled || !input.channel.endpoint)
      throw new KnownNotSentError("Reply requires an enabled Relay channel")
    const token = input.token ?? process.env.FMX_PAIRING_TOKEN
    if (!token) throw new KnownNotSentError("FMX_PAIRING_TOKEN is required for Relay replies")
    const requestID = input.reply.origin.threadID
    if (!requestID || !input.reply.text) throw new KnownNotSentError("Relay reply lacks request ID or text")
    if (Boolean(input.reply.image) !== Boolean(input.image))
      throw new KnownNotSentError("Relay reply image payload is missing")
    const max =
      input.reply.origin.replyMaxChars ??
      (input.reply.mode === "answer"
        ? input.reply.origin.channel === "discord"
          ? 1900
          : 280
        : await requestMaximum(input.channel.endpoint, token, requestID, input.reply.origin.channel))
    const texts = split(input.reply.text, max)
    const body = {
      request_id: requestID,
      text: texts[0],
      ...(texts.length > 1 ? { texts } : {}),
      ...(input.image ? { image: input.image } : {}),
    }
    const response = await fetch(new URL(`connector/${input.reply.mode}`, trailingSlash(input.channel.endpoint)), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500)
        throw new KnownNotSentError(`Relay ${input.reply.mode} returned HTTP ${response.status}`)
      throw new Error(`Relay ${input.reply.mode} returned HTTP ${response.status}`)
    }
    return {
      status: response.status,
      requestID,
      mode: input.reply.mode,
      messages: texts.length,
      image: input.reply.image ?? null,
    }
  }

  export async function dismiss(input: {
    channel: SupervisorChannels.Channel
    note: SupervisorChannels.Note
    token?: string
  }): Promise<Schema.Json> {
    if (input.channel.kind !== "relay" || !input.channel.enabled || !input.channel.endpoint)
      throw new KnownNotSentError("Dismiss requires an enabled Relay channel")
    const token = input.token ?? process.env.FMX_PAIRING_TOKEN
    if (!token) throw new KnownNotSentError("FMX_PAIRING_TOKEN is required for Relay dismissal")
    const requestID = input.note.origin?.threadID
    if (input.note.source !== "relay" || input.note.origin?.channel !== input.channel.id || !requestID)
      throw new KnownNotSentError("Dismiss requires the original Relay request binding")
    const response = await fetch(new URL("connector/dismiss", trailingSlash(input.channel.endpoint)), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": input.note.id,
      },
      body: JSON.stringify({ request_id: requestID }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500)
        throw new KnownNotSentError(`Relay dismiss returned HTTP ${response.status}`)
      throw new Error(`Relay dismiss returned HTTP ${response.status}`)
    }
    return { status: response.status, requestID }
  }

  async function requestMaximum(
    endpoint: string,
    token: string,
    requestID: string,
    platform: "x" | "discord" | "local",
  ) {
    const response = await fetch(new URL("connector/request-context", trailingSlash(endpoint)), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ request_id: requestID }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new KnownNotSentError(`Relay request context returned HTTP ${response.status}`)
    const context = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(await response.json())
    if (platformOf(context) !== platform) throw new KnownNotSentError("Relay request platform could not be confirmed")
    const max = maximumOf(context)
    if (!max) throw new KnownNotSentError("Relay reply character budget could not be confirmed")
    return max
  }

  function platformOf(payload: Record<string, unknown>): "x" | "discord" | undefined {
    const explicit = ["reply_platform", "platform", "target_platform", "source_platform", "provider"]
      .map((key) => payload[key])
      .find((value) => value === "x" || value === "discord")
    if (explicit === "x" || explicit === "discord") return explicit
    const tweetID = payload.tweet_id
    if (typeof tweetID === "string" && tweetID.startsWith("discord:")) return "discord"
    if (typeof tweetID === "string" && /^\d+$/.test(tweetID)) return "x"
    return undefined
  }

  function maximumOf(payload: Record<string, unknown>): number | undefined {
    const value = ["reply_max_chars", "reply_max_characters", "message_max_chars", "message_limit", "max_chars"]
      .map((key) => payload[key])
      .find((part) => Number.isSafeInteger(part) && Number(part) >= 50 && Number(part) <= 2000)
    return typeof value === "number" ? value : undefined
  }

  function trailingSlash(value: string) {
    return value.endsWith("/") ? value : `${value}/`
  }

  function split(text: string, max: number) {
    const normalized = text.replace(/\r\n/g, "\n").trim()
    if (!normalized) throw new KnownNotSentError("Reply text is empty")
    const length = (value: string) => Array.from(value).length
    if (length(normalized) <= max) return [normalized]
    // Reserve room for numbering and a closing/reopened code fence on every chunk.
    const width = max - 16
    if (width < 20) throw new KnownNotSentError("Reply character budget is too small")
    const units: string[] = []
    let paragraph = ""
    let fence = ""
    for (const line of normalized.split("\n")) {
      if (fence) {
        fence += `\n${line}`
        if (/^\s*```/.test(line)) {
          units.push(fence)
          fence = ""
        }
        continue
      }
      if (/^\s*```/.test(line)) {
        if (paragraph) units.push(paragraph)
        paragraph = ""
        fence = line
        continue
      }
      if (!line.trim()) {
        if (paragraph) units.push(paragraph)
        paragraph = ""
        continue
      }
      paragraph = paragraph ? `${paragraph} ${line.trim()}` : line.trim()
    }
    if (paragraph) units.push(paragraph)
    if (fence) units.push(fence)
    const parts: string[] = []
    for (const unit of units) {
      if (length(unit) <= width) {
        const previous = parts.at(-1)
        if (previous && length(`${previous}\n\n${unit}`) <= width) parts[parts.length - 1] = `${previous}\n\n${unit}`
        else parts.push(unit)
        continue
      }
      if (/^\s*```/.test(unit)) {
        const lines = unit.split("\n")
        const opener = lines[0]!
        const hasCloser = lines.length > 1 && /^\s*```/.test(lines.at(-1)!)
        const body = hasCloser ? lines.slice(1, -1) : lines.slice(1)
        const innerWidth = width - length(opener) - 5
        if (innerWidth < 1) throw new KnownNotSentError("Code fence exceeds Relay character budget")
        const codeLines = body.flatMap((line) => {
          const characters = Array.from(line)
          return characters.length <= innerWidth
            ? [line]
            : Array.from({ length: Math.ceil(characters.length / innerWidth) }, (_, index) =>
                characters.slice(index * innerWidth, (index + 1) * innerWidth).join(""),
              )
        })
        let current = ""
        for (const line of codeLines) {
          const candidate = current ? `${current}\n${line}` : line
          if (length(candidate) <= innerWidth) {
            current = candidate
            continue
          }
          parts.push(`${opener}\n${current}\n\`\`\``)
          current = line
        }
        parts.push(`${opener}\n${current}\n\`\`\``)
        continue
      }
      const words = unit.split(/\s+/)
      let current = ""
      for (const word of words) {
        const characters = Array.from(word)
        const fragments =
          characters.length <= width
            ? [word]
            : Array.from({ length: Math.ceil(characters.length / width) }, (_, index) =>
                characters.slice(index * width, (index + 1) * width).join(""),
              )
        for (const fragment of fragments) {
          const candidate = current ? `${current} ${fragment}` : fragment
          if (length(candidate) <= width) {
            current = candidate
            continue
          }
          parts.push(current)
          current = fragment
        }
      }
      if (current) parts.push(current)
    }
    if (parts.length > 25) throw new KnownNotSentError("Reply exceeds the 25-message Relay thread limit")
    return parts.map((part, index) => {
      const mark = ` (${index + 1}/${parts.length})`
      const numbered = /\n\s*```$/.test(part) ? `${part}\n${mark.trim()}` : `${part}${mark}`
      if (length(numbered) > max) throw new KnownNotSentError("Reply chunk exceeds Relay character budget")
      return numbered
    })
  }
}
