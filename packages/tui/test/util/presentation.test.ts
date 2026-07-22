import { expect, test } from "bun:test"
import { logo } from "../../src/shuv-logo"
import { presentationLogo, sessionEpilogue } from "../../src/util/presentation"

test("uses the canonical shuvcode wordmark", () => {
  expect(presentationLogo).toEqual(logo)
})

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("shuvcode -s ses_123")
  expect(epilogue).not.toContain("opencode2 -s")
  expect(epilogue).not.toContain("opencode -s")
})
