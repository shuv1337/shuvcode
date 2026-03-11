import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { base64Encode, checksum } from "@opencode-ai/util/encode"

export const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
export const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

export const serverUrl = `http://${serverHost}:${serverPort}`
export const serverName = `${serverHost}:${serverPort}`

const localHosts = ["127.0.0.1", "localhost"]

const serverLabels = (() => {
  const url = new URL(serverUrl)
  if (!localHosts.includes(url.hostname)) return [serverName]
  return localHosts.map((host) => `${host}:${url.port}`)
})()

export const serverNames = [...new Set(serverLabels)]

export const serverUrls = serverNames.map((name) => `http://${name}`)

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const serverNamePattern = new RegExp(`(?:${serverNames.map(escape).join("|")})`)

export const modKey = process.platform === "darwin" ? "Meta" : "Control"
export const terminalToggleKey = "Control+Backquote"

export function createSdk(directory?: string) {
  return createOpencodeClient({ baseUrl: serverUrl, directory, throwOnError: true })
}

export async function resolveDirectory(directory: string) {
  return createSdk(directory)
    .path.get()
    .then((x) => x.data?.directory ?? directory)
}

export async function getWorktree() {
  const sdk = createSdk()
  const result = await sdk.path.get()
  const data = result.data
  if (!data?.worktree) throw new Error(`Failed to resolve a worktree from ${serverUrl}/path`)
  return data.worktree
}

export function dirSlug(directory: string) {
  return base64Encode(directory)
}

export function dirPath(directory: string) {
  return `/${dirSlug(directory)}`
}

export function sessionPath(directory: string, sessionID?: string) {
  return `${dirPath(directory)}/session${sessionID ? `/${sessionID}` : ""}`
}

/**
 * Selector for app loading states that should disappear before tests run.
 * Matches: "Connecting to server...", any error messages, or loading spinners.
 */
export const loadingSelector = 'text="Connecting to server...", text="Could not connect"'

/**
 * Wait for the app to be ready - checks that loading states are gone
 * and basic app structure is visible.
 */
export async function waitForAppReady(page: import("@playwright/test").Page, timeout = 30000) {
  await page.waitForLoadState("domcontentloaded")

  const readyChecks = [
    page.locator('[data-component="prompt-input"]').first(),
    page.getByRole("button", { name: "Add project" }).first(),
    page.getByRole("button", { name: serverName }).first(),
  ]

  try {
    await Promise.any(readyChecks.map((locator) => locator.waitFor({ state: "visible", timeout })))
  } catch {
    throw new Error("Timed out waiting for app to be ready")
  }
}

export function workspacePersistKey(directory: string, key: string) {
  const head = (directory.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(directory) ?? "0"
  return `opencode.workspace.${head}.${sum}.dat:workspace:${key}`
}
