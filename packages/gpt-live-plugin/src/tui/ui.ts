import type { Plugin } from "@opencode/plugin/tui"
import type { JSX } from "@opentui/solid"
/**
 * Voice UI built from OpenTUI renderables on OpenCode's renderer. Views are plain objects
 * redrawn by a frame clock; nothing here depends on OpenCode's Solid runtime.
 */
import {
  BoxRenderable,
  RGBA,
  ScrollBoxRenderable,
  StyledText,
  TextAttributes,
  TextRenderable,
  type Renderable,
} from "@opentui/core"

import { AuraCanvas, type AuraPalette, type Rgb } from "./aura"
import type { Entry, VoiceController } from "./controller"
import { debug, fallbackSurface, pickSurface, type Surface } from "./surface"
import { duration, flap, pulse, shimmer, spinner } from "./visuals"

type Context = Plugin.Context
type Theme = Context["theme"]

type Chunk = { __isChunk: true; text: string; fg?: RGBA; bg?: RGBA; attributes?: number }

function chunk(text: string, fg?: RGBA, options: { bg?: RGBA; bold?: boolean } = {}): Chunk {
  return {
    __isChunk: true,
    text,
    ...(fg ? { fg } : {}),
    ...(options.bg ? { bg: options.bg } : {}),
    ...(options.bold ? { attributes: TextAttributes.BOLD } : {}),
  }
}

function styled(chunks: Chunk[]) {
  return new StyledText(chunks as never)
}

function width(chunks: readonly Chunk[]) {
  return chunks.reduce((sum, item) => sum + [...item.text].length, 0)
}

export function mix(a: RGBA, b: RGBA, t: number) {
  const [ar, ag, ab] = a.toInts()
  const [br, bg, bb] = b.toInts()
  const k = Math.min(1, Math.max(0, t))
  return RGBA.fromInts(
    Math.round(ar + (br - ar) * k),
    Math.round(ag + (bg - ag) * k),
    Math.round(ab + (bb - ab) * k),
    255,
  )
}

function palette(theme: Theme) {
  const bg = theme.background.base
  // Only accent, interactive and neutral are guaranteed; themes migrated from v1 omit the named hues.
  const hues = theme.hue as unknown as Record<string, Record<number, RGBA> | undefined>
  const feedback = theme.text.feedback
  return {
    bg,
    text: theme.text.base,
    muted: theme.text.muted,
    mic: [
      hues.cyan?.[300] ?? theme.hue.interactive[300],
      hues.cyan?.[500] ?? theme.hue.interactive[500],
      hues.blue?.[400] ?? feedback.info.base,
    ] as const,
    speaker: [
      hues.purple?.[300] ?? theme.hue.accent[300],
      hues.purple?.[500] ?? theme.hue.accent[500],
      theme.hue.accent[500],
    ] as const,
    live: hues.green?.[500] ?? feedback.success.base,
    warn: hues.yellow?.[500] ?? feedback.warning.base,
    error: hues.red?.[500] ?? feedback.error.base,
    accent: theme.hue.accent[500],
    dim: mix(theme.text.muted, bg, 0.45),
  }
}

type Palette = ReturnType<typeof palette>

function shimmerChunks(text: string, time: number, color: RGBA, glow: RGBA): Chunk[] {
  const letters = [...text]
  const light = shimmer(letters.length, time)
  return letters.map((char, index) => chunk(char, mix(color, glow, light[index])))
}

/** Pads between left and right content so the row spans `total` cells. */
function row(left: Chunk[], right: Chunk[], total: number) {
  const gap = total - width(left) - width(right)
  if (gap < 1) return left
  return [...left, chunk(" ".repeat(gap)), ...right]
}

export interface View {
  readonly root: Renderable
  update(now: number): void
  /** True while the view needs frame-by-frame redraws. */
  animating(now: number): boolean
  /** Preferred frame interval in milliseconds while animating (default 33). */
  interval?(): number
  /** Hides anything drawn outside the renderable tree (e.g. herdr image layers). */
  suspend?(): void
  /** Releases resources outside the renderable tree. */
  dispose?(): void
}

