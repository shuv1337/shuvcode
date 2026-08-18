import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/index.js"
import { OpenAIChat } from "../src/protocols.js"
import { ToolSchemaProjection } from "../src/protocols/utils/tool-schema.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"

describe("tool schema projections", () => {
  test("moonshot strips $ref siblings and converts tuple arrays to a schema object", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          linked: { $ref: "#/$defs/Linked", description: "drop me" },
          tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
          prefixTuple: { type: "array", prefixItems: [{ type: "boolean" }, { type: "string" }] },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        linked: { $ref: "#/$defs/Linked" },
        tuple: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
        prefixTuple: { type: "array", items: { anyOf: [{ type: "boolean" }, { type: "string" }] } },
      },
    })
  })

  test("gemini handles numeric enums, dangling required fields, untyped arrays, and scalar object keys", () => {
    expect(
      ToolSchemaProjection.gemini({
        type: "object",
        required: ["status", "missing"],
        properties: {
          status: { type: "integer", enum: [1, 2] },
          tags: { type: "array" },
          name: { type: "string", properties: { ignored: { type: "string" } }, required: ["ignored"] },
        },
      }),
    ).toEqual({
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["1", "2"] },
        tags: { type: "array", items: { type: "string" } },
        name: { type: "string" },
      },
    })
  })

  test("gemini drops boolean const/enum constraints and folds other consts into string enums", () => {
    // Shape observed from an MCP server: a top-level anyOf branch constraining a boolean
    // property with `const: true` (issue #357). Gemini's enum is string-only, so raw
    // booleans must never survive into `enum`.
    expect(
      ToolSchemaProjection.gemini({
        type: "object",
        properties: {
          allow_launch: { type: "boolean", const: true },
          flag: { type: "boolean", enum: [true, false] },
          mode: { const: "fast" },
          count: { type: "integer", const: 5 },
        },
        anyOf: [{ required: ["pid"] }, { properties: { allow_launch: { const: true } }, required: ["allow_launch"] }],
      }),
    ).toEqual({
      type: "object",
      properties: {
        allow_launch: { type: "boolean" },
        flag: { type: "boolean" },
        mode: { enum: ["fast"] },
        count: { type: "string", enum: ["5"] },
      },
      anyOf: [{ required: ["pid"] }, { properties: { allow_launch: {} }, required: ["allow_launch"] }],
    })
  })

  test("anthropic hoists top-level combinators into a flat object schema", () => {
    // Anthropic rejects oneOf/allOf/anyOf at the top level of input_schema (issue #357).
    expect(
      ToolSchemaProjection.anthropic({
        type: "object",
        properties: {
          pid: { type: "integer" },
          allow_launch: { type: "boolean", description: "launch flag" },
        },
        required: [],
        additionalProperties: false,
        anyOf: [
          { required: ["pid"] },
          { properties: { allow_launch: { const: true }, profile: { type: "object" } }, required: ["allow_launch"] },
        ],
      }),
    ).toEqual({
      type: "object",
      properties: {
        pid: { type: "integer" },
        allow_launch: { type: "boolean", description: "launch flag" },
        profile: { type: "object" },
      },
      required: [],
      additionalProperties: false,
    })
  })

  test("anthropic leaves schemas without top-level combinators untouched", () => {
    const schema = {
      type: "object",
      properties: { path: { type: "string" }, maybe: { anyOf: [{ type: "string" }, { type: "null" }] } },
      required: ["path"],
    }
    expect(ToolSchemaProjection.anthropic(schema)).toEqual(schema)
  })

  test("gemini keeps an optional object typed so its properties survive", () => {
    // Shape an MCP server emits for an optional object parameter.
    expect(
      ToolSchemaProjection.gemini({
        type: "object",
        properties: {
          cursor_theme: {
            type: ["object", "null"],
            properties: { theme_id: { type: "string" } },
            required: ["theme_id"],
          },
          note: { type: ["string", "null"] },
          either: { type: ["string", "number"] },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        cursor_theme: {
          type: "object",
          nullable: true,
          required: ["theme_id"],
          properties: { theme_id: { type: "string" } },
        },
        note: { type: "string", nullable: true },
        either: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
    })
  })

  test("openai keeps one flat object top-level schema", () => {
    expect(
      ToolSchemaProjection.openAI({
        anyOf: [
          {
            type: "object",
            properties: {
              path: { type: "string" },
              maybe: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
          { type: "object", properties: { resource: { type: "string" } } },
        ],
      }),
    ).toEqual({
      type: "object",
      properties: {
        path: { type: "string" },
        maybe: { type: "string" },
        resource: { type: "string" },
      },
      additionalProperties: false,
    })
  })

  it.effect("applies model compatibility before protocol projection", () =>
    Effect.gen(function* () {
      const model = OpenAIChat.route
        .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
        .model({ id: "kimi-k2", compatibility: { toolSchema: "moonshot" } })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Use the tool.",
          tools: [
            {
              name: "lookup",
              description: "Lookup data.",
              inputSchema: {
                type: "object",
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
                      linked: { $ref: "#/$defs/Linked", description: "drop me" },
                    },
                  },
                ],
              },
            },
          ],
        }),
      )

      expect(prepared.body.tools?.[0]?.function.parameters).toEqual({
        type: "object",
        properties: {
          tuple: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
          linked: { $ref: "#/$defs/Linked" },
        },
        additionalProperties: false,
      })
    }),
  )
})
