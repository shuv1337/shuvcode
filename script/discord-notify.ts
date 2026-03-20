#!/usr/bin/env bun

/**
 * Discord notifier.
 *
 * Supports posting to any existing Discord text channel or thread by ID.
 * Auth mode is auto-detected so the same script can work with either a raw
 * user token, a standard bot token stored without the `Bot ` prefix, or a
 * bearer token.
 *
 * Inputs:
 * - DISCORD_TOKEN               required
 * - DISCORD_CHANNEL_ID          preferred target ID
 * - DISCORD_THREAD_ID           legacy fallback target ID
 * - DISCORD_MESSAGE             optional direct message body
 * - RELEASE_VERSION             required when DISCORD_MESSAGE is not provided
 * - RELEASE_CHANGELOG           optional changelog used when formatting release message
 */

const api = "https://discord.com/api/v10"
const max = 2000
const agent =
  process.env.DISCORD_USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"

function trim(text: string) {
  return text.length <= max ? text : text.slice(0, max)
}

function cut(text: string, limit: number) {
  if (text.length <= limit) return text
  const slice = text.slice(0, limit)
  const idx = slice.lastIndexOf("\n")
  if (idx > limit * 0.5) return slice.slice(0, idx)
  return slice
}

function changelogPart(text: string) {
  const idx = text.indexOf("**Thank you to")
  if (idx > 0) return text.slice(0, idx).trim()
  return text.trim()
}

function thanksPart(text: string) {
  const match = text.match(/\*\*Thank you to \d+ community contributors?:\*\*[\s\S]*$/)
  return match ? match[0].trim() : null
}

function releaseMsg(changelog: string | undefined, version: string, release: string, npm: string) {
  const head = `**shuvcode ${version}** has been released!\n\n`
  const tail = `\n\n[GitHub Release](<${release}>) | [npm](<${npm}>)`
  const note = "\n\n*...see GitHub for full details.*"
  if (!changelog?.trim()) return trim(head.trim() + tail)

  const body = changelogPart(changelog)
  const thanks = thanksPart(changelog)
  const full = thanks ? `${body}\n\n${thanks}` : body
  const room = max - head.length - tail.length

  if (full.length <= room) return head + full + tail
  if ((body + note).length <= room) return head + body + note + tail
  return head + cut(body, room - note.length) + note + tail
}

async function req(path: string, init: RequestInit, auth: string) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": agent,
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  return { res, text }
}

function auths(token: string) {
  if (token.startsWith("Bot ") || token.startsWith("Bearer ")) return [token]
  return [token, `Bot ${token}`, `Bearer ${token}`]
}

async function pick(token: string) {
  for (const auth of auths(token)) {
    const mode = auth.startsWith("Bot ") ? "bot" : auth.startsWith("Bearer ") ? "bearer" : "user"
    const out = await req("/users/@me", { method: "GET" }, auth)
    console.log(`Discord auth probe (${mode}) -> ${out.res.status}`)
    if (!out.res.ok) {
      console.log(out.text.slice(0, 300))
      continue
    }
    const info = JSON.parse(out.text) as { username?: string; discriminator?: string; id?: string; bot?: boolean }
    console.log(
      `Using Discord auth (${mode}) as ${info.username || "unknown"}${info.discriminator ? `#${info.discriminator}` : ""} (${info.id || "unknown"})`,
    )
    return auth
  }
  throw new Error("Could not authenticate with Discord using user, bot, or bearer token style")
}

async function inspect(id: string, auth: string) {
  const out = await req(`/channels/${id}`, { method: "GET" }, auth)
  if (!out.res.ok) throw new Error(`Discord channel lookup error (${out.res.status}): ${out.text}`)
  const info = JSON.parse(out.text) as { id: string; type?: number; name?: string; guild_id?: string; parent_id?: string }
  console.log(
    `Target channel ${info.id}: type=${info.type ?? "unknown"} name=${info.name || "(unnamed)"} guild=${info.guild_id || "n/a"} parent=${info.parent_id || "n/a"}`,
  )
}

async function post(id: string, auth: string, content: string) {
  const out = await req(
    `/channels/${id}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
    auth,
  )
  if (!out.res.ok) throw new Error(`Discord post error (${out.res.status}): ${out.text}`)
  console.log("Successfully posted to Discord")
}

async function main() {
  const token = process.env.DISCORD_TOKEN
  const id = process.env.DISCORD_CHANNEL_ID || process.env.DISCORD_THREAD_ID
  const msg = process.env.DISCORD_MESSAGE
  const version = process.env.RELEASE_VERSION
  const changelog = process.env.RELEASE_CHANGELOG

  if (!token) throw new Error("DISCORD_TOKEN environment variable is required")
  if (!id) throw new Error("DISCORD_CHANNEL_ID or DISCORD_THREAD_ID environment variable is required")

  const auth = await pick(token)
  await inspect(id, auth)

  const clean = version?.startsWith("v") ? version : version ? `v${version}` : undefined
  const content =
    msg ||
    (clean
      ? releaseMsg(
          changelog,
          clean,
          `https://github.com/Latitudes-Dev/shuvcode/releases/tag/${clean}`,
          `https://www.npmjs.com/package/shuvcode/v/${clean.slice(1)}`,
        )
      : undefined)

  if (!content) throw new Error("DISCORD_MESSAGE or RELEASE_VERSION environment variable is required")

  console.log(`Content length: ${content.length}`)
  console.log("Preview:")
  console.log("---")
  console.log(content.slice(0, 500) + (content.length > 500 ? "..." : ""))
  console.log("---")

  await post(id, auth, content)
}

main().catch((err) => {
  console.error("Failed to post to Discord:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
