import type { Plugin } from "@opencode/plugin/tui"

import { GptLive, type TaskStatus, type Voice } from "../shared/rpc"
import { HelperProcess, ensureHelper, type HelperEvent } from "./helper"
import { arrivalsFor, type Phase } from "./visuals"

type Context = Plugin.Context
type Location = { directory: string; workspaceID?: string }

export type Entry =
  | {
      id: string
      kind: "user" | "assistant"
      text: string
      arrivals: number[]
      final: boolean
      at: number
      /** From a previous call; shown dimmed. */
      past?: boolean
    }
  | { id: string; kind: "task"; taskID: string; text: string; status: TaskStatus; detail?: string; at: number }
  | { id: string; kind: "notice"; text: string; tone: "info" | "error"; at: number }

export interface VoiceState {
  phase: Phase
  callID?: string
  sessionID?: string
  voiceSessionID?: string
  location?: Location
  voice?: string
  model?: string
  voiceTitle?: string
  call?: number
  muted: boolean
  startedAt: number
  liveAt: number
  micLevel: number
  speakerLevel: number
  voiceActivity?: string
  mainActivity?: string
  queued: number
  devices?: { input: string; output: string }
  entries: Entry[]
  error?: string
  /** Increments on every change so views can skip redundant work. */
  revision: number
}

const initial = (): VoiceState => ({
  phase: "idle",
  muted: false,
  startedAt: 0,
  liveAt: 0,
  micLevel: 0,
  speakerLevel: 0,
  queued: 0,
  entries: [],
  revision: 0,
})

let entryCounter = 0
const nextID = () => `e${++entryCounter}`

/**
 * Owns one voice call from the terminal: the native audio helper, the RPC calls to the
 * server plugin, and the call state the UI renders. State is a plain object with change
 * listeners, so the UI does not depend on sharing OpenCode's reactive runtime.
 */
export class VoiceController {
  readonly state: VoiceState = initial()
  private readonly listeners = new Set<() => void>()
  private helper: HelperProcess | undefined
  private readonly unsubscribe: Array<() => void> = []
  private starting = false

