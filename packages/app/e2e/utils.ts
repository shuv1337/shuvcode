import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/util/encode"

export const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "localhost"
export const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

export const serverUrl = `http://${serverHost}:${serverPort}`
export const serverName = `${serverHost}:${serverPort}`

export const modKey = process.platform === "darwin" ? "Meta" : "Control"
export const terminalToggleKey = "Control+Backquote"

export const promptSelector = '[data-component="prompt-input"]'
export const terminalSelector = '[data-component="terminal"]'

export function createSdk(directory?: string) {
  return createOpencodeClient({ baseUrl: serverUrl, directory, throwOnError: true })
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
  // First, wait for the page to have some content
  await page.waitForLoadState("domcontentloaded")

  // Then wait for either the app to be ready (buttons visible) or stay in a loading/error state
  // If we timeout waiting for buttons, the test will fail with a clear error
  await page.locator('[role="button"], [data-component="prompt-input"]').first().waitFor({ state: "visible", timeout })
}
