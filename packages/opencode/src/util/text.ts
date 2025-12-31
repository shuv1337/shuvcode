export namespace Text {
  /**
   * Normalize line endings from CRLF to LF
   */
  export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, "\n")
  }

  /**
   * Find the first line number (1-indexed) where original and modified differ.
   * Returns 1 if no differences found or if modified has new content.
   */
  export function getFirstDifferingLine(original: string, modified: string): number {
    const originalLines = original.split("\n")
    const modifiedLines = modified.split("\n")
    for (let i = 0; i < modifiedLines.length; i++) {
      if (originalLines[i] !== modifiedLines[i]) return i + 1
    }
    return 1
  }

  /**
   * Check if two strings differ (after normalizing line endings)
   */
  export function hasChanges(a: string, b: string): boolean {
    return normalizeLineEndings(a) !== normalizeLineEndings(b)
  }
}
