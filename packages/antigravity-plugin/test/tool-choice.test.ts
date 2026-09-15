import { expect, test } from "bun:test"
import { GoogleAntigravityWire } from "../src/wire"

for (const mode of ["NONE", "ANY", "VALIDATED", "AUTO"]) {
  test(`preserves explicit ${mode} tool restrictions in the Cloud Code envelope`, () => {
    const toolConfig = { functionCallingConfig: { mode, allowedFunctionNames: ["read"] }, extra: "kept" }
    const wrapped = GoogleAntigravityWire.wrapGenerateRequest({
      body: { tools: [{ functionDeclarations: [{ name: "read", parameters: { type: "object" } }] }], toolConfig },
      projectId: "fixture-project",
      model: "gemini-3.8-flash-high",
      sessionID: "fixture-session",
    })
    expect(wrapped).toMatchObject({
      request: {
        toolConfig: {
          extra: "kept",
          functionCallingConfig: { mode: mode === "AUTO" ? "VALIDATED" : mode, allowedFunctionNames: ["read"] },
        },
      },
    })
  })
}
