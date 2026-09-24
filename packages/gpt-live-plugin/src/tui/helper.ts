import { existsSync } from "node:fs"
import { chmod, mkdir, rename, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { FileSink } from "bun"

export type HelperEvent = { type: string } & Record<string, unknown>

const BINARY = process.platform === "win32" ? "gpt-live-host.exe" : "gpt-live-host"
const RELEASES = "https://github.com/shuv1337/shuvcode/releases/download"

/** Release asset name for this platform, e.g. gpt-live-host-linux-x64. */
export function helperAsset(platform = process.platform, arch = process.arch) {
  return `gpt-live-host-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`
}

function cacheDirectory(version: string) {
  const base =
    process.env.XDG_CACHE_HOME ??
    (process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"))
      : path.join(os.homedir(), ".cache"))
  return path.join(base, "shuvcode", "gpt-live", version, `${process.platform}-${process.arch}`)
}

/** Locates an installed helper without touching the network. */
export function locateHelper(version: string): string | undefined {
  return [
    process.env.GPT_LIVE_HOST,
    path.join(cacheDirectory(version), BINARY),
    // A cargo build in the source tree, for development runs.
    path.resolve(import.meta.dir, "../../native/target/release", BINARY),
  ].find((candidate): candidate is string => !!candidate && existsSync(candidate))
}

/**
 * Finds the audio helper, downloading it from the Shuvcode GitHub release for `version`
 * on first use and verifying it against that release's gpt-live-host-SHA256SUMS.
 */
export async function ensureHelper(version: string, onProgress?: (message: string) => void): Promise<string> {
  const existing = locateHelper(version)
  if (existing) return existing
  if (version === "local")
    throw new Error(
      'Development builds have no released audio helper. Run "bun run build:native" in packages/gpt-live-plugin, or set GPT_LIVE_HOST.',
    )
  const asset = helperAsset()
  const base = `${RELEASES}/v${version.replace(/^v/, "")}`
  onProgress?.(`Downloading the GPT-Live audio helper (${process.platform}-${process.arch})…`)
  const [binary, sums] = await Promise.all([fetch(`${base}/${asset}`), fetch(`${base}/gpt-live-host-SHA256SUMS`)])
  if (!binary.ok) throw new Error(`Could not download the audio helper (${binary.status}) from ${base}/${asset}`)
  if (!sums.ok) throw new Error(`Could not download helper checksums (${sums.status})`)
  const bytes = new Uint8Array(await binary.arrayBuffer())
  const expected = (await sums.text())
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name?.replace(/^\*/, "") === asset)?.[0]
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  if (!expected || expected.toLowerCase() !== actual)
    throw new Error("Audio helper checksum mismatch; refusing to run it")
  const directory = cacheDirectory(version)
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, BINARY)
  const partial = `${target}.${process.pid}.partial`
  await Bun.write(partial, bytes)
  if (process.platform !== "win32") await chmod(partial, 0o755)
  await rename(partial, target).catch(async (error) => {
    await rm(partial, { force: true })
    if (!existsSync(target)) throw error
  })
  return target
}

interface Pending {
  expect: string
  resolve: (event: HelperEvent) => void
  reject: (error: Error) => void
}

export interface HelperCallbacks {
  onEvent?: (event: HelperEvent) => void
  onExit?: (code: number | null, stderr: string) => void
}

/** A running gpt-live-host process speaking newline-delimited JSON over stdio. */
export class HelperProcess {
  private readonly process: Bun.Subprocess<"pipe", "pipe", "pipe">
  private readonly pending: Pending[] = []
  private stderr = ""
  private exited = false
  readonly ready: Promise<HelperEvent>

  constructor(
    binary: string,
    private readonly callbacks: HelperCallbacks = {},
  ) {
    this.process = Bun.spawn([binary], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, RUST_BACKTRACE: "0" },
    })
    this.ready = this.expect("ready")
    void this.readStdout()
    void this.readStderr()
    void this.watchExit()
  }

  private async watchExit() {
    const code = await this.process.exited
    this.exited = true
    const error = new Error(this.stderr.trim().split("\n").pop() || `audio helper exited (${code})`)
    for (const pending of this.pending.splice(0)) pending.reject(error)
    this.callbacks.onExit?.(code, this.stderr)
  }

  private expect(type: string) {
    return new Promise<HelperEvent>((resolve, reject) => {
      if (this.exited) reject(new Error("audio helper is not running"))
      else this.pending.push({ expect: type, resolve, reject })
    })
  }

  private async readStdout() {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of chunks(this.process.stdout)) {
      buffer += decoder.decode(chunk, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let event: HelperEvent
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        this.dispatch(event)
      }
    }
  }

  private async readStderr() {
    const decoder = new TextDecoder()
    for await (const chunk of chunks(this.process.stderr)) {
      this.stderr = (this.stderr + decoder.decode(chunk, { stream: true })).slice(-4000)
    }
  }

  private dispatch(event: HelperEvent) {
    if (event.type === "error" && this.pending.length > 0 && event.fatal !== true) {
      // Command failures reply with an error instead of the expected response.
      const index = this.pending.findIndex((pending) => pending.expect !== "ready")
      if (index >= 0) {
        const [pending] = this.pending.splice(index, 1)
        pending.reject(new Error(String(event.message)))
        this.callbacks.onEvent?.(event)
        return
      }
    }
    const index = this.pending.findIndex((pending) => pending.expect === event.type)
    if (index >= 0) {
      const [pending] = this.pending.splice(index, 1)
      pending.resolve(event)
    }
    this.callbacks.onEvent?.(event)
  }

  private send(command: Record<string, unknown>) {
    if (this.exited) throw new Error("audio helper is not running")
    const stdin = this.process.stdin as FileSink
    stdin.write(`${JSON.stringify(command)}\n`)
    stdin.flush()
  }

  async start(options: { input?: unknown; output?: unknown; duck?: boolean } = {}): Promise<string> {
    await this.ready
    const offer = this.expect("offer")
    this.send({
      type: "start",
      ...(options.input ? { input: options.input } : {}),
      ...(options.output ? { output: options.output } : {}),
      ...(options.duck ? { duckOthers: true } : {}),
    })
    return String((await offer).sdp)
  }

  async answer(sdp: string): Promise<void> {
    const connected = this.expect("connected")
    this.send({ type: "answer", sdp })
    await connected
  }

  mute(muted: boolean) {
    if (!this.exited) this.send({ type: "mute", muted })
  }

  clear() {
    if (!this.exited) this.send({ type: "clear" })
  }

  async close(timeoutMs = 3000): Promise<void> {
    if (this.exited) return
    try {
      this.send({ type: "close" })
    } catch {
      // Already gone.
    }
    const timer = setTimeout(() => this.process.kill(), timeoutMs)
    await this.process.exited
    clearTimeout(timer)
  }

  kill() {
    if (!this.exited) this.process.kill()
  }
}

/** Reads a stream chunk by chunk; the DOM ReadableStream type in the TUI program is not async-iterable. */
async function* chunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  while (true) {
    const next = await reader.read()
    if (next.done) return
    yield next.value
  }
}
