import { expect, test } from "bun:test"
import { splashResumeCommand } from "../../src/mini/splash"

test("uses the shuvcode executable in the session resume command", () => {
  expect(splashResumeCommand("ses_123")).toBe("shuvcode mini -s ses_123")
})
