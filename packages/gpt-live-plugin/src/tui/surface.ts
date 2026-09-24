import type { Plugin } from "@opencode/plugin/tui"
/**
 * Pixel surfaces: somewhere to show an RGBA animation inside the terminal UI.
 * - kitty: kitty graphics commands over an empty slot (Ghostty, kitty, WezTerm and other
 *   kitty-graphics terminals)
 * - herdr: frames streamed through herdr's pane graphics API (herdr does not display kitty
 *   images printed by programs)
 * - blocks: half-block characters with true color, for every other terminal
 * The choice is automatic; GPT_LIVE_VISUAL or the `visual` option can force one.
 */
import { BoxRenderable, RGBA, StyledText, TextRenderable, type Renderable } from "@opentui/core"

import { HerdrStream, detectHerdr, type HerdrPane } from "./herdr"
import { framePixels, imageIDs, kittyDelete, kittyFrame } from "./kitty"

type Context = Plugin.Context
type Renderer = Context["renderer"]

/** Draws a frame of the given pixel size and returns its RGBA buffer. */
export type Painter = (width: number, height: number) => Uint8Array

export interface Surface {
  readonly kind: "kitty" | "herdr" | "blocks"
  /** Frame interval this surface can sustain, in milliseconds. */
  readonly interval: number
  /** Occupies the surface's cells in the layout. */
  readonly node: Renderable
  draw(paint: Painter, cols: number, rows: number, background: RGBA): void
  hide(): void
  dispose(): void
  /** False once the surface failed and the caller should switch to another. */
  healthy(): boolean
}