/** The main-UI call strip above the prompt: status and activity. The aura lives on the side. */
export function voiceStrip(context: Context, voice: VoiceController, sessionID: () => string | undefined): View {
  const renderer = context.renderer
  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    flexShrink: 0,
  })
  // Single-line rows get an explicit height so they never collapse onto each other.
  const line = () => new TextRenderable(renderer, { content: "", wrapMode: "none", height: 1, flexShrink: 0 })
  const header = line()
  const activity = line()
  root.add(header)
  root.add(activity)
  root.visible = false

  const shortcut = (id: string, fallback: string) => context.keymap.shortcuts(id)[0] ?? fallback

  return {
    root,
    animating: () => voice.owns(sessionID()),
    update(now) {
      const show = voice.owns(sessionID())
      if (root.visible !== show) root.visible = show
      if (!show) return
      const state = voice.state
      const p = palette(context.theme)
      const total = Math.max(24, (root.width || renderer.width) - 2)

      // Status line.
      const status =
        state.phase === "connecting"
          ? { label: "CONNECTING", fg: p.warn, dot: spinner(now) }
          : state.phase === "closing"
            ? { label: "ENDING", fg: p.muted, dot: "◌" }
            : state.muted
              ? { label: "MUTED", fg: p.error, dot: "⊘" }
              : { label: "LIVE", fg: p.live, dot: "●" }
      const left: Chunk[] = [
        chunk(
          `${status.dot} `,
          mix(status.fg, p.bg, state.phase === "live" && !state.muted ? 0.35 * (1 - pulse(now, 900)) : 0),
        ),
        chunk(status.label, status.fg, { bold: true }),
        chunk(" · GPT-Live", p.muted),
      ]
      if (state.voice) left.push(chunk(` · ${state.voice}`, p.muted))
      if (state.call) left.push(chunk(` · call ${state.call}`, p.dim))
      if (state.phase === "live" && state.liveAt) left.push(chunk(`  ${duration(now - state.liveAt)}`, p.text))
      const full: Chunk[] = [
        chunk(shortcut("voice.panel", "/voice-panel"), p.muted),
        chunk(" transcript   ", p.dim),
        chunk(shortcut("voice.mute", "/voice-mute"), p.muted),
        chunk(state.muted ? " unmute" : " mute", p.dim),
        chunk(`   ${shortcut("voice.toggle", "/voice")}`, p.muted),
        chunk(' end · or say "end the call"', p.dim),
      ]
      const short: Chunk[] = [chunk(`${shortcut("voice.toggle", "/voice")}`, p.muted), chunk(" end", p.dim)]
      // Narrower strips drop the spoken hint first, then everything but the end key.
      const keys: Chunk[] = [
        chunk(shortcut("voice.panel", "/voice-panel"), p.muted),
        chunk(" transcript  ", p.dim),
        chunk(shortcut("voice.mute", "/voice-mute"), p.muted),
        chunk(state.muted ? " unmute  " : " mute  ", p.dim),
        ...short,
      ]
      const hints = [full, keys, short].find((option) => width(left) + width(option) + 2 <= total) ?? short
      header.content = styled(row(left, hints, total))

      // Activity line.
      const you: Chunk[] = [
        chunk("you ", p.mic[1]),
        chunk(state.muted ? "muted" : state.micLevel > 0.12 ? "speaking" : "listening", state.muted ? p.error : p.dim),
      ]
      if (state.speakerLevel > 0.12) you.push(chunk("   ", p.dim), chunk("GPT-Live speaking", p.speaker[1]))
      if (state.voiceActivity) {
        you.push(
          chunk("   "),
          chunk(`${spinner(now)} `, p.speaker[1]),
          ...shimmerChunks(state.voiceActivity, now, p.muted, p.speaker[0]),
        )
      }
      const main: Chunk[] = state.mainActivity
        ? [
            chunk(`${spinner(now + 400)} `, p.accent),
            chunk("OpenCode ", p.text),
            ...shimmerChunks(state.mainActivity, now + 900, p.muted, p.accent),
            ...(state.queued ? [chunk(` · ${state.queued} queued`, p.dim)] : []),
          ]
        : [chunk(state.queued ? `OpenCode · ${state.queued} queued` : "OpenCode idle", p.dim)]
      activity.content = styled(row(you, main, total))
    },
  }
}

function rgb(color: RGBA): Rgb {
  const [r, g, b] = color.toInts()
  return [r, g, b]
}

