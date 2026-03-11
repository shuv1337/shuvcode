import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Ripgrep } from "../../src/file/ripgrep"
import { tmpdir } from "../fixture/fixture"

describe("file.ripgrep", () => {
  test("defaults to include hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
        await Bun.write(path.join(dir, ".opencode", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path }))
    expect(files.includes("visible.txt")).toBe(true)
    expect(files.includes(path.join(".opencode", "thing.json"))).toBe(true)
  })

  test("hidden false excludes hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
        await Bun.write(path.join(dir, ".opencode", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path, hidden: false }))
    expect(files.includes("visible.txt")).toBe(true)
    expect(files.includes(path.join(".opencode", "thing.json"))).toBe(false)
  })

  test("search returns empty when nothing matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'other'\n")
      },
    })

    const hits = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "needle",
    })

    expect(hits).toEqual([])
  })

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
    expect(result).toBe(`src/\n\tindex.ts\nREADME.md`)
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
    expect(result).toBe(`src/\n\tcomponents/\n\t\tButton.tsx\n\t\tInput.tsx\n\tindex.ts\npackage.json`)
  })

  test("tree respects limit and shows truncation", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"))
        for (let i = 1; i <= 10; i++) {
          await fs.writeFile(path.join(dir, "src", `file${i.toString().padStart(2, "0")}.ts`), "")
        }
      },
    })
    const result = await Ripgrep.tree({ cwd: tmp.path, limit: 5 })
    expect(result).toBe(`src/\n\tfile01.ts\n\tfile02.ts\n\tfile03.ts\n\tfile04.ts\n\t[6 truncated]`)
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
    expect(result).toBe(`api/\n\troutes.ts\nlib/\n\tutils.ts\nsrc/\n\tindex.ts`)
  })
})
