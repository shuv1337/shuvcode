import { expect, test } from "bun:test"
import { logo } from "../src/logo"

test("the default home logo uses the shuvcode wordmark", async () => {
  expect(logo).toEqual((await import("../src/shuv-logo")).logo)
})
