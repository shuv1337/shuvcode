import { describe, expect, test } from "bun:test"

import { AuraCanvas, type AuraInput } from "../src/tui/aura"

const palette = {
  user: [
    [70, 220, 255],
    [40, 160, 255],
  ],
  assistant: [
    [190, 110, 255],
    [255, 90, 210],
  ],
  rest: [
    [150, 160, 190],
    [120, 130, 170],
  ],
  connecting: [255, 190, 90],
  muted: [140, 140, 150],
} as const satisfies AuraInput["palette"]

const base: AuraInput = { time: 2000, phase: "live", liveFor: 99_999, level: 0, speaker: 1, muted: false, palette }

function render(input: Partial<AuraInput>) {
  const canvas = new AuraCanvas(96, 96)
  canvas.draw({ ...base, ...input, time: (input.time ?? base.time) - 16 })
  return canvas.draw({ ...base, ...input })
}

function stats(pixels: Uint8Array) {
  let lit = 0
  let r = 0
  let g = 0
  let b = 0
  let farthest = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a < 40) continue
    lit++
    r += pixels[i] * a
    g += pixels[i + 1] * a
    b += pixels[i + 2] * a
    const p = i / 4
    farthest = Math.max(farthest, Math.hypot((p % 96) - 47.5, Math.floor(p / 96) - 47.5))
  }
  return { lit, r, g, b, farthest }
}

describe("voice aura", () => {
  test("is a ring with a transparent center and corners", () => {
    const pixels = render({})
    const alpha = (x: number, y: number) => pixels[(y * 96 + x) * 4 + 3]
    expect(alpha(48, 48)).toBe(0)
    expect(alpha(0, 0)).toBe(0)
    expect(stats(pixels).lit).toBeGreaterThan(100)
  })
  test("swells when someone speaks", () => {
    expect(stats(render({ level: 0.9 })).farthest).toBeGreaterThan(stats(render({ level: 0 })).farthest + 3)
    expect(stats(render({ level: 0.9 })).lit).toBeGreaterThan(stats(render({ level: 0 })).lit)
  })
  test("never clips at the edges, even at full volume", () => {
    for (const speaker of [0, 1])
      for (const time of [1000, 1700, 2400]) {
        const pixels = render({ level: 1, speaker, time })
        for (let i = 0; i < 96; i++)
          for (const [x, y] of [
            [i, 0],
            [i, 95],
            [0, i],
            [95, i],
          ])
            expect(pixels[(y * 96 + x) * 4 + 3]).toBeLessThan(24)
      }
  })
  test("tells the speakers apart by color", () => {
    const you = stats(render({ level: 0.8, speaker: 0 }))
    const gpt = stats(render({ level: 0.8, speaker: 1 }))
    // You lean cyan (green over red); GPT-Live leans violet (red over green).
    expect(you.g).toBeGreaterThan(you.r)
    expect(gpt.r).toBeGreaterThan(gpt.g)
  })
})
