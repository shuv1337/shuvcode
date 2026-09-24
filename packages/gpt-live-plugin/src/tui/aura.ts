/**
 * The voice aura: a glowing ring woven from translucent ribbon strands, rasterized to a
 * transparent RGBA buffer. The ring reacts to the voice level (size, ripple depth, twist,
 * spin speed, brightness) and tells speakers apart by color and motion: you get fine,
 * quick ripples spinning one way; GPT-Live gets broad, slow undulations spinning the other.
 *
 * Built for 60 fps: everything that depends only on the angle around the ring is computed
 * once per frame for a fixed set of angle buckets, pixels far from the ring are skipped, and
 * per-pixel polar coordinates are cached per canvas size.
 */
import type { Phase } from "./visuals"

export type Rgb = readonly [number, number, number]

export interface AuraPalette {
  user: readonly [Rgb, Rgb]
  assistant: readonly [Rgb, Rgb]
  rest: readonly [Rgb, Rgb]
  connecting: Rgb
  muted: Rgb
}

export interface AuraInput {
  time: number
  phase: Phase
  /** Milliseconds since the call went live (drives the arrival bloom). */
  liveFor: number
  /** Smoothed voice level, 0..1. */
  level: number
  /** 0 = you are speaking, 1 = GPT-Live is speaking (smoothed). */
  speaker: number
  muted: boolean
  palette: AuraPalette
}

interface Strand {
  userWaves: readonly [number, number]
  assistantWaves: readonly [number, number]
  phase: number
  offset: number
  weight: number
}

const STRANDS: readonly Strand[] = [
  { userWaves: [4, 6], assistantWaves: [2, 3], phase: 0.0, offset: 0.0, weight: 1.0 },
  { userWaves: [5, 7], assistantWaves: [3, 4], phase: 2.1, offset: 0.035, weight: 0.8 },
  { userWaves: [4, 5], assistantWaves: [2, 5], phase: 4.3, offset: -0.03, weight: 0.7 },
  { userWaves: [5, 8], assistantWaves: [4, 3], phase: 1.2, offset: 0.015, weight: 0.55 },
]
const BUCKETS = 720
const TAU = Math.PI * 2

