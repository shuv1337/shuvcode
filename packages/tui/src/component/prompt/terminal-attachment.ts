import type { PersistentPtyReadResult } from "@opencode/client"
import type { PromptInput } from "@opencode/schema/prompt-input"

export const TERMINAL_SNAPSHOT_LINES = 80
const TERMINAL_SNAPSHOT_CHARS = 16_000

// The attachment is a frozen, model-visible snapshot, not a live reference to a PTY.
export function terminalSnapshotAttachment(snapshot: PersistentPtyReadResult | null): PromptInput.FileAttachment {
  if (!snapshot) throw new Error("No current session terminal is available. Open and use the built-in terminal first.")
  const output = snapshot.screen.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  if (!output.trim()) throw new Error("The current session terminal has no output to attach.")

  const truncated = output.length > TERMINAL_SNAPSHOT_CHARS
  const text = truncated ? output.slice(-TERMINAL_SNAPSHOT_CHARS) : output
  const content = [
    "Current session built-in terminal snapshot (read-only; captured when this prompt was sent).",
    `Terminal ID: ${snapshot.ptyID.slice(0, 256)}`,
    `Title: ${snapshot.title.slice(0, 256)}`,
    `Working directory: ${snapshot.cwd.slice(0, 512)}`,
    `Foreground process: ${(snapshot.foregroundProcess ?? "none").slice(0, 256)}`,
    `Output: last ${TERMINAL_SNAPSHOT_LINES} rows${truncated ? ", truncated to last 16000 characters" : ""}`,
    "--- terminal output ---",
    text,
    "--- end terminal output ---",
  ].join("\n")
  return {
    uri: `data:text/plain;base64,${Buffer.from(content).toString("base64")}`,
    name: "session-terminal-snapshot.txt",
    description: `Built-in session terminal ${snapshot.ptyID.slice(0, 256)} snapshot`,
  }
}
