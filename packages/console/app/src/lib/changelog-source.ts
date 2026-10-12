import { query } from "@solidjs/router"
import { waitUntil } from "@opencode/console-resource"
import { parseChangelog, renderEntry, type ChangelogEntry } from "~/lib/changelog-markdown"

export const CHANGELOG_FILE_URL = "https://github.com/anomalyco/opencode/blob/dev/CHANGELOG.md"
const SOURCE_URL = "https://raw.githubusercontent.com/anomalyco/opencode/dev/CHANGELOG.md"

// Fresh for five minutes, then served stale for up to a day while requests revalidate it in the background. A failed
// revalidation keeps serving the stale copy, so a GitHub outage only shows an error once the day-old copy is evicted.
const CACHE_KEY = "https://opencode.ai/changelog/source.md"
const FRESH_SECONDS = 300
const STALE_SECONDS = 86400
const FETCHED_AT = "x-opencode-changelog-fetched-at"

export type ChangelogPage = { ok: boolean; entries: ChangelogEntry[] }

function defaultCache() {
  if (typeof caches === "undefined" || !("default" in caches)) return
  return (caches as CacheStorage & { default: Cache }).default
}

async function refresh(cache: Cache | undefined) {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "OpenCode-Console" },
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined)
  if (!response?.ok) return
  const markdown = await response.text()
  await cache?.put(
    CACHE_KEY,
    new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": `public, s-maxage=${FRESH_SECONDS + STALE_SECONDS}`,
        [FETCHED_AT]: String(Date.now()),
      },
    }),
  )
  return markdown
}

async function loadSource() {
  const cache = defaultCache()
  const cached = await cache?.match(CACHE_KEY)
  if (!cached) return refresh(cache)
  if (Date.now() - Number(cached.headers.get(FETCHED_AT)) > FRESH_SECONDS * 1000) void waitUntil(refresh(cache))
  return cached.text()
}

export const changelogPage = query(async (): Promise<ChangelogPage> => {
  "use server"
  const markdown = await loadSource().catch(() => undefined)
  if (markdown === undefined) return { ok: false, entries: [] }
  return { ok: true, entries: parseChangelog(markdown).map(renderEntry) }
}, "changelog-page")
