import { expect, test } from "bun:test"
import { Auth } from "@opencode-ai/schema/auth"
import { Schema } from "effect"

test("auth status serialization strips undeclared secret material", () => {
  const status = Schema.decodeUnknownSync(Auth.Status)({
    ready: true,
    storage: "available",
    verification: "not_performed",
    token: "top-level-secret",
    path: "/secret/auth.json",
    profiles: [
      {
        providerID: "anthropic",
        profileID: "cred_profile",
        source: "stored",
        type: "oauth",
        usable: true,
        reason: "configured",
        access: "access-secret",
        headers: { Authorization: "Bearer header-secret" },
        error: "raw-provider-error",
      },
    ],
  })

  expect(JSON.stringify(status)).toBe(
    '{"ready":true,"storage":"available","verification":"not_performed","profiles":[{"providerID":"anthropic","profileID":"cred_profile","source":"stored","type":"oauth","usable":true,"reason":"configured"}]}',
  )
})
