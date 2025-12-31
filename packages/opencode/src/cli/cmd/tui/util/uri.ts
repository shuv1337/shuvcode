/**
 * Parse text/uri-list format or file:// URIs into filesystem paths.
 * Handles Linux, macOS, and Windows path formats.
 */
export function parseUriList(text: string): string[] {
  return text
    .split(/[\r\n]+/)  // Handle both \n and \r\n line endings
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))  // Skip comments per RFC 2483
    .map((line) => line.replace(/^["']+|["']+$/g, ""))  // Strip both quote types
    .map((line) => {
      // Skip non-file:// URIs
      if (line.includes("://") && !line.startsWith("file://")) return ""
      // Strip file:// prefix, including optional localhost
      const url = line.replace(/^file:\/\/(localhost)?/, "")
      // Handle Windows drive letters: /C:/path -> C:/path
      if (url.match(/^\/[A-Za-z]:\//)) return url.slice(1)
      return url
    })
    .map((line) => decodeURIComponent(line))
    .filter(Boolean);  // Remove empty strings
}
