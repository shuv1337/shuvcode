import { createHash } from "node:crypto"
import { isAbsolute } from "node:path"
import { RendererControlState } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, onCleanup } from "solid-js"
import { useData } from "./data"
import { useRoute } from "./route"

const OSC7577_MAX_BYTES = 2048
const OSC7577_MAX_ARGS = 64
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

type Write = (sequence: string) => boolean | void

export type ProgramResumeInput = {
  readonly token: string
  readonly cwd: string
  readonly command: (sessionID?: string) => readonly string[]
  readonly write: Write
  readonly useNativeSession?: boolean
}

export function programResumeReport(input: {
  token: string
  pid: number
  time: number
  command?: { argv: readonly string[]; cwd?: string }
}): string {
  if (!Number.isSafeInteger(input.pid) || input.pid <= 0 || !Number.isSafeInteger(input.time) || input.time <= 0)
    return ""

  const wrap = (report: string) => {
    const body = `pid=${input.pid}:time=${input.time}:${report}`
    const mac = createHash("sha256").update(`${body}:${input.token}`).digest("hex")
    return `\x1b]7577;${body}:mac=${mac}\x1b\\`
  }
  const command = input.command
  if (command && validCommand(command)) {
    const argv = command.argv.map(base64).join(",")
    const cwd = command.cwd === undefined ? "" : `:cwd=${base64(command.cwd)}`
    const sequence = wrap(`argv=${argv}${cwd}`)
    if (Buffer.byteLength(sequence, "utf8") <= OSC7577_MAX_BYTES) return sequence
  }
  // An unreportable command must not leave an older resume command in the terminal.
  return wrap("clear=1")
}

function validCommand(command: { argv: readonly string[]; cwd?: string }) {
  const executable = command.argv[0]
  if (!executable || executable === "." || executable === "..") return false
  return (
    command.argv.length <= OSC7577_MAX_ARGS &&
    (isAbsolute(executable) || (!executable.startsWith("-") && !/[/\\]/.test(executable))) &&
    command.argv.every(validText) &&
    (command.cwd === undefined || (isAbsolute(command.cwd) && validText(command.cwd)))
  )
}

function validText(text: string) {
  return text.isWellFormed() && !CONTROL_CHAR_PATTERN.test(text)
}

function base64(text: string) {
  return Buffer.from(text, "utf8").toString("base64")
}

export function createProgramResumeReporter(
  input: ProgramResumeInput | undefined,
  options?: {
    pid?: number
    now?: () => number
  },
) {
  if (!input) return { report: () => {}, reemit: () => {}, clear: () => {}, attachLiveWrite: () => () => {} }
  const pid = options?.pid ?? process.pid
  const now = options?.now ?? Date.now
  let lastTime = 1
  let lastKey: string | undefined
  let target: { sessionID: string | undefined } | undefined
  let liveWrite: Write | undefined
  let closed = false

  const nextTime = () => (lastTime = Math.max(lastTime, Math.floor(now() / 1000)))
  const write = (writer: Write | undefined, sequence: string) => {
    if (!writer || !sequence) return false
    try {
      return writer(sequence) !== false
    } catch {
      // Terminal writes are best-effort, including when the terminal has already gone away.
      return false
    }
  }
  const report = (sessionID?: string, options?: { force?: boolean }) => {
    if (closed) return
    target = { sessionID }
    const command = { argv: input.command(sessionID), cwd: input.cwd }
    const key = JSON.stringify(command)
    if (!options?.force && key === lastKey) return
    const sequence = programResumeReport({ token: input.token, pid, time: nextTime(), command })
    if (!sequence) return
    const reportedKey = sequence.includes(":clear=1:") ? "clear" : key
    if (reportedKey === "clear" && lastKey === "clear") return
    // Direct terminal output cannot run alongside OpenTUI's native writer.
    if (!write(liveWrite ?? (input.useNativeSession ? undefined : input.write), sequence)) return
    lastKey = reportedKey
  }
  return {
    report,
    reemit() {
      if (target) report(target.sessionID, { force: true })
    },
    attachLiveWrite(writer: Write) {
      liveWrite = writer
      return () => {
        liveWrite = undefined
      }
    },
    clear() {
      if (closed) return
      closed = true
      write(input.write, programResumeReport({ token: input.token, pid, time: nextTime() }))
    },
  }
}

export function ProgramResume(props: { reporter: ReturnType<typeof createProgramResumeReporter> }) {
  const route = useRoute()
  const data = useData()
  const renderer = useRenderer()
  let reported = false
  createEffect(() => {
    if (route.data.type === "plugin" && reported) return
    if (route.data.type !== "session") {
      props.reporter.report()
      reported = true
      return
    }
    const id = route.data.sessionID
    // Read the reactive metadata even while creation is in flight.
    if (id === "dummy" || !data.session.get(id) || data.session.creating(id)) return
    props.reporter.report(id)
    reported = true
  })

  if (process.platform !== "win32") {
    const onContinue = () => {
      if (renderer.controlState !== RendererControlState.EXPLICIT_SUSPENDED) props.reporter.reemit()
    }
    process.on("SIGCONT", onContinue)
    onCleanup(() => process.off("SIGCONT", onContinue))
  }
  return null
}