export function debug(entry: Record<string, unknown>) {
  const file = process.env.GPT_LIVE_DEBUG
  if (!file) return
  try {
    require("node:fs").appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch {
    // Diagnostics must never break the UI.
  }
}

export function pickSurface(context: Context, layer: string, rows: number): Surface {
  const renderer = context.renderer
  const forced = (context.options as { visual?: string }).visual ?? process.env.GPT_LIVE_VISUAL
  // A multiplexer nested inside herdr inherits herdr's environment, but herdr's pane
  // coordinates no longer match what is on screen.
  const nested = !!(process.env.TMUX || process.env.STY || process.env.ZELLIJ)
  const herdr = nested ? undefined : detectHerdr()
  const write = rawWriter(renderer)
  const kind =
    forced === "blocks" || forced === "kitty" || forced === "herdr"
      ? forced
      : herdr
        ? "herdr"
        : renderer.capabilities?.kitty_graphics
          ? "kitty"
          : "blocks"
  debug({ event: "surface", layer, kind, forced, herdr: !!herdr, writer: !!write, capabilities: renderer.capabilities })
  if (kind === "herdr" && herdr) return herdrSurface(renderer, rows, herdr, layer)
  if (kind === "kitty" && write) return kittySurface(renderer, rows, layer, write)
  return blockSurface(renderer, rows)
}

export function fallbackSurface(context: Context, rows: number): Surface {
  return blockSurface(context.renderer, rows)
}

/** True when the node and all its ancestors are visible and attached to the renderer. */
function shown(node: Renderable, renderer: Renderer) {
  let current: Renderable | null = node
  while (current) {
    if (!current.visible || current.isDestroyed) return false
    if (current === (renderer.root as unknown)) return true
    current = current.parent
  }
  return false
}

type Write = (data: string) => void

/**
 * The renderer's output queue. It is not in OpenTUI's public types, but it is how OpenTUI itself
 * writes control sequences, and going through it keeps them from interleaving with a frame.
 */
function rawWriter(renderer: Renderer): Write | undefined {
  const writeOut = (renderer as unknown as { writeOut?: (chunk: string) => unknown }).writeOut
  return typeof writeOut === "function" ? (data) => void writeOut.call(renderer, data) : undefined
}

/**
 * Kitty graphics drawn over an empty slot, like the herdr surface: the slot's cells keep the
 * panel's background, and each frame is placed before the previous one is deleted (two
 * alternating image IDs), so a late frame never shows an empty (terminal-background) box.
 */
function kittySurface(renderer: Renderer, rows: number, layer: string, write: Write): Surface {
  const slot = new BoxRenderable(renderer, { height: rows, flexShrink: 0 })
  const ids = imageIDs(layer)
  let failed = false
  /** The image currently on screen, if any. */
  let showing: number | undefined
  let settled = false
  let seen = ""
  const remove = () => {
    if (showing !== undefined) write(kittyDelete(showing))
    showing = undefined
    settled = false
    seen = ""
  }
  return {
    kind: "kitty",
    interval: 33,
    node: slot,
    healthy: () => !failed && !slot.isDestroyed,
    draw(paint, cols, surfaceRows) {
      if (slot.width !== cols) slot.width = cols
      if (slot.height !== surfaceRows) slot.height = surfaceRows
      if (!shown(slot, renderer) || slot.width <= 0 || slot.height <= 0) return remove()
      // Place the image only once the slot's position has held for a frame, so it doesn't
      // appear at a stale spot while the layout settles. After that it follows the slot.
      const at = `${slot.x},${slot.y},${cols},${surfaceRows}`
      if (!settled) {
        settled = at === seen
        seen = at
        if (!settled) return
      }
      try {
        const size = framePixels(cols, surfaceRows, renderer.resolution, {
          width: renderer.terminalWidth,
          height: renderer.terminalHeight,
        })
        const id = showing === ids[0] ? ids[1] : ids[0]
        write(
          kittyFrame({
            id,
            col: slot.x,
            row: slot.y,
            cols,
            rows: surfaceRows,
            ...size,
            rgba: paint(size.width, size.height),
            replaces: showing,
          }),
        )
        showing = id
      } catch (error) {
        failed = true
        remove()
        debug({ event: "kitty-draw-error", error: String(error) })
      }
    },
    hide: remove,
    dispose: remove,
  }
}

function herdrSurface(renderer: Renderer, rows: number, pane: HerdrPane, layer: string): Surface {
  // An empty box reserves the cells; herdr draws the image over them.
  const slot = new BoxRenderable(renderer, { height: rows, flexShrink: 0 })
  let failed = false
  const stream = new HerdrStream(pane, layer, (error) => {
    failed = true
    debug({ event: "herdr-error", error })
  })
  let lastSent = 0
  return {
    kind: "herdr",
    interval: 33,
    node: slot,
    healthy: () => !failed && !slot.isDestroyed,
    draw(paint, cols, surfaceRows) {
      if (slot.width !== cols) slot.width = cols
      if (slot.height !== surfaceRows) slot.height = surfaceRows
      // Hidden or not laid out yet: remove the layer rather than draw in the wrong place.
      if (!shown(slot, renderer) || slot.width <= 0 || slot.height <= 0) {
        stream.close()
        return
      }
      // herdr re-uploads every frame inline, so keep it near 30 fps at modest resolution.
      const now = Date.now()
      if (now - lastSent < 30) return
      const width = cols * 7
      const height = surfaceRows * 14
      // The socket may still hold the previous buffer, so each frame gets its own copy.
      const pixels = paint(width, height).slice()
      if (stream.send(pixels, width, height, { col: slot.x, row: slot.y, cols, rows: surfaceRows })) lastSent = now
    },
    hide: () => stream.close(),
    dispose: () => stream.close(),
  }
}

/** Half-block renderer: each cell shows two vertical pixels (▀ with fg on top, bg below). */
function blockSurface(renderer: Renderer, rows: number): Surface {
  const box = new BoxRenderable(renderer, { flexDirection: "column", height: rows, flexShrink: 0 })
  const lines: TextRenderable[] = []
  const ensure = (count: number) => {
    while (lines.length < count) {
      const line = new TextRenderable(renderer, { content: "", wrapMode: "none", height: 1, flexShrink: 0 })
      box.add(line)
      lines.push(line)
    }
    while (lines.length > count) {
      const line = lines.pop()!
      box.remove(line)
      line.destroy()
    }
  }
  return {
    kind: "blocks",
    interval: 33,
    node: box,
    healthy: () => !box.isDestroyed,
    draw(paint, cols, surfaceRows, background) {
      ensure(surfaceRows)
      if (box.height !== surfaceRows) box.height = surfaceRows
      const width = cols
      const height = surfaceRows * 2
      // Paint at 3x and average down, so thin lines stay smooth at half-block resolution.
      const pixels = downsample(paint(width * 3, height * 3), width, height, 3)
      const [br, bg, bb] = backdrop(box, background).toInts()
      const blend = (i: number) => {
        const a = pixels[i + 3] / 255
        return RGBA.fromInts(
          Math.round(pixels[i] * a + br * (1 - a)),
          Math.round(pixels[i + 1] * a + bg * (1 - a)),
          Math.round(pixels[i + 2] * a + bb * (1 - a)),
          255,
        )
      }
      for (let row = 0; row < surfaceRows; row++) {
        const chunks: { __isChunk: true; text: string; fg?: RGBA; bg?: RGBA }[] = []
        for (let x = 0; x < width; x++) {
          const top = (row * 2 * width + x) * 4
          const bottom = ((row * 2 + 1) * width + x) * 4
          const topOn = pixels[top + 3] > 6
          const bottomOn = pixels[bottom + 3] > 6
          // Transparent halves draw nothing, so the real background shows through.
          if (topOn && bottomOn) chunks.push({ __isChunk: true, text: "▀", fg: blend(top), bg: blend(bottom) })
          else if (topOn) chunks.push({ __isChunk: true, text: "▀", fg: blend(top) })
          else if (bottomOn) chunks.push({ __isChunk: true, text: "▄", fg: blend(bottom) })
          else chunks.push({ __isChunk: true, text: " " })
        }
        lines[row].content = new StyledText(chunks as never)
      }
    },
    hide() {},
    dispose() {},
  }
}

/** The nearest opaque background behind a node, for blending soft edges. */
function backdrop(node: Renderable, fallback: RGBA): RGBA {
  let current: Renderable | null = node
  while (current) {
    const color = (current as { backgroundColor?: RGBA }).backgroundColor
    if (color && color.a > 0.5) return color
    current = current.parent
  }
  return fallback
}

/** Box-filters an RGBA buffer by an integer factor, weighting color by alpha. */
function downsample(source: Uint8Array, width: number, height: number, factor: number) {
  const out = new Uint8Array(width * height * 4)
  const sourceWidth = width * factor
  const samples = factor * factor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < factor; sy++) {
        let i = ((y * factor + sy) * sourceWidth + x * factor) * 4
        for (let sx = 0; sx < factor; sx++, i += 4) {
          const alpha = source[i + 3]
          r += source[i] * alpha
          g += source[i + 1] * alpha
          b += source[i + 2] * alpha
          a += alpha
        }
      }
      const o = (y * width + x) * 4
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = b / a
      }
      out[o + 3] = a / samples
    }
  }
  return out
}
