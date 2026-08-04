import { expect } from "bun:test"
import { Effect } from "effect"
import { SessionStructuredOutput } from "@opencode-ai/core/session/structured-output"
import { it } from "./lib/effect"

it.effect("classifies invalid schemas and invalid generated values", () =>
  Effect.gen(function* () {
    const schemaFailure = yield* SessionStructuredOutput.compile({ type: "not-a-json-schema-type" }).pipe(Effect.flip)
    expect(schemaFailure._tag).toBe("Session.StructuredOutput.InvalidSchemaError")

    const validator = yield* SessionStructuredOutput.compile({
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
    })
    const valueFailure = yield* SessionStructuredOutput.validate(validator, { count: "many" }).pipe(Effect.flip)
    expect(valueFailure._tag).toBe("Session.StructuredOutput.ValidationError")
  }),
)
