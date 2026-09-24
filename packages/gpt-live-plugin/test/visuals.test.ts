import { describe, expect, test } from "bun:test"

import { animating, arrivalsFor, duration, flap, shimmer } from "../src/tui/visuals"

describe("text effects", () => {
  test("shimmer highlight moves over time", () => {
    const a = shimmer(20, 0)
    const b = shimmer(20, 400)
    expect(a.indexOf(Math.max(...a))).not.toBe(b.indexOf(Math.max(...b)))
  })
  test("split-flap settles into the real text", () => {
    const arrivals = arrivalsFor("", [], "Hello", 0)
    expect(flap("Hello", arrivals, 20).map((c) => c.state)).toContain("flipping")
    expect(
      flap("Hello", arrivals, 2000)
        .map((c) => c.char)
        .join(""),
    ).toBe("Hello")
    expect(animating(arrivals, 2000)).toBe(false)
  })
  test("arrivals keep the shared prefix", () => {
    const first = arrivalsFor("", [], "Hi", 0)
    const next = arrivalsFor("Hi", first, "Hi there", 500)
    expect(next.slice(0, 2)).toEqual(first)
    expect(next[2]).toBeGreaterThanOrEqual(500)
  })
})

describe("helpers", () => {
  test("duration formatting", () => {
    expect(duration(65_000)).toBe("1:05")
    expect(duration(3_725_000)).toBe("1:02:05")
  })
})
