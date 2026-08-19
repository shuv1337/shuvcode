export type DraftRelease = {
  tagName: string
  name: string
  targetCommitish: string
  isDraft: boolean
}

export type ReleaseSummary = DraftRelease & {
  databaseId: number
  publishedAt: string | null
  isPrerelease: boolean
}

export type ReleaseCommit = {
  message: string
  parents: readonly string[]
}

export function decodeReleaseSummary(value: unknown): ReleaseSummary {
  const input = requireObject(value, "GitHub release")
  return {
    databaseId: requireNumber(input, "databaseId"),
    tagName: requireString(input, "tagName"),
    name: requireString(input, "name"),
    targetCommitish: requireString(input, "targetCommitish"),
    isDraft: requireBoolean(input, "isDraft"),
    publishedAt: requireNullableString(input, "publishedAt"),
    isPrerelease: requireBoolean(input, "isPrerelease"),
  }
}

export function decodeReleaseCommit(value: unknown): ReleaseCommit {
  const input = requireObject(value, "GitHub commit")
  const parents = Reflect.get(input, "parents")
  if (!Array.isArray(parents) || parents.some((parent) => typeof parent !== "string")) {
    throw new Error("GitHub commit has invalid parents")
  }
  return { message: requireString(input, "message"), parents }
}

export function releaseForTag(tag: string, releases: readonly ReleaseSummary[]) {
  const matches = releases.filter((release) => release.tagName === tag)
  if (matches.length > 1) {
    throw new Error(`Multiple GitHub releases use ${tag}: ${matches.map((release) => release.databaseId).join(", ")}`)
  }
  return matches[0]
}

export function latestPublishedTag(releases: readonly ReleaseSummary[]) {
  return releases
    .filter((release): release is ReleaseSummary & { publishedAt: string } => !release.isDraft && !!release.publishedAt)
    .toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0]?.tagName
}

export function isPrereleaseVersion(version: string) {
  return /^\d+\.\d+\.\d+-/.test(version)
}

export function normalizeReleaseTagTarget(
  tag: string,
  source: string,
  target: string | undefined,
  commit: ReleaseCommit | undefined,
) {
  if (!target || target === source) return target
  if (
    commit?.message.split("\n")[0] === `release: ${tag}` &&
    commit.parents.length === 1 &&
    commit.parents[0] === source
  ) {
    return source
  }
  return target
}

function requireObject(value: unknown, name: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} is invalid`)
  return value
}

function requireString(value: object, key: string) {
  const field = Reflect.get(value, key)
  if (typeof field !== "string") throw new Error(`GitHub release field ${key} is invalid`)
  return field
}

function requireNumber(value: object, key: string) {
  const field = Reflect.get(value, key)
  if (typeof field !== "number" || !Number.isSafeInteger(field)) {
    throw new Error(`GitHub release field ${key} is invalid`)
  }
  return field
}

function requireBoolean(value: object, key: string) {
  const field = Reflect.get(value, key)
  if (typeof field !== "boolean") throw new Error(`GitHub release field ${key} is invalid`)
  return field
}

function requireNullableString(value: object, key: string) {
  const field = Reflect.get(value, key)
  if (field !== null && typeof field !== "string") throw new Error(`GitHub release field ${key} is invalid`)
  return field
}

export function planDraftRelease(
  tag: string,
  target: string,
  release: DraftRelease | undefined,
  tagTarget: string | undefined,
) {
  if (!release) {
    if (tagTarget) throw new Error(`Tag ${tag} already exists without a matching draft release`)
    return "create" as const
  }
  if (!release.isDraft) throw new Error(`Release ${tag} is already published`)
  if (release.tagName !== tag || release.name !== tag)
    throw new Error(`Draft release ${tag} does not match the target release`)
  if (release.targetCommitish !== target) {
    throw new Error(`Draft release ${tag} targets ${release.targetCommitish}, not ${target}`)
  }
  if (tagTarget && tagTarget !== target) throw new Error(`Tag ${tag} targets ${tagTarget}, not ${target}`)
  return "reuse" as const
}
