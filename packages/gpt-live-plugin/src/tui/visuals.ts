/**
 * Pure animation math for the voice UI. Everything here is deterministic given a time,
 * so it can be unit-tested and rendered by any component.
 */

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export type Phase = "idle" | "connecting" | "live" | "closing" | "error"

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

/** Shimmer: a soft highlight that sweeps across text. Returns 0..1 per character. */
export function shimmer(length: number, time: number, speed = 28, spread = 4) {
  const cycle = length + spread * 4
  const head = (((time / 1000) * speed) % cycle) - spread * 2
  return Array.from({ length }, (_, index) => {
    const gap = Math.abs(index - head)
    return clamp(1 - gap / spread)
  })
}

export function spinner(time: number, frames: readonly string[] = SPINNER, interval = 80) {
  return frames[Math.floor(time / interval) % frames.length]
}

/** 0..1 pulse for breathing indicators. */
export function pulse(time: number, period = 1400) {
  return 0.5 + 0.5 * Math.sin((time / period) * Math.PI * 2)
}

export function duration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(hours ? 2 : 1, "0")
  const ss = String(seconds).padStart(2, "0")
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

const FLAP_SETTLE_MS = 190
const FLAP_GLOW_MS = 160
const FLAP_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

export type FlapState = "flipping" | "glowing" | "settled"

/**
 * Split-flap effect: each newly arrived character cycles through letters before landing,
 * then glows briefly. `arrivals[i]` is when character i arrived.
 */
export function flap(text: string, arrivals: readonly number[], now: number) {
  const out: { char: string; state: FlapState }[] = []
  let index = 0
  for (const char of text) {
    const arrived = arrivals[index] ?? 0
    const age = now - arrived
    const flippable = /[A-Za-z0-9]/.test(char)
    if (flippable && age < FLAP_SETTLE_MS) {
      const frame = Math.floor(now / 45)
      const pick = (char.charCodeAt(0) + index * 7 + frame * 11) % FLAP_ALPHABET.length
      out.push({ char: age < 35 ? " " : FLAP_ALPHABET[pick], state: "flipping" })
    } else if (flippable && age < FLAP_SETTLE_MS + FLAP_GLOW_MS) {
      out.push({ char, state: "glowing" })
    } else {
      out.push({ char, state: "settled" })
    }
    index++
  }
  return out
}

/** Arrival times for `next`, reusing the timestamps of any shared prefix with `previous`. */
export function arrivalsFor(previous: string, previousArrivals: readonly number[], next: string, now: number) {
  const prev = [...previous]
  const chars = [...next]
  let shared = 0
  while (shared < prev.length && shared < chars.length && prev[shared] === chars[shared]) shared++
  const arrivals = previousArrivals.slice(0, shared)
  for (let index = shared; index < chars.length; index++) {
    // Stagger new characters so a burst of text ripples in rather than popping.
    arrivals.push(now + Math.min(90, (index - shared) * 6))
  }
  return arrivals
}

/** Whether any character is still animating. */
export function animating(arrivals: readonly number[], now: number) {
  const last = arrivals[arrivals.length - 1]
  return last !== undefined && now - last < FLAP_SETTLE_MS + FLAP_GLOW_MS
}
