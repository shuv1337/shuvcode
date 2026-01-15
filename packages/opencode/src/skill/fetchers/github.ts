import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { Global } from "../../global"
import { Installation } from "../../installation"
import { Log } from "../../util/log"
import { ConfigMarkdown } from "../../config/markdown"
import type { IndexedSkill, RegistrySource } from "../registry"
import { exists } from "fs/promises"

const log = Log.create({ service: "skill.registry.github" })
const GITHUB_REPO_REGEX = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git|\/)?$/i

export interface GitHubRegistrySource {
  source: "tarball" | "git"
  archivePath?: string
  extractPath: string
  cachePath: string
}

interface CacheMetadata {
  fetchedAt: number
  url: string
  etag?: string
}

export async function fetchSkills(registry: RegistrySource): Promise<IndexedSkill[]> {
  const archive = await fetchGitHubRegistrySource(registry)
  return buildGitHubSkillIndex(registry, archive)
}

export async function fetchGitHubRegistryArchive(
  registry: RegistrySource,
  options?: { force?: boolean },
): Promise<GitHubRegistrySource> {
  const repo = parseGitHubRepo(registry.url)
  if (!repo) {
    throw new Error(`Unsupported GitHub URL: ${registry.url}`)
  }

  const cacheRoot = path.join(Global.Path.cache, "skills", "registries")
  const cacheKey = `${registry.id}-${hashValue(registry.url).slice(0, 8)}`
  const cachePath = path.join(cacheRoot, cacheKey)
  const archivePath = path.join(cachePath, "archive.tar.gz")
  const extractPath = path.join(cachePath, "extract")
  const metadataPath = path.join(cachePath, "meta.json")

  await fs.mkdir(cachePath, { recursive: true })

  const archiveExists = await exists(archivePath)
  const extractExists = await exists(extractPath)
  if (archiveExists && extractExists && !options?.force) {
    return { source: "tarball", archivePath, extractPath, cachePath }
  }

  const metadata = await Bun.file(metadataPath)
    .json()
    .catch(() => null as CacheMetadata | null)
  const headers: Record<string, string> = {
    "User-Agent": Installation.USER_AGENT,
    Accept: "application/vnd.github+json",
  }
  if (metadata?.etag) {
    headers["If-None-Match"] = metadata.etag
  }

  const tarballUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/tarball`
  log.info("fetching github skill registry", { registry: registry.id, url: tarballUrl })
  const response = await fetch(tarballUrl, {
    headers,
    signal: AbortSignal.timeout(20_000),
  })

  if (response.status === 304 && archiveExists && extractExists) {
    return { source: "tarball", archivePath, extractPath, cachePath }
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${registry.url}: ${response.status} ${response.statusText}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  await Bun.write(archivePath, buffer)

  await fs.rm(extractPath, { recursive: true, force: true })
  await fs.mkdir(extractPath, { recursive: true })

  const result = await $`tar -xzf ${archivePath} --strip-components=1 -C ${extractPath}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error("Failed to extract GitHub registry archive")
  }

  const metadataPayload: CacheMetadata = {
    fetchedAt: Date.now(),
    url: registry.url,
    etag: response.headers.get("etag") ?? undefined,
  }
  await Bun.write(metadataPath, JSON.stringify(metadataPayload, null, 2))

  return { source: "tarball", archivePath, extractPath, cachePath }
}

export async function fetchGitHubRegistrySource(
  registry: RegistrySource,
  options?: { force?: boolean; preferGit?: boolean },
): Promise<GitHubRegistrySource> {
  if (options?.preferGit && canUseGit()) {
    return fetchGitHubRegistryWithGit(registry, options)
  }

  try {
    return await fetchGitHubRegistryArchive(registry, options)
  } catch (error) {
    if (!canUseGit()) throw error
    log.warn("github tarball fetch failed; falling back to git", {
      registry: registry.id,
      error,
    })
    return fetchGitHubRegistryWithGit(registry, options)
  }
}

