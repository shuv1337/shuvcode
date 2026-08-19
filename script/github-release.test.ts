import { expect, test } from "bun:test"
import { releaseAssetNames } from "../packages/cli/script/release-assets"
import { verifyDraftRelease, type GitHubRelease } from "./github-release"

const expected = {
  databaseId: 42,
  tag: "v2.0.0-alpha-15",
  target: "0123456789abcdef",
  prerelease: true,
}
const release: GitHubRelease = {
  databaseId: expected.databaseId,
  tagName: expected.tag,
  name: expected.tag,
  targetCommitish: expected.target,
  isDraft: true,
  isPrerelease: true,
  publishedAt: null,
  assets: releaseAssetNames.map((name, index) => ({ databaseId: index + 1, name, size: 1 })),
}

test("verifies the exact draft release identity and metadata", () => {
  expect(verifyDraftRelease(release, expected)).toBe(release)
  expect(() => verifyDraftRelease({ ...release, databaseId: 43 }, expected)).toThrow("not 42")
  expect(() => verifyDraftRelease({ ...release, targetCommitish: "other" }, expected)).toThrow("targets other")
  expect(() => verifyDraftRelease({ ...release, isDraft: false }, expected)).toThrow("already published")
  expect(() => verifyDraftRelease({ ...release, isPrerelease: false }, expected)).toThrow("prerelease metadata")
})
