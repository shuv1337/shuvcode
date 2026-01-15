import fs from "fs/promises"
import path from "path"
import fuzzysort from "fuzzysort"
import { z } from "zod"
import { Global } from "../global"
import { SkillRegistry } from "./registry"
import type { IndexedSkill, RegistrySource } from "./registry"
import * as Fetchers from "./fetchers"

export { Skill } from "./skill"

const IndexedSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  license: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  registry: z.string(),
  entryPath: z.string(),
  sourceUrl: z.string(),
  version: z.string(),
  installedVersion: z.string().optional(),
  installedAt: z.number().optional(),
})

const IndexCacheSchema = z.array(IndexedSkillSchema)

export const SKILL_CACHE_PATH = path.join(Global.Path.cache, "skills", "index.json")
export const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24 hours

export class IndexManager {
  static async isCacheValid(): Promise<boolean> {
    try {
      const stat = await fs.stat(SKILL_CACHE_PATH)
      return Date.now() - stat.mtimeMs < CACHE_TTL_MS
    } catch {
      return false
    }
  }

  static async load(): Promise<IndexedSkill[] | null> {
    if (!(await this.isCacheValid())) return null
    try {
      const content = await Bun.file(SKILL_CACHE_PATH).text()
      const parsed = IndexCacheSchema.safeParse(JSON.parse(content))
      if (!parsed.success) {
        await fs.rm(SKILL_CACHE_PATH, { force: true })
        return null
      }
      return parsed.data
    } catch {
      await fs.rm(SKILL_CACHE_PATH, { force: true })
      return null
    }
  }

  static async save(skills: IndexedSkill[]): Promise<void> {
    await fs.mkdir(path.dirname(SKILL_CACHE_PATH), { recursive: true })
    await Bun.write(SKILL_CACHE_PATH, JSON.stringify(skills, null, 2))
  }

  static async build(): Promise<IndexedSkill[]> {
    const registries = await SkillRegistry.getRegistries()
    const enabled = registries.filter((registry: RegistrySource) => registry.enabled)
    const allSkills: IndexedSkill[] = []

    for (const registry of enabled) {
      try {
        let skills: IndexedSkill[]
        switch (registry.type) {
          case "github":
            skills = await Fetchers.github.fetchSkills(registry)
            break
          case "clawdhub":
            skills = await Fetchers.clawdhub.fetchSkills(registry)
            break
          case "url":
            skills = await Fetchers.url.fetchSkills(registry)
            break
          default:
            continue
        }
        allSkills.push(...skills)
      } catch (error) {
        console.error(`Failed to fetch registry ${registry.id}:`, error)
      }
    }

    await this.save(allSkills)
    return allSkills
  }

  static async get(): Promise<IndexedSkill[]> {
    let skills = await this.load()
    if (!skills) {
      skills = await this.build()
    }
    return skills
  }

  static async search(
    query: string,
    options?: {
      skills?: IndexedSkill[]
      limit?: number
    },
  ): Promise<IndexedSkill[]> {
    const skills = options?.skills ?? (await this.get())
    const trimmed = query.trim()
    if (!trimmed) return skills

    const searchable = skills.map((skill) => ({
      skill,
      name: skill.name,
      description: skill.description,
      tagsText: skill.tags.join(" "),
    }))

    const matches = fuzzysort.go(trimmed, searchable, {
      keys: ["name", "description", "tagsText"],
      limit: options?.limit ?? 50,
    })

    return matches.map((match) => match.obj.skill)
  }
}
