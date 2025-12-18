#!/usr/bin/env bun

/**
 * Discord Release Notes Notifier
 *
 * Posts release notes to a Discord forum thread using a rich embed.
 * Uses Discord REST API directly (no library dependencies).
 *
 * Environment variables:
 *   DISCORD_TOKEN    - Discord user token (self-bot)
 *   DISCORD_THREAD_ID - Forum thread ID to post to
 *
 * Usage:
 *   ./script/discord-notify.ts <version> <changelog>
 *
 * Warning: Self-bots violate Discord ToS and may result in account termination.
 */

const DISCORD_API = "https://discord.com/api/v10"
const EMBED_COLOR = 0x5865F2 // Discord blurple

interface DiscordEmbed {
  title: string
  description: string
  color: number
  fields: Array<{ name: string; value: string; inline?: boolean }>
  timestamp: string
  footer: { text: string }
}

async function postToDiscord(threadId: string, token: string, embed: DiscordEmbed): Promise<void> {
  const response = await fetch(`${DISCORD_API}/channels/${threadId}/messages`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ embeds: [embed] }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Discord API error (${response.status}): ${error}`)
  }

  console.log("Successfully posted release notes to Discord")
}

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN
  const threadId = process.env.DISCORD_THREAD_ID

  if (!token) {
    console.error("Error: DISCORD_TOKEN environment variable is required")
    process.exit(1)
  }

  if (!threadId) {
    console.error("Error: DISCORD_THREAD_ID environment variable is required")
    process.exit(1)
  }

  const [version, changelog] = process.argv.slice(2)

  if (!version) {
    console.error("Error: Version argument is required")
    console.error("Usage: ./script/discord-notify.ts <version> [changelog]")
    process.exit(1)
  }

  const cleanVersion = version.startsWith("v") ? version : `v${version}`
  const description = changelog?.trim() || "No notable changes in this release."

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
  await postToDiscord(threadId, token, embed)
}

main().catch((error) => {
  console.error("Failed to post to Discord:", error.message)
  process.exit(1)
})
