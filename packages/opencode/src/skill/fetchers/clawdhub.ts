import { Log } from "../../util/log"
import type { IndexedSkill, RegistrySource } from "../registry"

const log = Log.create({ service: "skill.registry.clawdhub" })

export async function fetchSkills(registry: RegistrySource): Promise<IndexedSkill[]> {
  return fetchClawdHubRegistry(registry)
}

export async function fetchClawdHubRegistry(registry: RegistrySource): Promise<IndexedSkill[]> {
  log.warn("clawdhub registry fetcher is not implemented", {
    registry: registry.id,
    url: registry.url,
  })
  return []
}
