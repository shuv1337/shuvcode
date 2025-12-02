#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

await import("./build")

const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = value.replace("./src/", "./dist/").replace(".ts", "")
  /// @ts-expect-error
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
// Skip SDK publish for fork
console.log("Skipping SDK publish (fork)")
await Bun.write("package.json", JSON.stringify(original, null, 2))
