import { appendFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Local JSONL record of one call: what the voice model heard and said, what it handed to
 * the voice agent, and what the coding session did. Used to tell transcription problems
 * apart from reasoning problems. Stored only on this machine; disable with `log: false`.
 */
export class CallLog {
  readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(callID: string) {
    const base =
      process.env.XDG_STATE_HOME ??
      (process.platform === "win32"
        ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"))
        : path.join(os.homedir(), ".local", "state"))
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    this.file = path.join(base, "shuvcode", "gpt-live", "calls", `${stamp}-${callID}.jsonl`)
  }

  write(entry: Record<string, unknown>) {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`
    // Writes are chained so lines stay in order; a failed write never breaks the call.
    this.queue = this.queue.then(() => this.append(line)).catch(() => undefined)
  }

  private async append(line: string) {
    await mkdir(path.dirname(this.file), { recursive: true })
    await appendFile(this.file, line)
  }
}
