import { expect, test } from "bun:test"
import { Session } from "../src/session.js"
import { Schema } from "effect"

const decode = Schema.decodeUnknownSync(Session.Policy)

test("session tool policy accepts exact IDs and rejects malformed or wildcard IDs", () => {
  expect(decode({ tools: { allow: ["read", "github_write"] } })).toEqual({
    tools: { allow: ["read", "github_write"] },
  })
  expect(() => decode({ tools: { allow: ["*"] } })).toThrow()
  expect(() => decode({ tools: { allow: ["github.write"] } })).toThrow()
  expect(() => decode({ tools: { allow: ["../../bash"] } })).toThrow()
})
