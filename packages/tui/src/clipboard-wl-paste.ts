import { execFile } from "node:child_process"
import type { ClipboardReadOptions, ClipboardReadResult, HostClipboardService } from "@opentui/core"

// Matches the default read limit of OpenTUI's host clipboard.
const maxReadBytes = 8 * 1024 * 1024
const timeoutMs = 3_000

// OpenTUI's Wayland backend refuses to choose when the compositor offers several seats and XDG_SEAT
// does not name one (for example the Cua driver's Cua-Agent seats), so a read reports an empty
// clipboard. wl-paste takes the first seat, like other tools do, so retry through it.
export function withWlPasteFallback(host: HostClipboardService, wlPaste: string | undefined): HostClipboardService {
  if (wlPaste === undefined) return host
  return {
    maxWriteBytes: host.maxWriteBytes,
    async read(options) {
      const result = await host.read(options)
      if (result.status !== "empty" && result.status !== "unsupported") return result
      return (await readWithWlPaste(wlPaste, options)) ?? result
    },
    writeText: (text, options) => host.writeText(text, options),
    clear: (options) => host.clear(options),
    dispose: () => host.dispose(),
  }
}

async function readWithWlPaste(
  wlPaste: string,
  options: ClipboardReadOptions,
): Promise<ClipboardReadResult | undefined> {
  const selection = options.selection === "primary" ? ["--primary"] : []
  const listed = await run(wlPaste, [...selection, "--list-types"], options.signal)
  if (listed.status !== "ok") return
  const offered = listed.stdout
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
  const type = options.preferredTypes
    .map((preferred) => offered.find((item) => essence(item) === essence(preferred)))
    .find((item) => item !== undefined)
  if (type === undefined) return

  const data = await run(wlPaste, [...selection, "--no-newline", "--type", type], options.signal)
  if (data.status === "limit-exceeded") return { status: "limit-exceeded" }
  if (data.status !== "ok") return
  return { status: "read", representation: { mimeType: essence(type), bytes: new Uint8Array(data.stdout) } }
}

function run(command: string, args: string[], signal: AbortSignal | undefined) {
  return new Promise<{ status: "ok"; stdout: Buffer } | { status: "limit-exceeded" | "failed" }>((resolve) => {
    execFile(
      command,
      args,
      { encoding: "buffer", maxBuffer: maxReadBytes, timeout: timeoutMs, signal },
      (error, stdout) => {
        if (!error) return resolve({ status: "ok", stdout })
        resolve({ status: error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "limit-exceeded" : "failed" })
      },
    )
  })
}

function essence(type: string) {
  return type.split(";")[0].trim().toLowerCase()
}
