import { describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import path from "node:path"

const src = path.join(import.meta.dir, "../src")

describe("public entrypoints", () => {
  test("src imports only @opencode-ai/plugin and @opencode-ai/schema", async () => {
    const files = await readdir(src)
    const sources = await Promise.all(
      files.filter((file) => file.endsWith(".ts")).map(async (file) => [file, await Bun.file(path.join(src, file)).text()] as const),
    )
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/from ["']@opencode-ai\/core/)
      expect(text, file).not.toMatch(/from ["']@opencode-ai\/util/)
      expect(text, file).not.toMatch(/from ["']@opencode-ai\/server/)
      const imports = [...text.matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1]!)
      for (const spec of imports) {
        if (spec.startsWith(".") || spec.startsWith("node:") || spec === "effect" || spec === "bun:sqlite") continue
        expect(
          spec.startsWith("@opencode-ai/plugin") || spec.startsWith("@opencode-ai/schema"),
          `${file} imports ${spec}`,
        ).toBe(true)
      }
    }
  })

  test("reloads catalog from ctx.event.subscribe Google credential events", async () => {
    const text = await Bun.file(path.join(src, "index.ts")).text()
    expect(text).toContain("ctx.event.subscribe()")
    expect(text).toContain("credential.switched")
    expect(text).toContain("credential.updated")
    expect(text).not.toContain("Bus.Service")
  })
})
