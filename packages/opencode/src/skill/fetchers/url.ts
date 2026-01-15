import { z } from "zod"
import { Installation } from "../../installation"
import { Log } from "../../util/log"
import type { IndexedSkill, RegistrySource } from "../registry"

const log = Log.create({ service: "skill.registry.url" })

const SkillIndexEntry = z.object({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  entryPath: z.string().optional(),
  sourceUrl: z.string().optional(),
  version: z.string().optional(),
})

const RegistryIndex = z.union([z.array(SkillIndexEntry), z.object({ skills: z.array(SkillIndexEntry) })])

type SkillIndexEntry = z.infer<typeof SkillIndexEntry>

type RegistryIndex = { type: "array"; skills: SkillIndexEntry[] } | { type: "object"; skills: SkillIndexEntry[] }

export async function fetchSkills(registry: RegistrySource): Promise<IndexedSkill[]> {
  return fetchUrlRegistry(registry)
}

export async function fetchUrlRegistry(registry: RegistrySource): Promise<IndexedSkill[]> {
  const response = await fetch(registry.url, {
    headers: {
      "User-Agent": Installation.USER_AGENT,
    },
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch registry ${registry.id}: ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const parsed = RegistryIndex.safeParse(payload)
  if (!parsed.success) {
    log.warn("invalid registry index payload", {
      registry: registry.id,
      url: registry.url,
      error: parsed.error,
    })
    return []
  }

  const normalized = normalizeRegistryIndex(parsed.data)
  return normalized.skills.map((entry) => toIndexedSkill(entry, registry))
}

function normalizeRegistryIndex(data: z.infer<typeof RegistryIndex>): RegistryIndex {
  if (Array.isArray(data)) {
    return { type: "array", skills: data }
  }
  return { type: "object", skills: data.skills }
}

function toIndexedSkill(entry: SkillIndexEntry, registry: RegistrySource): IndexedSkill {
  return {
    name: entry.name,
    description: entry.description,
    tags: entry.tags ?? [],
    license: entry.license ?? "unknown",
    metadata: entry.metadata ?? {},
    registry: registry.id,
    entryPath: entry.entryPath ?? entry.name,
    sourceUrl: entry.sourceUrl ?? registry.url,
    version: entry.version ?? "0.0.0",
  }
}
