import { describe, expect, test, beforeEach, afterEach } from "bun:test"

// Note: These tests require the happy-dom environment set up via bunfig.toml

describe("hosted.ts utilities", () => {
  let originalHostname: string
  let originalSearch: string

  beforeEach(() => {
    originalHostname = window.location.hostname
    originalSearch = window.location.search
  })

  afterEach(() => {
    // Reset location properties (happy-dom allows this)
    Object.defineProperty(window.location, "hostname", {
      value: originalHostname,
      writable: true,
    })
    Object.defineProperty(window.location, "search", {
      value: originalSearch,
      writable: true,
    })
  })

  describe("isHostedEnvironment", () => {
    test("returns true for opencode.ai domains", async () => {
      Object.defineProperty(window.location, "hostname", {
        value: "app.opencode.ai",
        writable: true,
      })

      // Dynamic import to get fresh evaluation
      const { isHostedEnvironment } = await import("../src/utils/hosted")
      expect(isHostedEnvironment()).toBe(true)
    })

    test("returns true for shuv.ai domains", async () => {
      Object.defineProperty(window.location, "hostname", {
        value: "app.shuv.ai",
        writable: true,
      })

      const { isHostedEnvironment } = await import("../src/utils/hosted")
      expect(isHostedEnvironment()).toBe(true)
    })

    test("returns false for localhost", async () => {
      Object.defineProperty(window.location, "hostname", {
        value: "localhost",
        writable: true,
      })

      const { isHostedEnvironment } = await import("../src/utils/hosted")
      expect(isHostedEnvironment()).toBe(false)
    })

    test("returns false for other domains", async () => {
      Object.defineProperty(window.location, "hostname", {
        value: "example.com",
        writable: true,
      })

      const { isHostedEnvironment } = await import("../src/utils/hosted")
      expect(isHostedEnvironment()).toBe(false)
    })
  })

  describe("hasUrlQueryParam", () => {
    test("returns true when ?url= parameter exists", async () => {
      Object.defineProperty(window.location, "search", {
        value: "?url=http://localhost:4096",
        writable: true,
      })

      const { hasUrlQueryParam } = await import("../src/utils/hosted")
      expect(hasUrlQueryParam()).toBe(true)
    })

    test("returns false when no ?url= parameter", async () => {
      Object.defineProperty(window.location, "search", {
        value: "",
        writable: true,
      })

      const { hasUrlQueryParam } = await import("../src/utils/hosted")
      expect(hasUrlQueryParam()).toBe(false)
    })

    test("returns false when other parameters exist but not ?url=", async () => {
      Object.defineProperty(window.location, "search", {
        value: "?foo=bar&baz=qux",
        writable: true,
      })

      const { hasUrlQueryParam } = await import("../src/utils/hosted")
      expect(hasUrlQueryParam()).toBe(false)
    })
  })

  describe("getUrlQueryParam", () => {
    test("returns the URL value when present", async () => {
      Object.defineProperty(window.location, "search", {
        value: "?url=http://localhost:4096",
        writable: true,
      })

      const { getUrlQueryParam } = await import("../src/utils/hosted")
      expect(getUrlQueryParam()).toBe("http://localhost:4096")
    })

    test("returns null when not present", async () => {
      Object.defineProperty(window.location, "search", {
        value: "",
        writable: true,
      })

      const { getUrlQueryParam } = await import("../src/utils/hosted")
      expect(getUrlQueryParam()).toBeNull()
    })

    test("handles URL-encoded values", async () => {
      Object.defineProperty(window.location, "search", {
        value: "?url=https%3A%2F%2Fmy-server.example.com%3A8080",
        writable: true,
      })

      const { getUrlQueryParam } = await import("../src/utils/hosted")
      expect(getUrlQueryParam()).toBe("https://my-server.example.com:8080")
    })
  })
})
