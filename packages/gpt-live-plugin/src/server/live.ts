/**
 * GPT-Live wire contract for ChatGPT-subscription sessions.
 *
 * Call creation posts the WebRTC offer to the Codex backend, which returns the SDP answer
 * and a call id. The control channel ("sideband") is a WebSocket on the public Live API
 * joined with the same ChatGPT credentials. This mirrors what Codex does for its Voice
 * feature. None of it is a documented public API, so everything OpenAI-specific lives here.
 */

export const MODEL = "gpt-live-1-codex"
const CALL_URL = "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas"
const SIDEBAND_URL = "wss://api.openai.com/v1/live/"
const APPEND_MAX_BYTES = 500
const CALL_ID = /^(rtc_[\w-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export interface Auth {
  token: string
  accountID: string
}

export interface RequestIDs {
  realtimeSessionID: string
  sessionID: string
  threadID: string
}

export interface LiveSession {
  model: string
  instructions: string
  audio: { output: { voice: string } }
  delegation: { type: "client"; ack_filler?: boolean }
}

export class LiveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "LiveError"
  }
}

export function requestIDs(): RequestIDs {
  return {
    realtimeSessionID: crypto.randomUUID(),
    sessionID: crypto.randomUUID(),
    threadID: crypto.randomUUID(),
  }
}