export async function fetchGitHubRegistryWithGit(
  registry: RegistrySource,
  options?: { force?: boolean },
): Promise<GitHubRegistrySource> {
  const repo = parseGitHubRepo(registry.url)
  if (!repo) {
    throw new Error(`Unsupported GitHub URL: ${registry.url}`)
  }
  if (!canUseGit()) {
    throw new Error("Git is not available for sparse checkout")
  }

  const cacheRoot = path.join(Global.Path.cache, "skills", "registries")
  const cacheKey = `${registry.id}-${hashValue(registry.url).slice(0, 8)}`
  const cachePath = path.join(cacheRoot, cacheKey)
  const extractPath = path.join(cachePath, "git")

  if (options?.force) {
    await fs.rm(extractPath, { recursive: true, force: true })
  }

  if (await exists(path.join(extractPath, ".git"))) {
    return { source: "git", extractPath, cachePath }
  }

  await fs.mkdir(extractPath, { recursive: true })
  const cloneUrl = `${normalizeRepoUrl(registry.url)}.git`
  const patterns = registry.globs.length ? registry.globs : ["SKILL.md"]

  await runGitCommand(["init"], extractPath)
  await runGitCommand(["remote", "add", "origin", cloneUrl], extractPath)
  await runGitCommand(["config", "core.sparseCheckout", "true"], extractPath)
  await runGitCommand(["sparse-checkout", "init", "--no-cone"], extractPath)
  await runGitCommand(["sparse-checkout", "set", "--no-cone", ...patterns], extractPath)
  await runGitCommand(["fetch", "--depth=1", "origin"], extractPath)
  await runGitCommand(["checkout", "-f", "FETCH_HEAD"], extractPath)

  return { source: "git", extractPath, cachePath }
}

export interface GitHubSkillEntry {
  entryPath: string
  absolutePath: string
  frontmatter: Record<string, any>
}

export async function scanGitHubRegistrySkills(
  registry: RegistrySource,
  archive: GitHubRegistrySource,
): Promise<GitHubSkillEntry[]> {
  const entries: GitHubSkillEntry[] = []
  const seen = new Set<string>()

  for (const pattern of registry.globs) {
    const glob = new Bun.Glob(pattern)
    for await (const match of glob.scan({
      cwd: archive.extractPath,
      absolute: true,
      onlyFiles: true,
      followSymlinks: true,
    })) {
      const entryPath = path.relative(archive.extractPath, match)
      if (seen.has(entryPath)) continue
      seen.add(entryPath)

      const md = await ConfigMarkdown.parse(match).catch((error) => {
        log.warn("failed to parse skill frontmatter", {
          registry: registry.id,
          path: match,
          error,
        })
        return null
      })
      if (!md || typeof md.data !== "object" || md.data === null) continue

      entries.push({
        entryPath,
        absolutePath: match,
        frontmatter: md.data as Record<string, any>,
      })
    }
  }

  return entries
}

export async function buildGitHubSkillIndex(
  registry: RegistrySource,
  archive: GitHubRegistrySource,
): Promise<IndexedSkill[]> {
  const entries = await scanGitHubRegistrySkills(registry, archive)
  const sourceRoot = normalizeRepoUrl(registry.url)
  const skills: IndexedSkill[] = []

  for (const entry of entries) {
    const parsed = parseSkillFrontmatter(entry.frontmatter, entry.entryPath, registry.id)
    if (!parsed) continue

    skills.push({
      name: parsed.name,
      description: parsed.description,
      tags: parsed.tags,
      license: parsed.license,
      metadata: parsed.metadata,
      registry: registry.id,
      entryPath: entry.entryPath,
      sourceUrl: `${sourceRoot}/blob/HEAD/${normalizePath(entry.entryPath)}`,
      version: parsed.version,
    })
  }

  return skills
}

function parseSkillFrontmatter(frontmatter: Record<string, any>, entryPath: string, registryID: string) {
  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : ""
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : ""

  if (!name || !description) {
    log.warn("missing required skill metadata", {
      registry: registryID,
      entryPath,
    })
    return null
  }

  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
    : []
  const license = typeof frontmatter.license === "string" ? frontmatter.license : "unknown"
  const version = typeof frontmatter.version === "string" ? frontmatter.version : "0.0.0"
  const {
    name: _name,
    description: _description,
    tags: _tags,
    license: _license,
    version: _version,
    ...metadata
  } = frontmatter

  return {
    name,
    description,
    tags,
    license,
    version,
    metadata,
  }
}

function normalizeRepoUrl(url: string) {
  return url.replace(/\.git$/i, "").replace(/\/$/, "")
}

function normalizePath(entryPath: string) {
  return entryPath.split(path.sep).join("/")
}

function canUseGit() {
  return Bun.which("git") !== null
}

async function runGitCommand(args: string[], cwd: string) {
  const result = await $`git ${args}`.cwd(cwd).quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Git command failed: git ${args.join(" ")}`)
  }
}

function parseGitHubRepo(url: string) {
  const match = url.match(GITHUB_REPO_REGEX)
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
  }
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
