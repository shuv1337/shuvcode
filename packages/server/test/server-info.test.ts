import { describe, expect, test } from "bun:test"
import { ServerInfo } from "../src/server-info"

describe("ServerInfo.advertisedURLs", () => {
  test("accepts HTTPS and loopback HTTP independently from the bind address", () => {
    expect(ServerInfo.advertisedURLs(["https://shuvdev.example:10001", "http://127.0.0.1:4096"])).toEqual([
      "https://shuvdev.example:10001",
      "http://127.0.0.1:4096",
    ])
  })

  test("rejects unsafe or ambiguous advertised URLs", () => {
    for (const value of [
      "http://shuvdev.example:4096",
      "https://user@shuvdev.example",
      "https://shuvdev.example/path",
      "https://shuvdev.example?token=secret",
      "ftp://shuvdev.example",
    ]) {
      expect(() => ServerInfo.advertisedURLs([value])).toThrow()
    }
  })
})