// Speaker colors are fixed rather than taken from the theme: themes often map their hues to
// greys or teals, and telling you and GPT-Live apart at a glance matters more than matching.
const AURA_USER = [
  [80, 225, 255],
  [45, 140, 255],
] as const
const AURA_ASSISTANT = [
  [175, 110, 255],
  [255, 85, 205],
] as const

function auraPalette(p: Palette): AuraPalette {
  return {
    user: AURA_USER,
    assistant: AURA_ASSISTANT,
    rest: [rgb(mix(p.muted, p.text, 0.35)), rgb(p.muted)],
    connecting: [255, 190, 90],
    muted: rgb(mix(p.muted, p.error, 0.2)),
  }
}

const AURA_COLS = 24

/**
 * The voice aura: a glowing woven ring that swells with the voice, cyan while you speak and
 * violet while GPT-Live speaks, with a one-line caption underneath. Drawn as an image where
 * the terminal supports it, otherwise with half-block characters.
 */
export function voiceAura(context: Context, voice: VoiceController, visible: () => boolean, layer: string): View {
  const renderer = context.renderer
  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
    paddingTop: 1,
    paddingBottom: 1,
  })
  const caption = new TextRenderable(renderer, { content: "", wrapMode: "none", height: 1, flexShrink: 0 })
  let surface: Surface = pickSurface(context, layer, AURA_COLS / 2)
  root.add(surface.node)
  root.add(caption)
  root.visible = false

  let canvas: AuraCanvas | undefined
  let level = 0
  let speaker = 1
  let last = 0

  const hide = () => {
    surface.hide()
    if (root.visible) root.visible = false
  }

  return {
    root,
    animating: () => visible() && voice.active,
    interval: () => surface.interval,
    suspend: hide,
    dispose: () => surface.dispose(),
    update(now) {
      if (!visible() || !voice.active) return hide()
      if (!root.visible) root.visible = true
      if (!surface.healthy()) {
        debug({ event: "surface-fallback", layer, from: surface.kind })
        surface.dispose()
        root.remove(surface.node)
        surface.node.destroyRecursively()
        surface = fallbackSurface(context, AURA_COLS / 2)
        root.add(surface.node, 0)
      }
      const state = voice.state
      const p = palette(context.theme)

      // Time-based smoothing: quick to swell, slower to settle, the same at any frame rate.
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      const mic = state.muted ? 0 : state.micLevel
      const target = Math.max(mic, state.speakerLevel)
      level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.04 : 0.2)))
      // Hold the last speaker's identity through pauses instead of drifting to a blend.
      if (target > 0.04) speaker += ((state.speakerLevel >= mic ? 1 : 0) - speaker) * (1 - Math.exp(-dt / 0.15))

      const available = (root.parent?.width ?? AURA_COLS + 2) - 2
      const cols = Math.max(12, Math.min(AURA_COLS, available - (available % 2)))
      const input = {
        time: now - state.startedAt,
        phase: state.phase,
        liveFor: state.liveAt ? now - state.liveAt : Number.POSITIVE_INFINITY,
        // Perceptual curve: quiet speech should still move the ring.
        level: Math.min(1, Math.sqrt(level) * 1.1),
        speaker,
        muted: state.muted,
        palette: auraPalette(p),
      }
      if (process.env.GPT_LIVE_DEBUG && Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000))
        debug({
          event: "aura",
          layer,
          level: input.level,
          speaker,
          mic,
          out: state.speakerLevel,
          palette: input.palette,
        })
      surface.draw(
        (pixelWidth, pixelHeight) => {
          if (!canvas || canvas.width !== pixelWidth || canvas.height !== pixelHeight)
            canvas = new AuraCanvas(pixelWidth, pixelHeight)
          return canvas.draw(input)
        },
        cols,
        cols / 2,
        p.bg,
      )

      const talking = state.speakerLevel > 0.12 ? "assistant" : mic > 0.12 ? "user" : undefined
      const words: Chunk[] =
        state.phase === "connecting"
          ? [chunk(`${spinner(now)} connecting`, p.warn)]
          : state.phase === "closing"
            ? [chunk("ending call", p.muted)]
            : state.muted
              ? [chunk("⊘ muted", p.error)]
              : talking === "assistant"
                ? [chunk("GPT-Live speaking", RGBA.fromInts(...AURA_ASSISTANT[0], 255))]
                : talking === "user"
                  ? [chunk("you're speaking", RGBA.fromInts(...AURA_USER[0], 255))]
                  : [chunk("listening", p.dim)]
      if (state.phase === "live" && state.liveAt) words.push(chunk(`  ${duration(now - state.liveAt)}`, p.muted))
      caption.content = styled(words)
    },
  }
}

