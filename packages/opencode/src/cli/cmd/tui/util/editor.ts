import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"

export namespace Editor {
  export type Result = { ok: true; content: string } | { ok: false; reason: "no-editor" | "cancelled" }

  export async function open(opts: {
    value: string
    renderer: CliRenderer
    extension?: string
    line?: number
  }): Promise<Result> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) {
      return { ok: false, reason: "no-editor" }
    }

    const ext = opts.extension ?? ".md"
    const filepath = join(tmpdir(), `${Date.now()}${ext}`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Bun.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    const parts = editor.split(" ")
    const cmd = [...parts]

    // Common editors support +line syntax: vim, nvim, nano, code, emacs, etc.
    if (opts.line && opts.line > 0) {
      cmd.push(`+${opts.line}`)
    }
    cmd.push(filepath)

    const proc = Bun.spawn({
      cmd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    await proc.exited
    const content = await Bun.file(filepath).text()
    opts.renderer.currentRenderBuffer.clear()
    opts.renderer.resume()
    opts.renderer.requestRender()

    if (!content) {
      return { ok: false, reason: "cancelled" }
    }
    return { ok: true, content }
  }
}