export function headers(auth: Auth, ids: RequestIDs, version: string): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.token}`,
    "ChatGPT-Account-ID": auth.accountID,
    "OpenAI-Alpha": "quicksilver=v2",
    "session-id": ids.sessionID,
    "thread-id": ids.threadID,
    "x-session-id": ids.realtimeSessionID,
    originator: "opencode",
    "User-Agent": `opencode-gpt-live/${version}`,
  }
}

function redact(text: string, auth: Auth) {
  return text.split(auth.token).join("[redacted]").split(auth.accountID).join("[redacted]")
}

function describe(status: number, detail: string) {
  if (status === 401) return "ChatGPT rejected the sign-in (401). Sign in again with /connect → OpenAI → ChatGPT."
  if (status === 403)
    return "GPT-Live rejected the session (403). Your ChatGPT plan may not include voice, or the voice allowance is used up."
  if (status === 429) return "GPT-Live voice limit reached (429). Try again later."
  return `GPT-Live call creation failed (${status})${detail ? `: ${detail}` : ""}`
}

export function parseCallID(location: string | null, sessionHeader: string | null): string {
  if (location) {
    const segments = new URL(location, CALL_URL).pathname.split("/").filter(Boolean)
    const id = segments.find((segment) => CALL_ID.test(segment))
    if (id) return id
  }
  const fallback = sessionHeader?.trim()
  if (fallback && CALL_ID.test(fallback)) return fallback
  throw new LiveError("GPT-Live call response did not include a call id")
}

export async function createCall(input: {
  auth: Auth
  ids: RequestIDs
  sdp: string
  session: LiveSession
  version: string
  signal?: AbortSignal
}): Promise<{ callID: string; sdp: string }> {
  const response = await fetch(CALL_URL, {
    method: "POST",
    headers: { ...headers(input.auth, input.ids, input.version), "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: input.sdp, session: input.session }),
    signal: input.signal,
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const detail = redact(body.trim(), input.auth).slice(0, 300)
    throw new LiveError(describe(response.status, detail), response.status)
  }
  const callID = parseCallID(response.headers.get("location"), response.headers.get("openai-session-id"))
  const sdp = await response.text()
  if (!sdp.trim()) throw new LiveError("GPT-Live returned an empty SDP answer", response.status)
  return { callID, sdp }
}

export type LiveEvent =
  | { kind: "started" }
  | { kind: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { kind: "delegation"; id: string; text: string }
  | { kind: "speech-cleared" }
  | { kind: "closed"; reason?: string }
  | { kind: "error"; message: string; fatal: boolean }
  | { kind: "other"; type: string }

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined
}

function errorMessage(event: Json): string {
  const error = record(event.error)
  if (typeof error?.message === "string") return error.message
  if (typeof event.message === "string") return event.message
  if (typeof event.error === "string") return event.error
  return "GPT-Live error"
}

export function parseEvent(payload: string): LiveEvent | undefined {
  let event: Json | undefined
  try {
    event = record(JSON.parse(payload))
  } catch {
    return undefined
  }
  if (!event || typeof event.type !== "string") return undefined
  const type = event.type
  switch (type) {
    case "session.started":
      return { kind: "started" }
    case "input_transcript.added":
    case "output_transcript.added": {
      const text = record(event.item)?.text
      if (typeof text !== "string") return { kind: "other", type }
      return { kind: "transcript", role: type.startsWith("input") ? "user" : "assistant", text, final: false }
    }
    case "session.input_transcript.delta":
    case "session.output_transcript.delta": {
      if (typeof event.delta !== "string") return { kind: "other", type }
      return {
        kind: "transcript",
        role: type.includes("input") ? "user" : "assistant",
        text: event.delta,
        final: false,
      }
    }
    case "turn.done": {
      const turn = record(event.turn)
      if ((turn?.role !== "user" && turn?.role !== "assistant") || typeof turn.transcript !== "string")
        return { kind: "other", type }
      return { kind: "transcript", role: turn.role, text: turn.transcript, final: true }
    }
    case "delegation.created": {
      const item = record(event.item)
      if (!item || item.type !== "delegation" || item.target !== "client" || typeof item.id !== "string")
        return { kind: "other", type }
      const content = Array.isArray(item.content) ? item.content : []
      const text = content
        .map(record)
        .filter((part) => part?.type === "input_text" && typeof part.text === "string")
        .map((part) => part!.text as string)
        .join("")
      return { kind: "delegation", id: item.id, text }
    }
    case "output_audio_buffer.cleared":
      return { kind: "speech-cleared" }
    case "session.closed":
      return { kind: "closed", reason: typeof event.reason === "string" ? event.reason : undefined }
    case "error": {
      const error = record(event.error)
      const status = event.status ?? error?.status
      const code = String(event.code ?? error?.code ?? "").toLowerCase()
      const fatal =
        status === 401 || ["authentication_error", "invalid_token", "token_expired", "invalid_api_key"].includes(code)
      return { kind: "error", message: errorMessage(event), fatal }
    }
    default:
      return { kind: "other", type }
  }
}

/** Splits text into chunks that fit GPT-Live's per-append byte limit without breaking characters. */
export function chunk(text: string, maxBytes = APPEND_MAX_BYTES): string[] {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= maxBytes) return [text]
  const chunks: string[] = []
  let current = ""
  let bytes = 0
  for (const character of text) {
    const size = encoder.encode(character).length
    if (current && bytes + size > maxBytes) {
      chunks.push(current)
      current = ""
      bytes = 0
    }
    current += character
    bytes += size
  }
  if (current) chunks.push(current)
  return chunks
}

export type Channel = "speakable" | "commentary"

export function contextAppend(text: string, channel: Channel, delegationID?: string): Json[] {
  return chunk(text).map((part) => {
    const content = [{ type: "input_text", text: part }]
    return delegationID
      ? { type: "delegation.context.append", delegation_item_id: delegationID, channel, content }
      : { type: "session.context.append", channel, content }
  })
}

/** The control WebSocket for a live call. */
export class Sideband {
  private socket: WebSocket | undefined
  private closed = false

  private constructor(
    private readonly onEvent: (event: LiveEvent) => void,
    private readonly onClose: (reason: string) => void,
  ) {}

  static async connect(input: {
    callID: string
    auth: Auth
    ids: RequestIDs
    version: string
    onEvent: (event: LiveEvent) => void
    onClose: (reason: string) => void
    signal?: AbortSignal
  }): Promise<Sideband> {
    const sideband = new Sideband(input.onEvent, input.onClose)
    const url = `${SIDEBAND_URL}${encodeURIComponent(input.callID)}`
    // Up to five attempts with exponential backoff; each waits for the previous one to fail.
    const attempt = async (index: number): Promise<Sideband> => {
      input.signal?.throwIfAborted()
      try {
        await sideband.open(url, headers(input.auth, input.ids, input.version))
        return sideband
      } catch (error) {
        if (index >= 4)
          throw error instanceof Error ? error : new LiveError("GPT-Live control channel failed to connect")
        await Bun.sleep(200 * 2 ** index)
        return attempt(index + 1)
      }
    }
    return attempt(0)
  }

  private open(url: string, handshake: Record<string, string>) {
    return new Promise<void>((resolve, reject) => {
      // Bun's WebSocket accepts custom handshake headers.
      const socket = new WebSocket(url, { headers: handshake } as unknown as string[])
      const timeout = setTimeout(() => {
        socket.close()
        reject(new LiveError("GPT-Live control channel timed out"))
      }, 15_000)
      let opened = false
      socket.addEventListener("open", () => {
        opened = true
        clearTimeout(timeout)
        this.socket = socket
        resolve()
      })
      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") return
        const event = parseEvent(message.data)
        if (event) this.onEvent(event)
      })
      socket.addEventListener("error", () => {
        if (!opened) {
          clearTimeout(timeout)
          reject(new LiveError("GPT-Live control channel connection failed"))
        }
      })
      socket.addEventListener("close", (event) => {
        clearTimeout(timeout)
        if (!opened) {
          reject(new LiveError(`GPT-Live control channel closed during startup (${event.code})`))
          return
        }
        if (!this.closed) {
          this.closed = true
          this.onClose(event.reason || `closed (${event.code})`)
        }
      })
    })
  }

  send(message: Json) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  append(text: string, channel: Channel, delegationID?: string) {
    for (const message of contextAppend(text, channel, delegationID)) this.send(message)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.send({ type: "session.close" })
    setTimeout(() => this.socket?.close(1000, "session closed"), 250)
  }
}
