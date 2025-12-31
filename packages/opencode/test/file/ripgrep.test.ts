import { test, expect } from "bun:test"
import { Ripgrep } from "../../src/file/ripgrep"
import { tmpdir } from "../fixture/fixture"
import * as fs from "fs/promises"
import path from "path"

test("tree returns empty for empty directory", async () => {
  await using tmp = await tmpdir()
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 50 })
  expect(result).toBe("")
})

test("tree returns single file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "index.ts"), "export {}")
    },
  })
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 50 })
  expect(result).toBe("index.ts")
})

test("tree returns flat file list sorted alphabetically", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(path.join(dir, "zebra.ts"), "")
      await fs.writeFile(path.join(dir, "apple.ts"), "")
      await fs.writeFile(path.join(dir, "mango.ts"), "")
    },
  })
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 50 })
  expect(result).toBe(`apple.ts
mango.ts
zebra.ts`)
})

test("tree shows directories before files", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"))
      await fs.writeFile(path.join(dir, "src", "index.ts"), "")
      await fs.writeFile(path.join(dir, "README.md"), "")
    },
  })
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 50 })
  expect(result).toBe(`src/
\tindex.ts
README.md`)
})

test("tree with nested directories", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src", "components"), { recursive: true })
      await fs.writeFile(path.join(dir, "src", "components", "Button.tsx"), "")
      await fs.writeFile(path.join(dir, "src", "components", "Input.tsx"), "")
      await fs.writeFile(path.join(dir, "src", "index.ts"), "")
      await fs.writeFile(path.join(dir, "package.json"), "{}")
    },
  })
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 50 })
  expect(result).toBe(`src/
\tcomponents/
\t\tButton.tsx
\t\tInput.tsx
\tindex.ts
package.json`)
})

test("tree respects limit and shows truncation", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"))
      // Create more files than the limit
      for (let i = 1; i <= 10; i++) {
        await fs.writeFile(path.join(dir, "src", `file${i.toString().padStart(2, "0")}.ts`), "")
      }
    },
  })
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 5 })
  // With limit=5, we should see src/ and 4 files, then truncation
  expect(result).toBe(`src/
\tfile01.ts
\tfile02.ts
\tfile03.ts
\tfile04.ts
\t[6 truncated]`)
})

test("tree excludes .opencode directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".opencode"))
      await fs.writeFile(path.join(dir, ".opencode", "config.json"), "{}")
      await fs.writeFile(path.join(dir, "index.ts"), "")
    },
  })
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 50 })
  expect(result).toBe("index.ts")
})

test("tree handles multiple directories at same level", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "api"))
      await fs.mkdir(path.join(dir, "lib"))
      await fs.mkdir(path.join(dir, "src"))
      await fs.writeFile(path.join(dir, "api", "routes.ts"), "")
      await fs.writeFile(path.join(dir, "lib", "utils.ts"), "")
      await fs.writeFile(path.join(dir, "src", "index.ts"), "")
    },
  })
  const result = await Ripgrep.tree({ cwd: tmp.path, limit: 50 })
  expect(result).toBe(`api/
\troutes.ts
lib/
\tutils.ts
src/
\tindex.ts`)
})