  constructor(
    private readonly context: Context,
    private readonly options: { voice?: Voice; duck?: boolean },
  ) {
    this.subscribe()
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private changed() {
    this.state.revision++
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // A broken view must not break the call.
      }
    }
  }

  private set(patch: Partial<VoiceState>) {
    Object.assign(this.state, patch)
    this.changed()
  }

  private rpc() {
    return this.context.client.rpc(GptLive)
  }

  private subscribe() {
    const rpc = this.rpc()
    const mine = (event: { data: { callID: string } }) => event.data.callID === this.state.callID
    this.unsubscribe.push(
      rpc.events.on("state", (event) => {
        if (!mine(event)) return
        const { state, message } = event.data
        if (state === "live" && this.state.phase === "connecting") this.markLive()
        if (state === "error" && message) this.notice(message, "error")
        if (state === "closed") void this.teardown(undefined, message && message !== "closed" ? message : undefined)
      }),
      rpc.events.on("transcript", (event) => {
        if (!mine(event)) return
        this.transcript(event.data.role, event.data.text, event.data.final)
      }),
      rpc.events.on("task", (event) => {
        if (!mine(event)) return
        this.task(event.data.taskID, event.data.text, event.data.status, event.data.detail)
      }),
      rpc.events.on("activity", (event) => {
        if (!mine(event)) return
        const label = event.data.busy ? (event.data.label ?? "working") : undefined
        this.set(event.data.scope === "voice" ? { voiceActivity: label } : { mainActivity: label })
      }),
    )
  }

  get active() {
    return this.state.phase === "connecting" || this.state.phase === "live" || this.state.phase === "closing"
  }

  /** Whether this session is part of the current call (the main or the voice session). */
  owns(sessionID: string | undefined) {
    return !!sessionID && this.active && (sessionID === this.state.sessionID || sessionID === this.state.voiceSessionID)
  }

  private markLive() {
    this.set({ phase: "live", liveAt: Date.now() })
    const hangUp = this.context.keymap.shortcuts("voice.toggle")[0]
    this.notice(
      `Connected. Start talking. Say "end the call"${hangUp ? `, press ${hangUp},` : ""} or run /voice to hang up.`,
      "info",
    )
  }

  async start(sessionID: string, voice?: Voice, fresh = false) {
    if (this.active || this.starting) return
    this.starting = true
    const session = this.context.data.session.get(sessionID) as { location?: Location } | undefined
    const location = session?.location ?? this.context.location ?? this.context.data.location.default()
    Object.assign(this.state, initial(), {
      phase: "connecting" as Phase,
      sessionID,
      location,
      startedAt: Date.now(),
      revision: this.state.revision,
    })
    this.notice("Connecting to GPT-Live…", "info")
    try {
      const binary = await ensureHelper(this.context.app.version, (message) =>
        this.context.ui.toast.show({ message, variant: "info" }),
      )
      const helper = new HelperProcess(binary, {
        onEvent: (event) => this.onHelperEvent(event),
        onExit: (code, stderr) => {
          if (this.helper !== helper) return
          this.helper = undefined
          if (this.active)
            void this.stop(code ? `Audio stopped unexpectedly: ${stderr.trim().split("\n").pop() ?? code}` : undefined)
        },
      })
      this.helper = helper
      // Developer overrides for headless testing: a WAV file as the microphone, and
      // "none" or a WAV path as the speaker.
      const inputFile = process.env.GPT_LIVE_INPUT_FILE
      const output = process.env.GPT_LIVE_OUTPUT
      const offer = await helper.start({
        input: inputFile ? { file: inputFile } : undefined,
        output: output ? (output === "none" ? "none" : { file: output }) : undefined,
        duck: this.options.duck,
      })
      const call = await this.rpc().start(
        { sessionID, sdp: offer, voice: voice ?? this.options.voice, fresh },
        { location },
      )
      const past = call.previous.map(
        (turn): Entry => ({
          id: nextID(),
          kind: turn.role,
          text: turn.text,
          arrivals: [],
          final: true,
          at: 0,
          past: true,
        }),
      )
      this.set({
        callID: call.callID,
        voiceSessionID: call.voiceSessionID,
        voice: call.voice,
        model: call.model,
        voiceTitle: call.voiceTitle,
        call: call.call,
        entries: [...past, ...this.state.entries],
      })
      for (const notice of call.notices ?? []) this.notice(notice, "info")
      this.heartbeat(call.callID)
      await helper.answer(call.sdp)
      if (this.state.phase === "connecting") this.markLive()
    } catch (error) {
      await this.teardown(describeError(error))
    } finally {
      this.starting = false
    }
  }

  async stop(failure?: string) {
    if (!this.active) return
    this.set({ phase: "closing" })
    const { callID, location } = this.state
    if (callID)
      await this.rpc()
        .stop({ callID }, { location })
        .catch(() => undefined)
    await this.teardown(failure)
  }

  private tearingDown = false

  private async teardown(failure?: string, reason?: string) {
    if (this.state.phase === "idle" || this.state.phase === "error" || this.tearingDown) return
    this.tearingDown = true
    try {
      await this.finishTeardown(failure, reason)
    } finally {
      this.tearingDown = false
    }
  }

  private pulse: ReturnType<typeof setInterval> | undefined

  /** Tells the server this window still owns the call, so abandoned calls get cleaned up. */
  private heartbeat(callID: string) {
    clearInterval(this.pulse)
    this.pulse = setInterval(() => void this.checkAlive(callID), 5_000)
  }

  private async checkAlive(callID: string) {
    if (this.state.callID !== callID || !this.active) {
      clearInterval(this.pulse)
      return
    }
    const reply = await this.rpc()
      .alive({ callID }, { location: this.state.location })
      .catch(() => undefined)
    // The server no longer knows this call (e.g. it restarted): close it here too.
    if (reply && !reply.active && this.state.callID === callID && this.active)
      await this.teardown(undefined, "Call closed")
  }

  private async finishTeardown(failure?: string, reason?: string) {
    clearInterval(this.pulse)
    this.pulse = undefined
    const helper = this.helper
    this.helper = undefined
    await helper?.close().catch(() => helper.kill())
    const lasted = this.state.liveAt ? Date.now() - this.state.liveAt : 0
    this.set({ phase: failure ? "error" : "idle", error: failure, voiceActivity: undefined, mainActivity: undefined })
    if (failure) {
      this.notice(failure, "error")
      this.context.ui.toast.show({ title: "GPT-Live", message: failure, variant: "error", duration: 8000 })
      return
    }
    const minutes = Math.max(1, Math.round(lasted / 60_000))
    const summary = `Call ended${reason ? ` (${reason.toLowerCase()})` : ""}${
      lasted ? ` after ${lasted < 60_000 ? "under a minute" : `${minutes} min`}` : ""
    }.`
    this.notice(summary, "info")
    this.context.ui.toast.show({ title: "GPT-Live", message: summary, variant: "info", duration: 4000 })
  }

  toggleMute() {
    if (!this.active) return
    const muted = !this.state.muted
    this.set({ muted })
    this.helper?.mute(muted)
  }

  async say(text: string) {
    const callID = this.state.callID
    if (!callID || !this.active) return
    await this.rpc()
      .say({ callID, text }, { location: this.state.location })
      .catch(() => undefined)
    this.entry({
      id: nextID(),
      kind: "user",
      text,
      arrivals: arrivalsFor("", [], text, Date.now()),
      final: true,
      at: Date.now(),
    })
  }

  private onHelperEvent(event: HelperEvent) {
    switch (event.type) {
      case "levels": {
        const mic = Number(event.mic) || 0
        const speaker = Number(event.speaker) || 0
        // Levels arrive 20 times a second; the UI animates on its own clock, so skip listeners.
        this.state.micLevel = mic
        this.state.speakerLevel = speaker
        return
      }
      case "audio": {
        const input = event.input as { name?: string } | undefined
        const output = event.output as { name?: string } | undefined
        this.set({ devices: { input: input?.name ?? "microphone", output: output?.name ?? "speaker" } })
        return
      }
      case "warning":
        this.notice(String(event.message), "info")
        return
      case "error":
        if (event.fatal) void this.stop(String(event.message))
        return
    }
  }

  private entry(entry: Entry) {
    this.set({ entries: [...this.state.entries.slice(-199), entry] })
  }

  private notice(text: string, tone: "info" | "error") {
    this.entry({ id: nextID(), kind: "notice", text, tone, at: Date.now() })
  }

  private transcript(role: "user" | "assistant", text: string, final: boolean) {
    const now = Date.now()
    const entries = this.state.entries
    let open: Extract<Entry, { kind: "user" | "assistant" }> | undefined
    for (let i = entries.length - 1; i >= 0 && i >= entries.length - 6; i--) {
      const candidate = entries[i]
      if (candidate.kind === role && !candidate.final) {
        open = candidate
        break
      }
    }
    if (!open) {
      const clean = final ? text.trim() : text.trimStart()
      if (!clean) return
      this.entry({ id: nextID(), kind: role, text: clean, arrivals: arrivalsFor("", [], clean, now), final, at: now })
      return
    }
    const next = final ? text.trim() : open.text + text
    open.arrivals = arrivalsFor(open.text, open.arrivals, next, now)
    open.text = next
    open.final = final
    this.changed()
  }

  private task(taskID: string, text: string, status: TaskStatus, detail?: string) {
    const existing = this.state.entries.find(
      (entry): entry is Extract<Entry, { kind: "task" }> => entry.kind === "task" && entry.taskID === taskID,
    )
    if (existing) {
      existing.status = status
      existing.detail = detail
    } else {
      this.state.entries = [
        ...this.state.entries.slice(-199),
        { id: nextID(), kind: "task", taskID, text, status, detail, at: Date.now() },
      ]
    }
    this.state.queued = this.state.entries.filter((entry) => entry.kind === "task" && entry.status === "queued").length
    this.changed()
  }

  async dispose() {
    for (const stop of this.unsubscribe.splice(0)) stop()
    await this.stop()
    this.listeners.clear()
  }
}

/** Readable text for errors from the helper, RPC or network, which are not always Errors. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; data?: { message?: unknown }; error?: unknown }
    if (typeof value.message === "string") return value.message
    if (typeof value.data?.message === "string") return value.data.message
    if (value.error !== undefined && value.error !== error) return describeError(value.error)
    try {
      return JSON.stringify(error)
    } catch {}
  }
  return String(error)
}