const TASK_ICONS = { queued: "◌", done: "✓", failed: "✗", cancelled: "⊘" } as const

function entryChunks(entry: Entry, now: number, p: Palette): Chunk[] {
  if (entry.kind === "user" || entry.kind === "assistant") {
    const user = entry.kind === "user"
    const label = chunk(user ? "you  " : "live ", entry.past ? p.dim : user ? p.mic[1] : p.speaker[1], { bold: true })
    const base = entry.past ? p.dim : entry.final ? p.text : mix(p.text, p.muted, 0.3)
    const glow = user ? p.mic[0] : p.speaker[0]
    const text = flap(entry.text, entry.arrivals, now).map((item) =>
      chunk(item.char, item.state === "flipping" ? p.dim : item.state === "glowing" ? glow : base),
    )
    const cursor = entry.final
      ? []
      : [chunk(` ${spinner(now, ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"], 70)}`, p.dim)]
    return [label, ...text, ...cursor]
  }
  if (entry.kind === "task") {
    const color =
      entry.status === "done"
        ? p.live
        : entry.status === "failed"
          ? p.error
          : entry.status === "cancelled"
            ? p.muted
            : p.accent
    const icon = entry.status === "running" ? spinner(now) : TASK_ICONS[entry.status]
    return [
      chunk("▌ ", color),
      chunk(`${icon} `, color),
      chunk("OpenCode", p.text, { bold: true }),
      chunk(` · ${entry.status}\n`, p.dim),
      chunk("▌ ", color),
      chunk(entry.text, p.muted),
      ...(entry.detail ? [chunk(`\n▌ ${entry.detail}`, p.error)] : []),
    ]
  }
  const notice = entry as Extract<Entry, { kind: "notice" }>
  const error = notice.tone === "error"
  return [chunk(error ? "! " : "· ", error ? p.error : p.dim), chunk(notice.text, error ? p.error : p.muted)]
}

function entryAnimating(entry: Entry, now: number) {
  if (entry.kind === "task") return entry.status === "running" || entry.status === "queued"
  if (entry.kind === "notice") return false
  if (!entry.final) return true
  const last = entry.arrivals[entry.arrivals.length - 1]
  return last !== undefined && now - last < 400
}

/** The side-panel transcript, with the aura on top while a call is on. */
export function transcriptPanel(context: Context, voice: VoiceController, visible: () => boolean): View {
  const renderer = context.renderer
  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
    paddingLeft: 1,
    paddingRight: 1,
  })
  // Fixed heights: two empty single-line texts otherwise collapse onto the same row, and
  // the header's glyphs show through the gaps in the device line.
  const header = new TextRenderable(renderer, { content: "", wrapMode: "none", height: 1, flexShrink: 0 })
  const devices = new TextRenderable(renderer, { content: "", wrapMode: "none", height: 1, flexShrink: 0 })
  const scroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: true,
    // Never take keyboard focus from the prompt.
    focusable: false,
    stickyStart: "bottom",
    marginTop: 1,
  })
  const aura = voiceAura(context, voice, visible, "gptlive-aura-panel")
  root.add(aura.root)
  root.add(header)
  root.add(devices)
  root.add(scroll)
  const rendered = new Map<string, { text: TextRenderable; key: string }>()
  let empty: TextRenderable | undefined

  return {
    root,
    animating: (now) => voice.active || voice.state.entries.some((entry) => entryAnimating(entry, now)),
    interval: () => (aura.animating(Date.now()) ? aura.interval!() : 33),
    suspend: () => aura.suspend!(),
    dispose: () => aura.dispose!(),
    update(now) {
      aura.update(now)
      const state = voice.state
      const p = palette(context.theme)
      const phase =
        state.phase === "connecting"
          ? [chunk(` ${spinner(now)} connecting`, p.warn)]
          : state.phase === "live"
            ? [chunk(" ● live ", p.live), chunk(state.liveAt ? duration(now - state.liveAt) : "", p.muted)]
            : state.phase === "error"
              ? [chunk(" ! failed", p.error)]
              : [chunk(" · not in a call", p.dim)]
      header.content = styled([
        chunk("◉ ", p.speaker[1]),
        chunk(state.voiceTitle ?? "Voice", p.text, { bold: true }),
        ...(state.call ? [chunk(` · call ${state.call}`, p.muted)] : []),
        ...phase,
      ])
      devices.content = styled(state.devices ? [chunk(`${state.devices.input} → ${state.devices.output}`, p.dim)] : [])

      if (state.entries.length === 0) {
        if (!empty) {
          empty = new TextRenderable(renderer, { content: "", wrapMode: "word" })
          scroll.add(empty)
        }
        const key = context.keymap.shortcuts("voice.toggle")[0]
        empty.content = styled([
          chunk(`No voice call yet. Run /voice${key ? ` or press ${key}` : ""} to start one.`, p.dim),
        ])
      } else if (empty) {
        scroll.remove(empty)
        empty.destroy()
        empty = undefined
      }

      const live = new Set<string>()
      for (const [index, entry] of state.entries.entries()) {
        live.add(entry.id)
        let item = rendered.get(entry.id)
        if (!item) {
          const text = new TextRenderable(renderer, { content: "", wrapMode: "word", marginBottom: 1 })
          // Insert in transcript order (earlier-call lines arrive after the first notice).
          scroll.add(text, index)
          item = { text, key: "" }
          rendered.set(entry.id, item)
        }
        const animating = entryAnimating(entry, now)
        const key = `${state.revision}:${entry.kind === "task" ? entry.status : ""}`
        if (!animating && item.key === key) continue
        item.key = animating ? "" : key
        item.text.content = styled(entryChunks(entry, now, p))
      }
      for (const [id, item] of rendered) {
        if (live.has(id)) continue
        scroll.remove(item.text)
        item.text.destroy()
        rendered.delete(id)
      }
    },
  }
}

