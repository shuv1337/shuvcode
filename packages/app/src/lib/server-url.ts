/**
 * Server URL management utilities for custom server URL configuration.
 *
 * This module provides shared logic for:
 * - URL validation
 * - Mixed content risk detection
 * - URL history management
 * - Stored URL get/set/clear
 */

// Constants
export const SERVER_URL_KEY = "opencode:server-url"
export const SERVER_URL_HISTORY_KEY = "opencode:server-url-history"
export const MAX_HISTORY = 5

/**
 * Validate that a URL is a valid server URL.
 * Only HTTP and HTTPS protocols are allowed.
 */
export function isValidServerUrl(url: string): boolean {
  if (!url || !url.trim()) return false
  try {
    const parsed = new URL(url)
    return ["http:", "https:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Check if setting this URL would cause mixed content issues.
 *
 * Returns true if:
 * - Current page is HTTPS, AND
 * - Target URL is HTTP, AND
 * - Target is NOT localhost/127.0.0.1 (browsers allow this exception)
 */
export function hasMixedContentRisk(targetUrl: string): boolean {
  if (typeof location === "undefined") return false
  if (location.protocol !== "https:") return false

  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol !== "http:") return false

    // Localhost is allowed even from HTTPS (secure context exception)
    const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    return !isLocalhost
  } catch {
    return false
  }
}

/**
 * Normalize a URL for comparison and deduplication.
 * Lowercases and strips trailing slashes.
 */
export function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "")
}

/**
 * Get the list of recent server URLs from localStorage.
 */
export function getServerUrlHistory(): string[] {
  try {
    const stored = localStorage.getItem(SERVER_URL_HISTORY_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    // Filter to only valid URLs
    return parsed.filter((url): url is string => typeof url === "string" && isValidServerUrl(url))
  } catch {
    return []
  }
}

/**
 * Add a URL to the history list.
 * Deduplicates by normalized URL and keeps only the most recent MAX_HISTORY entries.
 */
export function addToServerUrlHistory(url: string): void {
  if (!isValidServerUrl(url)) return

  const history = getServerUrlHistory()
  const normalized = normalizeUrl(url)

  // Remove any existing entry with the same normalized URL
  const filtered = history.filter((u) => normalizeUrl(u) !== normalized)

  // Add the new URL at the beginning
  const updated = [url, ...filtered].slice(0, MAX_HISTORY)

  try {
    localStorage.setItem(SERVER_URL_HISTORY_KEY, JSON.stringify(updated))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear all URL history.
 */
export function clearServerUrlHistory(): void {
  try {
    localStorage.removeItem(SERVER_URL_HISTORY_KEY)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get the currently stored server URL override.
 */
export function getStoredServerUrl(): string | null {
  try {
    const stored = localStorage.getItem(SERVER_URL_KEY)
    if (!stored) return null
    // Validate before returning
    if (!isValidServerUrl(stored)) return null
    return stored
  } catch {
    return null
  }
}

/**
 * Set a custom server URL override.
 * The URL must be valid or it will not be stored.
 */
export function setStoredServerUrl(url: string): void {
  if (!isValidServerUrl(url)) return
  try {
    localStorage.setItem(SERVER_URL_KEY, url)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear the stored server URL override.
 */
export function clearStoredServerUrl(): void {
  try {
    localStorage.removeItem(SERVER_URL_KEY)
  } catch {
    // Ignore storage errors
  }
}
