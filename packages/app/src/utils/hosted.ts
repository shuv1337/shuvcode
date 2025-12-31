/**
 * Checks if the app is running in a hosted environment (app.shuv.ai or app.opencode.ai).
 * In hosted environments, users need to configure their server connection.
 */
export function isHostedEnvironment(): boolean {
  if (typeof window === "undefined") return false
  return location.hostname.includes("opencode.ai") || location.hostname.includes("shuv.ai")
}

/**
 * Checks if a ?url= query parameter was provided in the URL.
 * This indicates the user is trying to connect to a specific server.
 */
export function hasUrlQueryParam(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(document.location.search).has("url")
}

/**
 * Gets the ?url= query parameter value if present.
 */
export function getUrlQueryParam(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(document.location.search).get("url")
}
