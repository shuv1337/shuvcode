import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Pairing } from "../src/pairing.js"

describe("Pairing.DeviceName", () => {
  test("accepts 80 Unicode scalar values", () => {
    expect(String(Schema.decodeUnknownSync(Pairing.DeviceName)("😀".repeat(80)))).toBe("😀".repeat(80))
  })

  test("rejects 81 Unicode scalar values", () => {
    expect(() => Schema.decodeUnknownSync(Pairing.DeviceName)("😀".repeat(81))).toThrow()
  })
})
