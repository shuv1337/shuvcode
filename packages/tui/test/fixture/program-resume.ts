import { expect } from "bun:test"
import { createHash } from "node:crypto"

export const token = "dummy-token-replace-me"

export function readResume(sequence: string) {
  const match = /^\x1b\]7577;(.+):mac=([0-9a-f]{64})\x1b\\$/.exec(sequence)
  if (!match) throw new Error("Invalid OSC 7577 framing")
  const body = match[1]
  expect(match[2]).toBe(createHash("sha256").update(body).update(":").update(token).digest("hex"))
  const fields = new URLSearchParams(body.replaceAll(":", "&").replaceAll("+", "%2B"))
  const decode = (text: string) => Buffer.from(text, "base64").toString("utf8")
  const argv = fields.get("argv")
  const cwd = fields.get("cwd")
  return {
    pid: Number(fields.get("pid")),
    time: Number(fields.get("time")),
    clear: fields.get("clear") === "1",
    argv: argv?.split(",").map(decode),
    cwd: cwd === null ? undefined : decode(cwd),
  }
}
