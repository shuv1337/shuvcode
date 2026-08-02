import { expect, test } from "bun:test"
import { logo } from "../src/logo"
import { logo as shuvLogo } from "../src/shuv-logo"

test("the default home logo uses the shuvcode wordmark", () => {
  expect(logo).toEqual(shuvLogo)
})
