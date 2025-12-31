// Ripgrep utility functions
import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { lazy } from "../util/lazy"
import { $ } from "bun"

import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"
import { Log } from "@/util/log"

export namespace Ripgrep {
  const log = Log.create({ service: "ripgrep" })
  const Stats = z.object({
    elapsed: z.object({
      secs: z.number(),
      nanos: z.number(),
      human: z.string(),
    }),
    searches: z.number(),
    searches_with_match: z.number(),
    bytes_searched: z.number(),
    bytes_printed: z.number(),
    matched_lines: z.number(),
    matches: z.number(),
  })

  const Begin = z.object({
    type: z.literal("begin"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
    }),
  })

  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      lines: z.object({
        text: z.string(),
      }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(
        z.object({
          match: z.object({
            text: z.string(),
          }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  })

  const End = z.object({
    type: z.literal("end"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      binary_offset: z.number().nullable(),
      stats: Stats,
    }),
  })

  const Summary = z.object({
    type: z.literal("summary"),
    data: z.object({
      elapsed_total: z.object({
        human: z.string(),
        nanos: z.number(),
        secs: z.number(),
      }),
      stats: Stats,
    }),
  })

  const Result = z.union([Begin, Match, End, Summary])

  export type Result = z.infer<typeof Result>
  export type Match = z.infer<typeof Match>
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>
  const PLATFORM = {
    "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-linux": {
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
    },
    "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
  } as const

  export const ExtractionFailedError = NamedError.create(
    "RipgrepExtractionFailedError",
    z.object({
      filepath: z.string(),
      stderr: z.string(),
    }),
  )

  export const UnsupportedPlatformError = NamedError.create(
    "RipgrepUnsupportedPlatformError",
    z.object({
      platform: z.string(),
    }),
  )

  export const DownloadFailedError = NamedError.create(
    "RipgrepDownloadFailedError",
    z.object({
      url: z.string(),
      status: z.number(),
    }),
  )

  const state = lazy(async () => {
    let filepath = Bun.which("rg")
    if (filepath) return { filepath }
    filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
      const config = PLATFORM[platformKey]
      if (!config) throw new UnsupportedPlatformError({ platform: platformKey })

      const version = "14.1.1"
      const filename = `ripgrep-${version}-${config.platform}.${config.extension}`
      const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`

      const response = await fetch(url)
      if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

      const buffer = await response.arrayBuffer()
      const archivePath = path.join(Global.Path.bin, filename)
      await Bun.write(archivePath, buffer)
      if (config.extension === "tar.gz") {
        const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

        if (platformKey.endsWith("-darwin")) args.push("--include=*/rg")
        if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/rg")

        const proc = Bun.spawn(args, {
          cwd: Global.Path.bin,
          stderr: "pipe",
          stdout: "pipe",
        })
        await proc.exited
        if (proc.exitCode !== 0)
          throw new ExtractionFailedError({
            filepath,
            stderr: await Bun.readableStreamToText(proc.stderr),
          })
      }
      if (config.extension === "zip") {
        if (config.extension === "zip") {
          const zipFileReader = new ZipReader(new BlobReader(new Blob([await Bun.file(archivePath).arrayBuffer()])))
          const entries = await zipFileReader.getEntries()
          let rgEntry: any
          for (const entry of entries) {
            if (entry.filename.endsWith("rg.exe")) {
              rgEntry = entry
              break
            }
          }

          if (!rgEntry) {
            throw new ExtractionFailedError({
              filepath: archivePath,
              stderr: "rg.exe not found in zip archive",
            })
          }

          const rgBlob = await rgEntry.getData(new BlobWriter())
          if (!rgBlob) {
            throw new ExtractionFailedError({
              filepath: archivePath,
              stderr: "Failed to extract rg.exe from zip archive",
            })
          }
          await Bun.write(filepath, await rgBlob.arrayBuffer())
          await zipFileReader.close()
        }
      }
      await fs.unlink(archivePath)
      if (!platformKey.endsWith("-win32")) await fs.chmod(filepath, 0o755)
    }

    return {
      filepath,
    }
  })

  export async function filepath() {
    const { filepath } = await state()
    return filepath
  }

  export async function* files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
  }) {
    const args = [await filepath(), "--files", "--glob=!.git/*"]
    if (input.follow !== false) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    // Bun.spawn should throw this, but it incorrectly reports that the executable does not exist.
    // See https://github.com/oven-sh/bun/issues/24012
    if (!(await fs.stat(input.cwd).catch(() => undefined))?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    const proc = Bun.spawn(args, {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "ignore",
      maxBuffer: 1024 * 1024 * 20,
    })

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // Handle both Unix (\n) and Windows (\r\n) line endings
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line) yield line
        }
      }

      if (buffer) yield buffer
    } finally {
      reader.releaseLock()
      await proc.exited
    }
  }

  /**
   * Generates an indented tree view of files in a directory.
   *
   * Directories are listed before files at each level, both sorted alphabetically.
   * Uses BFS traversal to ensure breadth-first coverage when truncating.
   *
   * @example
   * ```
   * src/
   *     components/
   *         Button.tsx
   *         Input.tsx
   *         [3 truncated]
   *     index.ts
   * package.json
   * ```
   *
   * @param input.cwd - The directory to scan
   * @param input.limit - Max entries to include (default: 50). When exceeded,
   *   remaining siblings are collapsed into `[N truncated]` markers.
   * @returns Newline-separated tree with tab indentation per depth level
   */
  export async function tree(input: { cwd: string; limit?: number }) {
    log.info("tree", input)
    const limit = input.limit ?? 50
    const files = await Array.fromAsync(Ripgrep.files({ cwd: input.cwd }))

    /**
     * Tree node with parent reference for ancestor traversal.
     *
     * Each node represents a file or directory. Directories have children,
     * files don't. Uses Map for O(1) child lookup during tree construction
     * (critical for repos with 40k+ files).
     *
     * The parent reference enables bottom-up selection: when we select a deep
     * file, we automatically select all its ancestors so the path renders.
     */
    class FileNode {
      readonly children: FileNode[] = []
      private readonly lookup = new Map<string, FileNode>()
      private sorted = false
      selected = false

      constructor(
        readonly name: string = "",
        readonly parent: FileNode | null = null,
      ) {}

      /**
       * Gets an existing child by name, or creates it if it doesn't exist.
       *
       * Uses Map lookup for O(1) access. When creating, establishes the
       * parent link so the child can propagate selection upward.
       *
       * @param name - The directory or file name (not a path)
       * @returns The existing or newly created child node
       */
      child(name: string): FileNode {
        let node = this.lookup.get(name)
        if (!node) {
          node = new FileNode(name, this)
          this.children.push(node)
          this.lookup.set(name, node)
        }
        return node
      }

      /**
       * Inserts a file path into the tree, creating intermediate directories.
       *
       * @example
       * root.insert(["src", "utils", "format.ts"])
       * // Creates: root -> src/ -> utils/ -> format.ts
       *
       * @param parts - Path segments from root to file
       */
      insert(parts: string[]): void {
        let node: FileNode = this
        for (const part of parts) node = node.child(part)
      }

      /**
       * Sorts children: directories first, then alphabetically.
       *
       * Lazy - only sorts once per node. Called during BFS traversal,
       * so we only sort nodes we actually visit. For a 40k file repo
       * with limit=200, this saves sorting thousands of unvisited nodes.
       */
      sort(): void {
        if (this.sorted) return
        this.children.sort((a, b) => {
          if (a.isDir !== b.isDir) return b.isDir ? 1 : -1
          return a.name.localeCompare(b.name)
        })
        this.sorted = true
      }

      /** A node is a directory if it has children (files are leaves). */
      get isDir(): boolean {
        return this.children.length > 0
      }

      /**
       * Marks this node for rendering, propagating up to ancestors.
       *
       * Called during BFS when this node is chosen within the limit.
       * Recursively selects the parent chain so the full path renders.
       *
       * @example
       * // Selecting "format.ts" also selects "utils/" and "src/"
       * formatNode.select()
       * // Now: root.selected=true, src.selected=true,
       * //      utils.selected=true, format.selected=true
       */
      select(): void {
        this.selected = true
        this.parent?.select()
      }

      /**
       * Renders this subtree as an indented string.
       *
       * Only renders selected nodes. Appends "/" to directories.
       * Shows "[N truncated]" for directories with unselected children,
       * so users know there's more content they're not seeing.
       *
       * @param indentLevel - Current indentation level (0 for root's children)
       * @returns Newline-separated tree with tab indentation
       */
      render(indentLevel = 0): string {
        if (!this.selected) return ""

        const outputLines: string[] = []
        // Root node has no name, so children stay at same indent level
        const childIndentLevel = this.name ? indentLevel + 1 : indentLevel

        if (this.name) {
          outputLines.push("\t".repeat(indentLevel) + this.name + (this.isDir ? "/" : ""))
        }

        for (const child of this.children) {
          const renderedChild = child.render(childIndentLevel)
          if (renderedChild) outputLines.push(renderedChild)
        }

        const unselectedChildCount = this.children.filter((c) => !c.selected).length
        if (unselectedChildCount > 0) {
          outputLines.push("\t".repeat(childIndentLevel) + `[${unselectedChildCount} truncated]`)
        }

        return outputLines.join("\n")
      }
    }

    // Build complete tree from file list
    const root = new FileNode()
    for (const file of files) {
      if (!file.includes(".opencode")) {
        root.insert(file.split(path.sep))
      }
    }

    // Select up to `limit` entries using BFS with round-robin.
    //
    // Why BFS? Ensures we show top-level structure before diving deep.
    // A repo with src/, docs/, tests/ should show all three before
    // showing src/components/Button/styles/...
    //
    // Why round-robin? Distributes selection evenly across siblings.
    // Instead of showing all of src/'s children before any of docs/,
    // we alternate: src/index.ts, docs/README.md, src/utils.ts, docs/api.md...
    // This gives a balanced view of the entire repo structure.
    let selectedCount = 0
    let nodesAtCurrentDepth: FileNode[] = [root]

    while (nodesAtCurrentDepth.length > 0 && selectedCount < limit) {
      // Collect all children for the next BFS depth level
      const nodesAtNextDepth: FileNode[] = []
      for (const parent of nodesAtCurrentDepth) {
        parent.sort()
        nodesAtNextDepth.push(...parent.children)
      }

      // Round-robin: take 1st child from each parent, then 2nd from each, etc.
      // This ensures fair distribution across all branches at this depth.
      const mostChildrenAnyParentHas = Math.max(0, ...nodesAtCurrentDepth.map((n) => n.children.length))
      roundRobin: for (let childIndex = 0; childIndex < mostChildrenAnyParentHas; childIndex++) {
        for (const parent of nodesAtCurrentDepth) {
          const child = parent.children[childIndex]
          if (!child) continue
          child.select() // Also selects ancestors via parent chain
          if (++selectedCount >= limit) break roundRobin
        }
      }

      nodesAtCurrentDepth = nodesAtNextDepth
    }

    return root.render()
  }

  export async function search(input: { cwd: string; pattern: string; glob?: string[]; limit?: number }) {
    const args = [`${await filepath()}`, "--json", "--hidden", "--glob='!.git/*'"]

    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    if (input.limit) {
      args.push(`--max-count=${input.limit}`)
    }

    args.push("--")
    args.push(input.pattern)

    const command = args.join(" ")
    const result = await $`${{ raw: command }}`.cwd(input.cwd).quiet().nothrow()
    if (result.exitCode !== 0) {
      return []
    }

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = result.text().trim().split(/\r?\n/).filter(Boolean)
    // Parse JSON lines from ripgrep output

    return lines
      .map((line) => JSON.parse(line))
      .map((parsed) => Result.parse(parsed))
      .filter((r) => r.type === "match")
      .map((r) => r.data)
  }
}
