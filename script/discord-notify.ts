#!/usr/bin/env bun

/**
 * Discord Release Notes Notifier
 *
 * Posts release notes to a Discord forum thread as plain markdown.
 * Uses Discord REST API directly (no library dependencies).
 *
 * Changelog format from publish.ts:
 *   - Bullet point changes
 *   - More changes
 *
 *   **Thank you to N community contributors:**
 *   - @user: commit message
 *
 * Discord priority: Changelog > Thank Yous (truncated first when exceeding limit)
 */

const DISCORD_API = "https://discord.com/api/v10"
const MAX_CONTENT_LENGTH = 2000

async function postToDiscord(threadId: string, token: string, content: string): Promise<void> {
  console.log("Request body:", JSON.stringify({ content }, null, 2).slice(0, 500) + "...")

  const response = await fetch(`${DISCORD_API}/channels/${threadId}/messages`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Discord API error (${response.status}): ${error}`)
  }

  console.log("Successfully posted release notes to Discord")
}

/**
 * Extract the changelog portion (everything before the thank you section)
 */
function extractChangelogSection(changelog: string): string {
  const thankYouIndex = changelog.indexOf("**Thank you to")
  if (thankYouIndex > 0) {
    return changelog.slice(0, thankYouIndex).trim()
  }
  return changelog.trim()
}

/**
 * Extract the contributor thank you section
 */
function extractContributorSection(changelog: string): string | null {
  const thankYouMatch = changelog.match(/\*\*Thank you to \d+ community contributors?:\*\*[\s\S]*$/)
  return thankYouMatch ? thankYouMatch[0].trim() : null
}

/**
 * Truncate text at the last newline before maxLength
 */
function truncateAtNewline(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  const truncated = text.slice(0, maxLength)
  const lastNewline = truncated.lastIndexOf("\n")

  // Use the newline if it's in a reasonable position (>50% of max)
  if (lastNewline > maxLength * 0.5) {
    return truncated.slice(0, lastNewline)
  }

  return truncated
}

/**
 * Build Discord content with smart truncation
 * Priority: Header > Changelog > Footer > Thank Yous (truncated first)
 */
function formatDiscordContent(
  changelog: string | undefined,
  version: string,
  releaseUrl: string,
  npmUrl: string,
): string {
  const header = `**shuvcode ${version}** has been released!\n\n`
  const footer = `\n\n[GitHub Release](<${releaseUrl}>) | [npm](<${npmUrl}>)`
  const truncationNote = "\n\n*...see GitHub for full details.*"

  // If no changelog, just return header + footer
  if (!changelog?.trim()) {
    return header.trim() + footer
  }

  // Fixed overhead
  const fixedOverhead = header.length + footer.length

  // Extract sections
  const changelogPart = extractChangelogSection(changelog)
  const thankYouPart = extractContributorSection(changelog)

  // Calculate available space for content
  const availableForContent = MAX_CONTENT_LENGTH - fixedOverhead

  // Build full content to check length
  const fullContent = thankYouPart ? `${changelogPart}\n\n${thankYouPart}` : changelogPart

  // Case 1: Everything fits
  if (fullContent.length <= availableForContent) {
    return header + fullContent + footer
  }

  // Case 2: Changelog fits, but not with thank yous
  const changelogWithNote = changelogPart + truncationNote
  if (changelogWithNote.length <= availableForContent) {
    return header + changelogPart + truncationNote + footer
  }

  // Case 3: Changelog itself needs truncation
  const maxChangelogLength = availableForContent - truncationNote.length
  const truncatedChangelog = truncateAtNewline(changelogPart, maxChangelogLength)

  return header + truncatedChangelog + truncationNote + footer
}

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN
  const threadId = process.env.DISCORD_THREAD_ID
  const version = process.env.RELEASE_VERSION
  const changelog = process.env.RELEASE_CHANGELOG

  if (!token) {
    console.error("Error: DISCORD_TOKEN environment variable is required")
    process.exit(1)
  }

  if (!threadId) {
    console.error("Error: DISCORD_THREAD_ID environment variable is required")
    process.exit(1)
  }

  if (!version) {
    console.error("Error: RELEASE_VERSION environment variable is required")
    process.exit(1)
  }

  const cleanVersion = version.startsWith("v") ? version : `v${version}`
  const releaseUrl = `https://github.com/Latitudes-Dev/shuvcode/releases/tag/${cleanVersion}`
  const npmUrl = `https://www.npmjs.com/package/shuvcode/v/${cleanVersion.slice(1)}`

  // Build content with changelog prioritized over thank yous
  const content = formatDiscordContent(changelog, cleanVersion, releaseUrl, npmUrl)

  console.log(`Posting release notes for ${cleanVersion} to Discord...`)
  console.log(`Content length: ${content.length} characters`)
  console.log("Content preview:")
  console.log("---")
  console.log(content.slice(0, 500) + (content.length > 500 ? "..." : ""))
  console.log("---")

  await postToDiscord(threadId, token, content)
}

main().catch((error) => {
  console.error("Failed to post to Discord:", error.message)
  process.exit(1)
})
