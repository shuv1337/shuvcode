import { Config } from "../config/config"

export interface RegistrySource {
  id: string
  type: "github" | "clawdhub" | "url"
  url: string
  enabled: boolean
  globs: string[]
}

export interface IndexedSkill {
  name: string
  description: string
  tags: string[]
  license: string
  metadata: Record<string, any>
  registry: string
  entryPath: string
  sourceUrl: string
  version: string
  installedVersion?: string
  installedAt?: number
}

export namespace SkillRegistry {
  const DEFAULT_REGISTRIES: RegistrySource[] = [
    {
      id: "awesome-claude-skills",
      type: "github",
      url: "https://github.com/ComposioHQ/awesome-claude-skills",
      enabled: true,
      globs: ["*/SKILL.md", "skills/**/SKILL.md"],
    },
    {
      id: "clawdhub",
      type: "clawdhub",
      url: "https://clawdhub.com",
      enabled: false,
      globs: [],
    },
  ]

  export async function getRegistries(): Promise<RegistrySource[]> {
    const config = await Config.get()
    const userRegistries = config.experimental?.skills?.registries ?? []

    const registryMap = new Map<string, RegistrySource>()

    for (const registry of DEFAULT_REGISTRIES) {
      registryMap.set(registry.id, registry)
    }

    for (const registry of userRegistries) {
      const existing = registryMap.get(registry.id)
      if (existing) {
        registryMap.set(registry.id, {
          ...existing,
          url: registry.url ?? existing.url,
          enabled: registry.enabled ?? existing.enabled,
          globs: registry.globs ?? existing.globs,
        })
      } else {
        registryMap.set(registry.id, {
          id: registry.id,
          type: registry.type,
          url: registry.url,
          enabled: registry.enabled ?? true,
          globs: registry.globs ?? ["*/SKILL.md", "skills/**/SKILL.md"],
        })
      }
    }

    return Array.from(registryMap.values())
  }
}