function mixRgb(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

export class AuraCanvas {
  readonly pixels: Uint8Array
  private readonly distance: Float32Array
  private readonly bucket: Uint16Array
  // Per-frame, per-angle tables: rim radius, ribbon width and color for each strand.
  private readonly rim = new Float32Array(BUCKETS * STRANDS.length)
  private readonly ribbon = new Float32Array(BUCKETS * STRANDS.length)
  private readonly tone = new Float32Array(BUCKETS * STRANDS.length * 3)
  // Integrated spin angle, so speed changes never make the ring jump.
  private spin = 0
  private lastTime: number | undefined

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const size = width * height
    this.pixels = new Uint8Array(size * 4)
    this.distance = new Float32Array(size)
    this.bucket = new Uint16Array(size)
    const cx = (width - 1) / 2
    const cy = (height - 1) / 2
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        this.distance[i] = Math.hypot(x - cx, y - cy)
        const angle = Math.atan2(y - cy, x - cx)
        this.bucket[i] = Math.floor(((angle + Math.PI) / TAU) * BUCKETS) % BUCKETS
      }
    }
  }

  draw(input: AuraInput) {
    const t = input.time / 1000
    const dt = this.lastTime === undefined ? 0 : Math.min(0.1, Math.max(0, t - this.lastTime))
    this.lastTime = t
    const extent = Math.min(this.width, this.height) / 2

    const connecting = input.phase === "connecting"
    const idle = input.phase !== "live" && input.phase !== "closing" && !connecting
    let level = clamp(input.level)
    if (input.phase === "live" && input.liveFor < 1200) level = Math.max(level, 0.85 * (1 - input.liveFor / 1200))
    if (idle) level = 0
    const speaker = clamp(input.speaker)
    const breath = 0.5 + 0.5 * Math.sin(t * (connecting ? 4.5 : 1.4))

    // Geometry reacts to the voice.
    const radius = extent * (connecting ? 0.46 : 0.5) * (1 + 0.05 * breath + 0.16 * level)
    const ripple = (connecting ? 0.03 : 0.018) + 0.09 * level
    const thickness = extent * (0.035 + 0.05 * level)
    const glowWidth = extent * (0.08 + 0.1 * level)
    // You spin counter-clockwise, GPT-Live clockwise; faster when louder.
    this.spin += dt * (1 - 2 * speaker) * (0.25 + 2.4 * level)
    const flow = t * (0.8 + 3.5 * level) * (1 + (1 - speaker) * 0.8)

    // Colors: speaker identity when active, calm when quiet.
    const pal = input.palette
    const vivid = connecting ? 0.85 : clamp(0.2 + level * 1.6)
    let colorA = mixRgb(pal.rest[0], mixRgb(pal.user[0], pal.assistant[0], speaker), vivid)
    let colorB = mixRgb(pal.rest[1], mixRgb(pal.user[1], pal.assistant[1], speaker), vivid)
    if (connecting) {
      colorA = mixRgb(colorA, pal.connecting, 0.7)
      colorB = mixRgb(colorB, pal.connecting, 0.5)
    }
    if (input.muted) {
      colorA = mixRgb(colorA, pal.muted, 0.8)
      colorB = mixRgb(colorB, pal.muted, 0.8)
    }
    const brightness = 0.55 + 0.45 * (connecting ? breath : Math.max(level, 0.25 * breath))

    // Angle tables (the expensive trigonometry happens here, BUCKETS x strands per frame).
    const count = STRANDS.length
    let maxRim = 0
    let minRim = Infinity
    for (let k = 0; k < BUCKETS; k++) {
      const angle = (k / BUCKETS) * TAU - Math.PI + this.spin
      for (let s = 0; s < count; s++) {
        const strand = STRANDS[s]
        const [u1, u2] = strand.userWaves
        const [a1, a2] = strand.assistantWaves
        const userShape = 0.6 * Math.sin(u1 * angle + flow + strand.phase) + 0.4 * Math.sin(u2 * angle - flow * 1.3)
        const assistantShape =
          0.65 * Math.sin(a1 * angle - flow * 0.6 + strand.phase) + 0.35 * Math.sin(a2 * angle + flow * 0.4)
        const mixed = userShape * (1 - speaker) + assistantShape * speaker
        // Swell outward, barely dip inward: inward dents read as sharp spikes.
        // (A smooth blend of x and |x|: about 1 at x = 1 and -0.35 at x = -1, with no crease at 0.)
        const shape = 0.675 * mixed + 0.325 * Math.sqrt(mixed * mixed + 0.04)
        const rim = radius * (1 + strand.offset * (0.9 + level) + ripple * shape)
        const j = k * count + s
        this.rim[j] = rim
        // Ribbon twist: thickness swells and pinches around the ring.
        this.ribbon[j] = thickness * (0.35 + 0.65 * Math.abs(Math.sin(2 * angle + flow * 0.5 + strand.phase)))
        const tone = 0.5 + 0.5 * Math.sin(angle + strand.phase + flow * 0.3)
        this.tone[j * 3] = colorA[0] + (colorB[0] - colorA[0]) * tone
        this.tone[j * 3 + 1] = colorA[1] + (colorB[1] - colorA[1]) * tone
        this.tone[j * 3 + 2] = colorA[2] + (colorB[2] - colorA[2]) * tone
        if (rim > maxRim) maxRim = rim
        if (rim < minRim) minRim = rim
      }
    }

    const pixels = this.pixels
    const inner = minRim - glowWidth * 3
    const outer = maxRim + glowWidth * 3
    const hotness = 0.35 * (0.3 + 0.7 * vivid)
    const invGlow = 1 / glowWidth
    for (let i = 0, o = 0; i < this.distance.length; i++, o += 4) {
      const distance = this.distance[i]
      // Most pixels are nowhere near the ring.
      if (distance < inner || distance > outer) {
        pixels[o + 3] = 0
        continue
      }
      const base = this.bucket[i] * count
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (let s = 0; s < count; s++) {
        const j = base + s
        const gap = distance - this.rim[j]
        const body = gap / this.ribbon[j]
        const halo = gap * invGlow
        const intensity = (Math.exp(-body * body) + 0.28 * Math.exp(-halo * halo)) * STRANDS[s].weight
        if (intensity < 0.004) continue
        sr += this.tone[j * 3] * intensity
        sg += this.tone[j * 3 + 1] * intensity
        sb += this.tone[j * 3 + 2] * intensity
        sa += intensity
      }
      if (sa <= 0.004) {
        pixels[o + 3] = 0
        continue
      }
      // Overlapping translucent ribbons add up to brighter, whiter light.
      const hot = clamp((sa - 1) * hotness)
      const scale = brightness / sa
      const r = sr * scale
      const g = sg * scale
      const b = sb * scale
      pixels[o] = clamp(r + (255 - r) * hot, 0, 255)
      pixels[o + 1] = clamp(g + (255 - g) * hot, 0, 255)
      pixels[o + 2] = clamp(b + (255 - b) * hot, 0, 255)
      pixels[o + 3] = Math.round(clamp(1 - Math.exp(-sa * 1.6)) * 255)
    }
    return pixels
  }
}
