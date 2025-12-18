#!/usr/bin/env bun

/**
 * Discord Release Notes Notifier
 *
 * Posts release notes to a Discord forum thread as plain markdown.
 * Uses Discord REST API directly (no library dependencies).
 *
 * Environment variables:
 *   DISCORD_TOKEN      - Discord user token (self-bot)
 *   DISCORD_THREAD_ID  - Forum thread ID to post to
 *   RELEASE_VERSION    - Version being released (e.g., v1.0.166-11)
 *   RELEASE_CHANGELOG  - Changelog content
 */

const DISCORD_API = "https://discord.com/api/v10"
const MAX_CONTENT_LENGTH = 2000 // Discord message content limit

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

function truncateChangelog(changelog: string, maxLength: number): string {
  if (changelog.length <= maxLength) return changelog

  // Find a good breaking point (end of a line)
  const truncated = changelog.slice(0, maxLength - 50)
  const lastNewline = truncated.lastIndexOf("\n")
  const cutoff = lastNewline > 0 ? lastNewline : maxLength - 50

  return changelog.slice(0, cutoff) + "\n\n*...and more changes. See GitHub for full changelog.*"
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

  // Build plain markdown content
  let content = `**shuvcode ${cleanVersion}** has been released!\n\n`

  if (changelog?.trim()) {
    content += changelog.trim() + "\n\n"
  }

  content += `[GitHub Release](${releaseUrl}) | [npm](${npmUrl})`

  // Truncate if too long for Discord
  content = truncateChangelog(content, MAX_CONTENT_LENGTH)

  console.log(`Posting release notes for ${cleanVersion} to Discord...`)
  console.log(`Content length: ${content.length} characters`)

  await postToDiscord(threadId, token, content)
}

main().catch((error) => {
  console.error("Failed to post to Discord:", error.message)
  process.exit(1)
})
