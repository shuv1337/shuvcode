#!/usr/bin/env bun

/**
 * Discord Release Notes Notifier
 *
 * Posts release notes to a Discord forum thread using a rich embed.
 * Uses Discord REST API directly (no library dependencies).
 *
 * Environment variables:
 *   DISCORD_TOKEN      - Discord user token (self-bot)
 *   DISCORD_THREAD_ID  - Forum thread ID to post to
 *   RELEASE_VERSION    - Version being released (e.g., v1.0.166-11)
 *   RELEASE_CHANGELOG  - Changelog content
 *
 * Warning: Self-bots violate Discord ToS and may result in account termination.
 */

const DISCORD_API = "https://discord.com/api/v10"
const EMBED_COLOR = 0x5865f2 // Discord blurple
const MAX_DESCRIPTION_LENGTH = 4000 // Discord embed description limit is 4096

interface DiscordEmbed {
  title: string
  description: string
  color: number
  fields: Array<{ name: string; value: string; inline?: boolean }>
  timestamp: string
  footer: { text: string }
}

async function postToDiscord(threadId: string, token: string, content: string, embed: DiscordEmbed): Promise<void> {
  const body = { content, embeds: [embed] }
  console.log("Request body:", JSON.stringify(body, null, 2).slice(0, 500) + "...")

  const response = await fetch(`${DISCORD_API}/channels/${threadId}/messages`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
  let description = changelog?.trim() || "No notable changes in this release."

  // Truncate if too long for Discord embed
  description = truncateChangelog(description, MAX_DESCRIPTION_LENGTH)

  const embed: DiscordEmbed = {
    title: `shuvcode ${cleanVersion}`,
    description,
    color: EMBED_COLOR,
    fields: [
      {
        name: "GitHub Release",
        value: `[View Release](https://github.com/Latitudes-Dev/shuvcode/releases/tag/${cleanVersion})`,
        inline: true,
      },
      {
        name: "npm",
        value: `[shuvcode@${cleanVersion.slice(1)}](https://www.npmjs.com/package/shuvcode/v/${cleanVersion.slice(1)})`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "shuvcode release" },
  }

  console.log(`Posting release notes for ${cleanVersion} to Discord...`)
  console.log(`Changelog length: ${description.length} characters`)

  // Include a text content as well since some Discord configurations require it
  const content = `**${embed.title}** has been released!`
  await postToDiscord(threadId, token, content, embed)
}

main().catch((error) => {
  console.error("Failed to post to Discord:", error.message)
  process.exit(1)
})
