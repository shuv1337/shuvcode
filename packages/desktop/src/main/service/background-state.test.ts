import { describe, expect, test } from "bun:test"
import { selectBackgroundStateHome } from "./background-state"

describe("background CLI state selection", () => {
  test("prefers the canonical managed state root over the first running candidate", () => {
    const selected = selectBackgroundStateHome(
      [
        { stateHome: "/desktop/state", url: "http://127.0.0.1:4000" },
        { stateHome: "/canonical/state", url: "http://127.0.0.1:4096" },
      ],
      "/canonical/state",
      "/desktop/state",
    )

    expect(selected).toEqual({
      found: { stateHome: "/canonical/state", url: "http://127.0.0.1:4096" },
      stateHome: "/canonical/state",
    })
  })

  test("retains the default XDG state root when its running candidate has no override", () => {
    const selected = selectBackgroundStateHome(
      [
        { stateHome: "/desktop/state", url: "http://127.0.0.1:4000" },
        { url: "http://127.0.0.1:4096" },
      ],
      undefined,
      "/desktop/state",
    )

    expect(selected.stateHome).toBeUndefined()
    expect(selected.found?.url).toBe("http://127.0.0.1:4096")
  })

  test("falls back to another running candidate before starting a new service", () => {
    const selected = selectBackgroundStateHome(
      [{ stateHome: "/desktop/state", url: "http://127.0.0.1:4000" }],
      "/canonical/state",
      "/fallback/state",
    )

    expect(selected.stateHome).toBe("/desktop/state")
  })
})
