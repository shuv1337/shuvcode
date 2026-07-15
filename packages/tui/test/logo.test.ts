import { expect, test } from "bun:test"
import { defaultLogo } from "../src/component/logo"
import { logo } from "../src/shuv-logo"

test("the default home logo uses the shuvcode wordmark", () => {
  expect(defaultLogo).toEqual(logo)
})
