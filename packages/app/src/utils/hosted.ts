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
 *
 * SECURITY WARNING: This function exists ONLY for display purposes (e.g., showing
 * "Could not connect to X" in welcome-screen.tsx). The ?url= parameter must NEVER
 * be used to determine actual server connections due to CVE-2026-22813 (XSS vulnerability).
 * Server URL is determined exclusively by app.tsx defaultServerUrl logic.
 */
export function hasUrlQueryParam(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(document.location.search).has("url")
}

/**
 * Gets the ?url= query parameter value if present.
 *
 * SECURITY WARNING: This function exists ONLY for display purposes (e.g., showing
 * error messages with the attempted URL). The returned value must NEVER be used
 * for actual server connections due to CVE-2026-22813 (XSS vulnerability).
 * Server URL is determined exclusively by app.tsx defaultServerUrl logic.
 */
export function getUrlQueryParam(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(document.location.search).get("url")
}
