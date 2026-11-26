import { writeSync } from "node:fs"
import type { TuiInput } from "@opencode/tui"
import { parseServerURL } from "./services/service-urls"

declare const OPENCODE_CLI_NAME: string | undefined

// Keep the terminal token out of every child environment, even for commands that never report.
const rawToken = process.env.OSC7577_TOKEN
delete process.env.OSC7577_TOKEN

type Flags = { server?: string; standalone?: boolean; auto?: boolean }

export function isValidToken(token: string | undefined): token is string {
  return typeof token === "string" && token.length > 0 && !/[\s\u0000-\u001f\u007f-\u009f]/.test(token)
}

export function buildCommand(options: Flags & { bin: string }, sessionID?: string): readonly string[] {
  try {
    return [
      options.bin,
      ...(options.server !== undefined
        ? ["--server", parseServerURL(options.server)]
        : options.standalone
          ? ["--standalone"]
          : []),
      ...(options.auto ? ["--auto"] : []),
      ...(sessionID ? ["--session", sessionID] : []),
    ]
  } catch {
    // An unsafe server URL makes the command unreportable; don't substitute a different server.
    return []
  }
}

export function input(
  flags: Flags,
  ambient?: {
    token?: string
    isTTY?: boolean
    cwd?: string
    env?: Readonly<Record<string, string | undefined>>
    bin?: string
    write?: (sequence: string) => void
  },
): TuiInput["resume"] {
  const token = ambient ? ambient.token : rawToken
  const isTTY = ambient ? ambient.isTTY : process.stdout.isTTY
  const env = ambient?.env ?? process.env
  const bin = ambient ? ambient.bin : typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : undefined
  if (!isValidToken(token) || isTTY !== true || !bin) return
  if (env.OPENCODE_DRIVE !== undefined || env.OPENCODE_STORY !== undefined || env.OPENCODE_ROUTE !== undefined) return

  return {
    token,
    cwd: ambient?.cwd ?? process.cwd(),
    command: (sessionID) => buildCommand({ ...flags, bin }, sessionID),
    write:
      ambient?.write ??
      ((sequence) => {
        const stdout = process.stdout
        if (!stdout.isTTY || !stdout.writable || stdout.destroyed || stdout.writableEnded) return
        try {
          // One small terminal write, with synchronous error handling even if stdout is gone.
          writeSync(stdout.fd, sequence)
        } catch {}
      }),
  }
}

export * as ProgramResume from "./program-resume"
