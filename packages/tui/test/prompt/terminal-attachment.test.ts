import { describe, expect, test } from "bun:test"
import { terminalSnapshotAttachment } from "../../src/component/prompt/terminal-attachment"

const snapshot = {
  ptyID: "pty_session",
  title: "Build",
  cwd: "/project",
  foregroundProcess: "bun test",
  screen: { text: "passed\n", cols: 80, rows: 24, cursor: { x: 0, y: 1 } },
}

describe("@terminal attachment", () => {
  test("captures a model-visible text attachment with built-in terminal provenance", () => {
    const attachment = terminalSnapshotAttachment(snapshot)
    expect(attachment.name).toBe("session-terminal-snapshot.txt")
    expect(attachment.uri.startsWith("data:text/plain;base64,")).toBe(true)
    const text = Buffer.from(attachment.uri.slice("data:text/plain;base64,".length), "base64").toString("utf8")
    expect(text).toContain("Current session built-in terminal snapshot")
    expect(text).toContain("Terminal ID: pty_session")
    expect(text).toContain("Working directory: /project")
    expect(text).toContain("Title: Build")
    expect(text).toContain("passed\n")
  })

  test("rejects missing or empty terminal instead of sending a bare mention", () => {
    expect(() => terminalSnapshotAttachment(null)).toThrow("No current session terminal")
    expect(() => terminalSnapshotAttachment({ ...snapshot, screen: { ...snapshot.screen, text: "  \n" } })).toThrow(
      "no output",
    )
  })

  test("strips control bytes so terminal output stays a text attachment", () => {
    const attachment = terminalSnapshotAttachment({ ...snapshot, screen: { ...snapshot.screen, text: "ok\x00\x07\n" } })
    const text = Buffer.from(attachment.uri.slice("data:text/plain;base64,".length), "base64").toString("utf8")
    expect(text).toContain("ok\n")
    expect(text).not.toContain("\x00")
  })

  test("bounds output while retaining the most recent terminal text", () => {
    const attachment = terminalSnapshotAttachment({
      ...snapshot,
      screen: { ...snapshot.screen, text: "START-MARKER" + "old".repeat(10_000) + "RECENT" },
    })
    const text = Buffer.from(attachment.uri.slice("data:text/plain;base64,".length), "base64").toString("utf8")
    expect(text).toContain("truncated to last 16000 characters")
    expect(text).toContain("RECENT")
    expect(text).not.toContain("START-MARKER")
  })
})
