import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { spawn } from "bun"
import z from "zod"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { NamedError } from "@opencode-ai/util/error"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Connection, discoverLockFiles } from "./connection"
import { Permission } from "../permission"

const GITHUB_REPO = "Latitudes-Dev/shuvcode"
const EXTENSION_ID = "latitudes-dev.shuvcode"

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
    Installed: BusEvent.define(
      "ide.installed",
      z.object({
        ide: z.string(),
      }),
    ),
    SelectionChanged: BusEvent.define(
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
    return process.env["SHUVCODE_CALLER"] === "vscode" || process.env["SHUVCODE_CALLER"] === "vscode-insiders"
  }

  export async function install(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
    const cmd = SUPPORTED_IDES.find((i) => i.name === ide)?.cmd
    if (!cmd) throw new Error(`Unknown IDE: ${ide}`)

    // First check if the extension is already installed
    const checkInstalled = spawn([cmd, "--list-extensions"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await checkInstalled.exited
    const installedExtensions = await new Response(checkInstalled.stdout).text()
    if (installedExtensions.toLowerCase().includes(EXTENSION_ID.toLowerCase())) {
      throw new AlreadyInstalledError({})
    }

    // Download and install VSIX from GitHub Releases
    log.info("fetching latest release from GitHub", { repo: GITHUB_REPO })

    // Get the latest vscode-v* release
    const releasesUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases`
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "shuvcode-cli",
    }
    if (process.env["GH_TOKEN"]) {
      headers["Authorization"] = `token ${process.env["GH_TOKEN"]}`
    }

    const releasesResponse = await fetch(releasesUrl, { headers })
    if (!releasesResponse.ok) {
      throw new InstallFailedError({
        stderr: `Failed to fetch releases from GitHub: ${releasesResponse.status} ${releasesResponse.statusText}`,
      })
    }

    const releases = (await releasesResponse.json()) as Array<{
      tag_name: string
      assets: Array<{ name: string; browser_download_url: string }>
    }>

    // Find the latest vscode-v* release
    const vscodeRelease = releases.find((r) => r.tag_name.startsWith("vscode-v"))
    if (!vscodeRelease) {
      throw new InstallFailedError({
        stderr: "No vscode-v* release found in GitHub Releases",
      })
    }

    // Find the VSIX asset
    const vsixAsset = vscodeRelease.assets.find((a) => a.name.endsWith(".vsix"))
    if (!vsixAsset) {
      throw new InstallFailedError({
        stderr: `No .vsix asset found in release ${vscodeRelease.tag_name}`,
      })
    }

    log.info("downloading VSIX", { url: vsixAsset.browser_download_url, tag: vscodeRelease.tag_name })

    // Download the VSIX to a temp directory
    const tmpDir = path.join(os.tmpdir(), "shuvcode-install")
    await fs.mkdir(tmpDir, { recursive: true })
    const vsixPath = path.join(tmpDir, vsixAsset.name)

    const vsixResponse = await fetch(vsixAsset.browser_download_url, { headers })
    if (!vsixResponse.ok) {
      throw new InstallFailedError({
        stderr: `Failed to download VSIX: ${vsixResponse.status} ${vsixResponse.statusText}`,
      })
    }

    const vsixBuffer = await vsixResponse.arrayBuffer()
    await fs.writeFile(vsixPath, Buffer.from(vsixBuffer))

    log.info("installing VSIX", { path: vsixPath })

    // Install the VSIX
    const p = spawn([cmd, "--install-extension", vsixPath], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await p.exited
    const stdout = await new Response(p.stdout).text()
    const stderr = await new Response(p.stderr).text()

    // Clean up
    try {
      await fs.unlink(vsixPath)
    } catch {
      // Ignore cleanup errors
    }

    log.info("installed", {
      ide,
      stdout,
      stderr,
    })

    if (p.exitCode !== 0) {
      throw new InstallFailedError({ stderr })
    }
  }

  // Connection
  let activeConnection: Connection | null = null

  function diffTabName(filePath: string) {
    // TODO this is used for a string match in claudecode.nvim that we could
    // change if we incorporate a dedicated plugin
    // (must start with ✻ and end with ⧉))
    return `✻ [shuvcode] Edit: ${path.basename(filePath)} ⧉`
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

  export async function connect(key: string): Promise<void> {
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

  export async function disconnect(): Promise<void> {
    if (activeConnection) {
      log.info("IDE disconnecting", { key: activeConnection.key })
      await activeConnection.close()
      activeConnection = null
    }
  }

  export function active(): Connection | null {
    return activeConnection
  }

  const DiffResponse = {
    FILE_SAVED: "once",
    DIFF_REJECTED: "reject",
  } as const satisfies Record<string, Permission.Response>

  export async function openDiff(filePath: string, newContents: string): Promise<Permission.Response> {
    const connection = active()
    if (!connection) {
      throw new Error("No IDE connected")
    }
    const name = diffTabName(filePath)
    log.info("openDiff", { tabName: name })
    const result = await connection.request<{ content: Array<{ type: string; text: string }> }>("openDiff", {
      old_file_path: filePath,
      new_file_path: filePath,
      new_file_contents: newContents,
      tab_name: name,
    })
    log.info("openDiff result", { text: result.content?.[0]?.text })
    const text = result.content?.[0]?.text as keyof typeof DiffResponse | undefined
    if (text && text in DiffResponse) return DiffResponse[text]
    throw new Error(`Unexpected openDiff result: ${text}`)
  }

  async function closeTab(tabName: string): Promise<void> {
    const connection = active()
    if (!connection) {
      throw new Error("No IDE connected")
    }
    await connection.request("close_tab", { tab_name: tabName })
  }

  export async function closeDiff(filePath: string): Promise<void> {
    await closeTab(diffTabName(filePath))
  }
}
