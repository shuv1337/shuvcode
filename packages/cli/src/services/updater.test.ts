import { describe, expect, test } from "bun:test"
import { action, decodePolicy } from "./updater"

describe("updater", () => {
  test("reads autoupdate from JSONC", () => {
    expect(decodePolicy('{ // preference\n "autoupdate": "notify",\n}')).toBe("notify")
    expect(decodePolicy('{ "autoupdate": false }')).toBe(false)
    expect(decodePolicy('{ "autoupdate": "invalid" }')).toBeUndefined()
  })

  test("automatically updates patches and minors", () => {
    expect(action("1.2.3", "1.2.4", true)).toBe("upgrade")
    expect(action("1.2.3", "1.3.0", true)).toBe("upgrade")
    expect(action("1.2.3", "1.2.4", "notify")).toBe("upgrade")
    expect(action("1.2.3", "1.3.0", "notify")).toBe("upgrade")
  })

  test("skips when autoupdate is disabled", () => {
    expect(action("1.2.3", "1.2.4", false)).toBe("none")
  })

  test("never automatically updates majors", () => {
    expect(action("1.2.3", "2.0.0", true)).toBe("none")
  })

  test("reports up-to-date only when versions match", () => {
    expect(action("1.2.3", "1.2.3", true)).toBe("none")
  })

  test("upgrades when latest is lower (rollback)", () => {
    expect(action("1.2.4", "1.2.3", true)).toBe("upgrade")
  })

  test("fork builds ignore bare upstream versions", () => {
    expect(action("1.17.13-1", "1.17.13", true)).toBe("none")
    expect(action("1.17.13-2", "1.17.13", "notify")).toBe("none")
  })

  test("fork builds upgrade to newer fork iterations", () => {
    expect(action("1.17.13-1", "1.17.13-2", true)).toBe("upgrade")
    expect(action("1.17.13-1", "1.17.14-1", true)).toBe("upgrade")
    expect(action("1.17.13-2", "1.17.13-1", true)).toBe("none")
  })
})
