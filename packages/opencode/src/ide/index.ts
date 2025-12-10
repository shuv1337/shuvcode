import { spawn } from "bun"
import z from "zod"
import path from "path"
import { NamedError } from "@opencode-ai/util/error"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Connection, discoverLockFiles } from "./connection"
import { Permission } from "../permission"

const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },
  { name: "Visual Studio Code" as const, cmd: "code" },
  { name: "Cursor" as const, cmd: "cursor" },
  { name: "VSCodium" as const, cmd: "codium" },
]

export namespace Ide {
  const log = Log.create({ service: "ide" })

  export const Status = z
    .object({
      status: z.enum(["connected", "disconnected", "failed"]),
      name: z.string(),
      workspaceFolders: z.array(z.string()).optional(),
      error: z.string().optional(),
    })
    .meta({ ref: "IdeStatus" })
  export type Status = z.infer<typeof Status>

  export const Selection = z
    .object({
      text: z.string(),
      filePath: z.string(),
      fileUrl: z.string(),
      selection: z.object({
        start: z.object({ line: z.number(), character: z.number() }),
        end: z.object({ line: z.number(), character: z.number() }),
        isEmpty: z.boolean(),
      }),
    })
    .meta({ ref: "IdeSelection" })
  export type Selection = z.infer<typeof Selection>

  export const Event = {
    Installed: Bus.event(
      "ide.installed",
      z.object({
        ide: z.string(),
      }),
    ),
    SelectionChanged: Bus.event(
      "ide.selection.updated",
      z.object({
        selection: Selection,
      }),
    ),
  }

  export const AlreadyInstalledError = NamedError.create("AlreadyInstalledError", z.object({}))

  export const InstallFailedError = NamedError.create(
    "InstallFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  export function ide() {
    if (process.env["TERM_PROGRAM"] === "vscode") {
      const v = process.env["GIT_ASKPASS"]
      for (const ide of SUPPORTED_IDES) {
        if (v?.includes(ide.name)) return ide.name
      }
    }
    return "unknown"
  }

  export function alreadyInstalled() {
    return process.env["OPENCODE_CALLER"] === "vscode" || process.env["OPENCODE_CALLER"] === "vscode-insiders"
  }

  export async function install(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
    const cmd = SUPPORTED_IDES.find((i) => i.name === ide)?.cmd
    if (!cmd) throw new Error(`Unknown IDE: ${ide}`)

    const p = spawn([cmd, "--install-extension", "sst-dev.opencode"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await p.exited
    const stdout = await new Response(p.stdout).text()
    const stderr = await new Response(p.stderr).text()

    log.info("installed", {
      ide,
      stdout,
      stderr,
    })

    if (p.exitCode !== 0) {
      throw new InstallFailedError({ stderr })
    }
    if (stdout.includes("already installed")) {
      throw new AlreadyInstalledError({})
    }
  }

  // Connection
  let activeConnection: Connection | null = null

  function tabName(filePath: string) {
    return `[opencode] Edit: ${path.basename(filePath)} ⧉`
  }

  export async function status(): Promise<Record<string, Status>> {
    const discovered = await discoverLockFiles()
    const result: Record<string, Status> = {}

    for (const [key, lockFile] of discovered) {
      result[key] = {
        status: activeConnection?.key === key ? "connected" : "disconnected",
        name: lockFile.ideName,
        workspaceFolders: lockFile.workspaceFolders,
      }
    }

    return result
  }

  export async function connect(key: string): Promise<Record<string, Status>> {
    if (activeConnection) {
      await disconnect()
    }

    const instanceDirectory = Instance.directory
    const connection = await Connection.create(key)

    connection.onNotification = (method, params) => {
      handleNotification(method, params, instanceDirectory)
    }

    connection.onClose = () => {
      log.info("IDE connection closed callback", { key })
      if (activeConnection?.key === key) {
        activeConnection = null
      }
    }

    activeConnection = connection

    return status()
  }

  function handleNotification(method: string, params: unknown, instanceDirectory: string) {
    if (method === "selection_changed") {
      const parsed = Selection.safeParse(params)
      if (!parsed.success) {
        log.warn("failed to parse selection_changed params", { error: parsed.error })
        return
      }
      Instance.provide({
        directory: instanceDirectory,
        fn: () => {
          Bus.publish(Event.SelectionChanged, { selection: parsed.data })
        },
      })
    }
  }

  export async function disconnect(): Promise<Record<string, Status>> {
    if (!activeConnection) {
      return status()
    }

    await activeConnection.close()
    activeConnection = null

    return status()
  }

  export function active(): Connection | null {
    return activeConnection
  }

  export async function openDiff(filePath: string, newContents: string): Promise<Permission.Response> {
    if (!activeConnection) {
      throw new Error("No IDE connected")
    }
    const name = tabName(filePath)
    log.info("openDiff", { tabName: name })
    const result = await activeConnection.request<{ content: Array<{ type: string; text: string }> }>("openDiff", {
      old_file_path: filePath,
      new_file_path: filePath,
      new_file_contents: newContents,
      tab_name: name,
    })
    log.info("openDiff result", { text: result.content?.[0]?.text })
    const text = result.content?.[0]?.text
    if (text === "FILE_SAVED") return "once"
    if (text === "DIFF_REJECTED") return "reject"
    throw new Error(`Unexpected openDiff result: ${text}`)
  }

  export async function closeTab(filePath: string): Promise<void> {
    if (!activeConnection) return
    await activeConnection.request("close_tab", { tab_name: tabName(filePath) })
  }
}
