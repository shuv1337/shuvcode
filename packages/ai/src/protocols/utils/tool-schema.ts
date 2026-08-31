import type { JsonSchema, LanguageModelToolSchemaCompatibility } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"
import { GeminiToolSchema } from "./gemini-tool-schema.js"

const tupleItemsSchema = (items: ReadonlyArray<unknown>) => {
  const projected = items.map(moonshotNode)
  if (projected.length === 0) return {}
  if (projected.length === 1) return projected[0]
  return { anyOf: projected }
}

const moonshotNode = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(moonshotNode)
  if (!isRecord(schema)) return schema
  if (typeof schema.$ref === "string") return { $ref: schema.$ref }
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) => {
      if (key === "items" && Array.isArray(value)) return [[key, tupleItemsSchema(value)]]
      if (key === "prefixItems") {
        if ("items" in schema) return []
        return [["items", tupleItemsSchema(Array.isArray(value) ? value : [])]]
      }
      if (key === "unevaluatedItems") return []
      return [[key, moonshotNode(value)]]
    }),
  )
}

const moonshot = (schema: JsonSchema): JsonSchema => {
  const projected = moonshotNode(schema)
  return isRecord(projected) ? projected : {}
}

const openAI = (schema: JsonSchema): JsonSchema => schema
const responses = openAI

// Anthropic rejects oneOf/allOf/anyOf at the top level of input_schema (nested combinators
// are fine). Hoist each variant's properties into the base object as optional fields and
// drop the combinators; branch-only constraints such as conditional `required` are hints the
// executing tool still enforces on the actual input.
const anthropic = (schema: JsonSchema): JsonSchema => {
  const variants = [schema.anyOf, schema.oneOf, schema.allOf]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter(isRecord)
  if (variants.length === 0) return schema
  const base = Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== "anyOf" && key !== "oneOf" && key !== "allOf"),
  )
  const properties = variants.reduce(
    (merged, variant) => ({ ...(isRecord(variant.properties) ? variant.properties : {}), ...merged }),
    isRecord(base.properties) ? base.properties : {},
  )
  return { ...base, type: "object", ...(Object.keys(properties).length === 0 ? {} : { properties }) }
}

const gemini = (schema: JsonSchema): JsonSchema => GeminiToolSchema.convert(schema) ?? {}

const modelCompatibility = (
  schema: JsonSchema,
  compatibility: LanguageModelToolSchemaCompatibility | undefined,
): JsonSchema => {
  if (compatibility === undefined) return schema
  switch (compatibility) {
    case "gemini":
      return gemini(schema)
    case "moonshot":
      return moonshot(schema)
  }
}

export const ToolSchemaProjection = {
  anthropic,
  gemini,
  modelCompatibility,
  moonshot,
  openAI,
  responses,
} as const
