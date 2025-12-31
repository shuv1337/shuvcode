/**
 * Checks if the given origin is allowed by the CORS policy.
 * @param origin - The origin header value from the request
 * @returns The origin string if allowed, undefined otherwise
 */
export function isOriginAllowed(origin: string | undefined): string | undefined {
  if (!origin) return undefined

  // localhost (http only, any port)
  if (origin.startsWith("http://localhost:")) return origin
  if (origin.startsWith("http://127.0.0.1:")) return origin

  // Tauri desktop origins
  if (origin === "tauri://localhost" || origin === "http://tauri.localhost") return origin

  // *.opencode.ai (https only)
  if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(origin)) {
    return origin
  }

  // *.shuv.ai (https only) - fork's hosted domain
  if (/^https:\/\/([a-z0-9-]+\.)*shuv\.ai$/.test(origin)) {
    return origin
  }

  return undefined
}
