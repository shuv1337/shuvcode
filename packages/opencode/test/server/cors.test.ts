import { describe, expect, test } from "bun:test"
import { isOriginAllowed } from "../../src/server/cors"

describe("server.cors", () => {
  describe("isOriginAllowed", () => {
    test("should return undefined for undefined input", () => {
      expect(isOriginAllowed(undefined)).toBeUndefined()
    })

    test("should return undefined for empty string", () => {
      expect(isOriginAllowed("")).toBeUndefined()
    })

    test("should allow localhost with any port", () => {
      expect(isOriginAllowed("http://localhost:3000")).toBe("http://localhost:3000")
      expect(isOriginAllowed("http://localhost:4096")).toBe("http://localhost:4096")
      expect(isOriginAllowed("http://localhost:8080")).toBe("http://localhost:8080")
    })

    test("should allow 127.0.0.1 with any port", () => {
      expect(isOriginAllowed("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000")
      expect(isOriginAllowed("http://127.0.0.1:4096")).toBe("http://127.0.0.1:4096")
    })

    test("should allow Tauri origins", () => {
      expect(isOriginAllowed("tauri://localhost")).toBe("tauri://localhost")
      expect(isOriginAllowed("http://tauri.localhost")).toBe("http://tauri.localhost")
    })

    test("should allow *.opencode.ai origins (https only)", () => {
      expect(isOriginAllowed("https://opencode.ai")).toBe("https://opencode.ai")
      expect(isOriginAllowed("https://app.opencode.ai")).toBe("https://app.opencode.ai")
      expect(isOriginAllowed("https://foo.opencode.ai")).toBe("https://foo.opencode.ai")
      expect(isOriginAllowed("https://dev.app.opencode.ai")).toBe("https://dev.app.opencode.ai")
    })

    test("should allow *.shuv.ai origins (https only)", () => {
      expect(isOriginAllowed("https://shuv.ai")).toBe("https://shuv.ai")
      expect(isOriginAllowed("https://app.shuv.ai")).toBe("https://app.shuv.ai")
      expect(isOriginAllowed("https://foo.shuv.ai")).toBe("https://foo.shuv.ai")
      expect(isOriginAllowed("https://dev.app.shuv.ai")).toBe("https://dev.app.shuv.ai")
    })

    test("should deny http:// for opencode.ai and shuv.ai domains", () => {
      expect(isOriginAllowed("http://opencode.ai")).toBeUndefined()
      expect(isOriginAllowed("http://app.opencode.ai")).toBeUndefined()
      expect(isOriginAllowed("http://shuv.ai")).toBeUndefined()
      expect(isOriginAllowed("http://app.shuv.ai")).toBeUndefined()
    })

    test("should deny other domains", () => {
      expect(isOriginAllowed("https://evil.com")).toBeUndefined()
      expect(isOriginAllowed("https://example.com")).toBeUndefined()
      expect(isOriginAllowed("https://fakeopencode.ai")).toBeUndefined()
      expect(isOriginAllowed("https://fakeshuv.ai")).toBeUndefined()
    })

    test("should deny https localhost (not typical)", () => {
      expect(isOriginAllowed("https://localhost:3000")).toBeUndefined()
    })
  })
})
