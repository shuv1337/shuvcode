import { $ } from "bun"
import path from "node:path"
import {
  releaseAssetNames,
  verifyUploadedReleaseAssets,
  type UploadedReleaseAsset,
} from "../packages/cli/script/release-assets"
import { decodeReleaseSummary, planDraftRelease, type ReleaseSummary } from "./version-plan"

export type GitHubReleaseAsset = UploadedReleaseAsset & { databaseId: number }
export type GitHubRelease = ReleaseSummary & { assets: GitHubReleaseAsset[] }

const fields =
  "{databaseId:.id,tagName:.tag_name,name:.name,targetCommitish:.target_commitish,isDraft:.draft,publishedAt:.published_at,isPrerelease:.prerelease,assets:(.assets|map({databaseId:.id,name:.name,size:.size}))}"

function decodeRelease(value: unknown): GitHubRelease {
  const release = decodeReleaseSummary(value)
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("GitHub release is invalid")
  const assets = Reflect.get(value, "assets")
  if (!Array.isArray(assets)) throw new Error("GitHub release assets are invalid")
  return {
    ...release,
    assets: assets.map((asset) => {
      if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
        throw new Error("GitHub release asset is invalid")
      }
      const databaseId = Reflect.get(asset, "databaseId")
      const name = Reflect.get(asset, "name")
      const size = Reflect.get(asset, "size")
      if (typeof databaseId !== "number" || !Number.isSafeInteger(databaseId)) {
        throw new Error("GitHub release asset ID is invalid")
      }
      if (typeof name !== "string" || typeof size !== "number") throw new Error("GitHub release asset is invalid")
      return { databaseId, name, size }
    }),
  }
}

export function verifyDraftRelease(
  release: GitHubRelease,
  expected: { databaseId: number; tag: string; target: string; prerelease: boolean },
) {
  if (release.databaseId !== expected.databaseId) {
    throw new Error(`GitHub returned release ${release.databaseId}, not ${expected.databaseId}`)
  }
  planDraftRelease(expected.tag, expected.target, release, undefined)
  if (release.isPrerelease !== expected.prerelease) {
    throw new Error(`Draft release ${expected.tag} has incorrect prerelease metadata`)
  }
  return release
}

export async function replaceDraftReleaseAssets(input: {
  repository: string
  databaseId: number
  tag: string
  target: string
  prerelease: boolean
  files: readonly string[]
}) {
  const names = input.files.map((file) => path.basename(file)).toSorted()
  if (names.length !== releaseAssetNames.length || names.some((name, index) => name !== releaseAssetNames[index])) {
    throw new Error(`Local GitHub release assets do not match the expected set: ${names.join(", ")}`)
  }

  const release = verifyDraftRelease(await getRelease(input.repository, input.databaseId), input)
  for (const asset of release.assets) {
    await $`gh api --method DELETE ${`repos/${input.repository}/releases/assets/${asset.databaseId}`}`.quiet()
  }
  for (const file of input.files) {
    const name = path.basename(file)
    const url = `https://uploads.github.com/repos/${input.repository}/releases/${input.databaseId}/assets?name=${encodeURIComponent(name)}`
    await $`gh api --method POST ${url} -H ${"Content-Type: application/octet-stream"} --input ${file}`.quiet()
  }

  const uploaded = verifyDraftRelease(await getRelease(input.repository, input.databaseId), input)
  verifyUploadedReleaseAssets(uploaded.assets)
  return uploaded
}

export async function publishDraftRelease(input: {
  repository: string
  databaseId: number
  tag: string
  target: string
  prerelease: boolean
}) {
  verifyDraftRelease(await getRelease(input.repository, input.databaseId), input)
  const release = decodeRelease(
    await $`gh api --method PATCH ${`repos/${input.repository}/releases/${input.databaseId}`} -F draft=false -F prerelease=${input.prerelease} --jq ${fields}`.json(),
  )
  if (
    release.databaseId !== input.databaseId ||
    release.tagName !== input.tag ||
    release.targetCommitish !== input.target
  ) {
    throw new Error(`GitHub published an unexpected release for ${input.tag}`)
  }
  if (release.isDraft || release.isPrerelease !== input.prerelease) {
    throw new Error(`GitHub did not publish ${input.tag} with the requested metadata`)
  }
  verifyUploadedReleaseAssets(release.assets)
  return release
}

async function getRelease(repository: string, databaseId: number) {
  return decodeRelease(await $`gh api ${`repos/${repository}/releases/${databaseId}`} --jq ${fields}`.json())
}
