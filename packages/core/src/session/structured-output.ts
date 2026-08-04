export * as SessionStructuredOutput from "./structured-output"

import Ajv, { type ValidateFunction } from "ajv"
import { Data, Effect, Schema } from "effect"
import type { StructuredOutput } from "@opencode-ai/schema/structured-output"

export const ToolName = "__opencode_structured_output"

export class InvalidSchemaError extends Data.TaggedError("Session.StructuredOutput.InvalidSchemaError")<{
  readonly message: string
}> {}

export class ValidationError extends Data.TaggedError("Session.StructuredOutput.ValidationError")<{
  readonly message: string
}> {}

const ajv = new Ajv({ allErrors: true, strict: false })

export const compile = (schema: StructuredOutput.JsonSchema) =>
  Effect.try({
    try: () => ajv.compile(schema),
    catch: (cause) => new InvalidSchemaError({ message: cause instanceof Error ? cause.message : String(cause) }),
  })

export const validate = (validator: ValidateFunction, value: unknown) =>
  Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.mapError((error) => new ValidationError({ message: error.message })),
    Effect.flatMap((json) => {
      if (validator(json)) return Effect.succeed(json)
      return new ValidationError({ message: ajv.errorsText(validator.errors, { separator: "; " }) })
    }),
  )
