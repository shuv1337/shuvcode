import { expect, test } from "bun:test"
import {
  createClipboard,
  type ClipboardReadOptions,
  type ClipboardReadResult,
  type HostClipboardService,
} from "@opentui/core"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createClipboardAdapter } from "../src/clipboard"
import { withWlPasteFallback } from "../src/clipboard-wl-paste"

const unix = process.platform === "win32" ? test.skip : test
const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])
const request: ClipboardReadOptions = { preferredTypes: ["image/png", "text/plain"], selection: "clipboard" }
const empty: ClipboardReadResult = { status: "empty" }

function nativeHost(result: ClipboardReadResult): HostClipboardService {
  return {
    maxWriteBytes: 1024,
    async read() {
      return result
    },
    async writeText() {
      return { status: "written" }
    },
    async clear() {
      return { status: "cleared" }
    },
    async dispose() {},
  }
}

// A real executable that answers like wl-paste: --list-types prints the offered types and any other
// invocation prints the payload. Every invocation's arguments are recorded.
async function withWlPaste<T>(
  input: { types?: string[]; payload?: Uint8Array; listExit?: number; readExit?: number },
  run: (stub: { command: string; calls: () => Promise<string[]> }) => Promise<T>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "wl-paste-"))
  const command = path.join(dir, "wl-paste")
  await writeFile(path.join(dir, "payload"), input.payload ?? new Uint8Array())
  await writeFile(
    command,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> '${dir}/calls'`,
      `case " $* " in *" --list-types "*) printf '%s\\n' ${(input.types ?? []).map((type) => `'${type}'`).join(" ")}; exit ${input.listExit ?? 0};; esac`,
      `cat '${dir}/payload'`,
      `exit ${input.readExit ?? 0}`,
    ].join("\n"),
  )
  await chmod(command, 0o755)
  return run({
    command,
    calls: () =>
      readFile(path.join(dir, "calls"), "utf8").then(
        (text) => text.trim().split("\n"),
        () => [],
      ),
  }).finally(() => rm(dir, { recursive: true, force: true }))
}

unix("reads the offered image through wl-paste when the native read finds nothing", () =>
  withWlPaste({ types: ["text/plain;charset=utf-8", "image/png"], payload: image }, async (wlPaste) => {
    const clipboard = withWlPasteFallback(nativeHost(empty), wlPaste.command)

    expect(await clipboard.read(request)).toEqual({
      status: "read",
      representation: { mimeType: "image/png", bytes: image },
    })
    expect(await wlPaste.calls()).toEqual(["--list-types", "--no-newline --type image/png"])
  }),
)

unix("falls back when the native read is unsupported", () =>
  withWlPaste({ types: ["image/png"], payload: image }, async (wlPaste) => {
    const clipboard = withWlPasteFallback(nativeHost({ status: "unsupported" }), wlPaste.command)

    expect(await clipboard.read(request)).toMatchObject({ status: "read" })
  }),
)

unix("follows the preferred type order and drops MIME parameters", () =>
  withWlPaste(
    { types: ["image/png", "text/plain;charset=utf-8"], payload: new TextEncoder().encode("hello") },
    async (wlPaste) => {
      const clipboard = withWlPasteFallback(nativeHost(empty), wlPaste.command)

      expect(await clipboard.read({ preferredTypes: ["text/plain", "image/png"] })).toEqual({
        status: "read",
        representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("hello") },
      })
      expect(await wlPaste.calls()).toEqual(["--list-types", "--no-newline --type text/plain;charset=utf-8"])
    },
  ),
)

unix("reads the primary selection when asked", () =>
  withWlPaste({ types: ["image/png"], payload: image }, async (wlPaste) => {
    const clipboard = withWlPasteFallback(nativeHost(empty), wlPaste.command)

    await clipboard.read({ preferredTypes: ["image/png"], selection: "primary" })

    expect(await wlPaste.calls()).toEqual(["--primary --list-types", "--primary --no-newline --type image/png"])
  }),
)

unix("keeps a native read that succeeded", () =>
  withWlPaste({ types: ["image/png"], payload: image }, async (wlPaste) => {
    const native: ClipboardReadResult = {
      status: "read",
      representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("native") },
    }
    const clipboard = withWlPasteFallback(nativeHost(native), wlPaste.command)

    expect(await clipboard.read(request)).toBe(native)
    expect(await wlPaste.calls()).toEqual([])
  }),
)

unix("keeps the native result when wl-paste has nothing usable", async () => {
  const cases = [
    { types: ["text/html"], payload: image },
    { types: ["image/png"], payload: image, listExit: 1 },
    { types: ["image/png"], payload: image, readExit: 1 },
  ]
  await Promise.all(
    cases.map((input) =>
      withWlPaste(input, async (wlPaste) => {
        expect(await withWlPasteFallback(nativeHost(empty), wlPaste.command).read(request)).toBe(empty)
      }),
    ),
  )
  expect(await withWlPasteFallback(nativeHost(empty), "/nonexistent/wl-paste").read(request)).toBe(empty)
})

unix("reports a payload over the read limit", () =>
  withWlPaste({ types: ["image/png"], payload: new Uint8Array(8 * 1024 * 1024 + 1) }, async (wlPaste) => {
    const clipboard = withWlPasteFallback(nativeHost(empty), wlPaste.command)

    expect(await clipboard.read(request)).toEqual({ status: "limit-exceeded" })
  }),
)

test("leaves the host untouched when wl-paste is not in use", () => {
  const host = nativeHost(empty)

  expect(withWlPasteFallback(host, undefined)).toBe(host)
})

test("delegates everything except reads to the native host", async () => {
  const calls: string[] = []
  const host: HostClipboardService = {
    maxWriteBytes: 4096,
    read: async () => empty,
    writeText: async (text, options) => {
      calls.push(`write ${text} ${options?.selection}`)
      return { status: "written" }
    },
    clear: async (options) => {
      calls.push(`clear ${options?.selection}`)
      return { status: "cleared" }
    },
    dispose: async () => {
      calls.push("dispose")
    },
  }
  const clipboard = withWlPasteFallback(host, "/nonexistent/wl-paste")

  expect(clipboard.maxWriteBytes).toBe(4096)
  expect(await clipboard.writeText("hello", { selection: "primary" })).toEqual({ status: "written" })
  expect(await clipboard.clear({ selection: "clipboard" })).toEqual({ status: "cleared" })
  await clipboard.dispose()
  expect(calls).toEqual(["write hello primary", "clear clipboard", "dispose"])
})

unix("lets the TUI clipboard attach an image the native read could not find", () =>
  withWlPaste({ types: ["image/png"], payload: image }, async (wlPaste) => {
    const clipboard = createClipboardAdapter(
      createClipboard({
        host: withWlPasteFallback(nativeHost(empty), wlPaste.command),
        terminal: {
          remote: false,
          writeText: () => ({ status: "attempted", capability: "supported" }),
          clear: () => ({ status: "attempted", capability: "supported" }),
        },
      }),
    )

    expect(await clipboard.read()).toEqual({ data: Buffer.from(image).toString("base64"), mime: "image/png" })
  }),
)
