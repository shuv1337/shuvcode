/**
 * Kitty graphics commands for the aura, written through the renderer's own output queue.
 *
 * Retransmitting an image ID deletes that image and its placements first (protocol rule), so each
 * surface alternates between two IDs: a frame uploads and places the new image under the other ID,
 * then deletes the previous one. There is no moment without an image, and the cells underneath
 * keep the panel's background.
 */
import { deflateSync } from "node:zlib"

const ESC = "\x1b"
/** Base64 bytes per chunk; the protocol limit is 4096. */
const CHUNK = 4096
/** Pixel budget per frame; the terminal scales the image to its cell box. */
const MAX_PIXELS = 65_000
/** Below text, above cell backgrounds: dialogs drawn over the aura keep their text visible. */
const Z_INDEX = -1

export interface KittyFrame {
  id: number
  /** Top-left cell, zero-based. */
  col: number
  row: number
  /** Cell box the image is scaled to. */
  cols: number
  rows: number
  width: number
  height: number
  rgba: Uint8Array
  /** The previous frame's image, deleted once this one is placed. */
  replaces?: number
}

/** Random per process, so the IDs aren't predictable to other programs sharing the terminal. */
const SESSION = crypto.getRandomValues(new Uint32Array(1))[0]
/** IDs sit above 2^24: away from sequential allocators and 24-bit (Unicode placeholder) IDs. */
const ID_BASE = 2 ** 24
const ID_PAIRS = (2 ** 32 - 2 - ID_BASE) / 2

/**
 * Two image IDs per layer, alternated frame to frame. Stable for a layer within a process and
 * distinct between layers. Terminal-assigned numbers (`I=`) would need the terminal's replies,
 * which arrive on input the renderer owns.
 */
export function imageIDs(layer: string, session = SESSION): readonly [number, number] {
  let hash = 2166136261
  for (let i = 0; i < layer.length; i++) hash = Math.imul(hash ^ layer.charCodeAt(i), 16777619)
  const first = ID_BASE + (((hash ^ session) >>> 0) % ID_PAIRS) * 2
  return [first, first + 1]
}

/**
 * Pixel size for a frame covering `cols` x `rows` cells: the terminal's real cell size when it
 * reports one, scaled down to stay within the pixel budget.
 */
export function framePixels(
  cols: number,
  rows: number,
  resolution: { width: number; height: number } | null | undefined,
  terminal: { width: number; height: number },
) {
  const known = resolution && resolution.width > 0 && resolution.height > 0 && terminal.width > 0 && terminal.height > 0
  let cellWidth = known ? resolution.width / terminal.width : 8
  let cellHeight = known ? resolution.height / terminal.height : 16
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (cols * cellWidth * rows * cellHeight)))
  cellWidth *= scale
  cellHeight *= scale
  return { width: Math.max(1, Math.round(cols * cellWidth)), height: Math.max(1, Math.round(rows * cellHeight)) }
}

/**
 * Transmits and places one frame at its cell position (zlib-compressed RGBA, chunked), then deletes
 * the image it replaces. The cursor is saved and restored around it so the renderer's own cursor is
 * untouched, and the whole frame is one synchronized update (mode 2026), so the terminal never
 * paints the cursor mid-move.
 */
export function kittyFrame(frame: KittyFrame) {
  const payload = Buffer.from(deflateSync(frame.rgba)).toString("base64")
  const keys = [
    "a=T",
    "f=32",
    "o=z",
    `s=${frame.width}`,
    `v=${frame.height}`,
    `i=${frame.id}`,
    "p=1",
    `c=${frame.cols}`,
    `r=${frame.rows}`,
    "C=1",
    `z=${Z_INDEX}`,
    "q=2",
  ].join(",")
  let out = `${ESC}[?2026h${ESC}7${ESC}[${frame.row + 1};${frame.col + 1}H`
  for (let offset = 0; offset < payload.length || offset === 0; offset += CHUNK) {
    const more = offset + CHUNK < payload.length ? 1 : 0
    const control = offset === 0 ? `${keys},m=${more}` : `m=${more},q=2`
    out += `${ESC}_G${control};${payload.slice(offset, offset + CHUNK)}${ESC}\\`
  }
  if (frame.replaces !== undefined && frame.replaces !== frame.id) out += kittyDelete(frame.replaces)
  return `${out}${ESC}8${ESC}[?2026l`
}

/** Removes the image and frees its data. */
export function kittyDelete(id: number) {
  return `${ESC}_Ga=d,d=I,i=${id},q=2${ESC}\\`
}