/** A small live indicator for the footer. */
export function footerBadge(context: Context, voice: VoiceController): View {
  const text = new TextRenderable(context.renderer, { content: "", wrapMode: "none", height: 1 })
  text.visible = false
  return {
    root: text,
    animating: () => voice.active,
    update(now) {
      const show = voice.active
      if (text.visible !== show) text.visible = show
      if (!show) return
      const state = voice.state
      const p = palette(context.theme)
      const dot =
        state.phase === "connecting"
          ? chunk(spinner(now), p.warn)
          : state.muted
            ? chunk("⊘", p.error)
            : chunk("●", mix(p.live, p.accent, pulse(now, 900)))
      text.content = styled([
        dot,
        chunk(" voice", p.muted),
        ...(state.phase === "live" && state.liveAt ? [chunk(` ${duration(now - state.liveAt)}`, p.dim)] : []),
      ])
    },
  }
}

/**
 * Drives every mounted view: redraws on state changes, and while anything is animating at
 * the fastest rate an animating view asks for (60 fps for the image aura, else 30). Views whose renderables were removed by the host are dropped automatically.
 */
export class Frames {
  private readonly views = new Set<View>()
  private timer: ReturnType<typeof setInterval> | undefined
  private period = 0
  private readonly stopListening: () => void

  constructor(private readonly voice: VoiceController) {
    this.stopListening = voice.onChange(() => this.tick())
  }

  mount(view: View) {
    this.views.add(view)
    this.tick()
    // Slots accept renderables at runtime; Solid's JSX.Element type only names DOM nodes.
    return view.root as unknown as JSX.Element
  }

  private tick() {
    const now = Date.now()
    let animating = false
    let period = 33
    for (const view of this.views) {
      if (view.root.isDestroyed) {
        view.dispose?.()
        this.views.delete(view)
        continue
      }
      try {
        view.update(now)
        if (view.animating(now)) {
          animating = true
          period = Math.min(period, view.interval?.() ?? 33)
        }
      } catch (error) {
        // Keep other views and the call alive if one view fails to draw.
        debug({ event: "view-error", error: error instanceof Error ? (error.stack ?? error.message) : String(error) })
      }
    }
    if (this.timer && (!animating || period !== this.period)) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (animating && !this.timer) {
      this.period = period
      this.timer = setInterval(() => this.tick(), period)
    }
  }

  dispose() {
    this.stopListening()
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const view of this.views) {
      view.dispose?.()
      if (!view.root.isDestroyed) view.root.destroyRecursively()
    }
    this.views.clear()
  }
}
