import { expect, test } from "bun:test"
import { shuvcodeMark } from "../../src/logo"
import { splashMark, splashResumeCommand } from "../../src/mini/splash"

test("uses the shuvcode executable in the session resume command", () => {
  expect(splashResumeCommand("ses_123")).toBe("shuvcode mini -s ses_123")
})

test("uses the shuvcode monogram", () => {
  expect(splashMark).toEqual({ mono: ["[S]"], full: shuvcodeMark })
})
