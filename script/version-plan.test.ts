import { describe, expect, test } from "bun:test"
import {
  isPrereleaseVersion,
  latestPublishedTag,
  normalizeReleaseTagTarget,
  planDraftRelease,
  releaseForTag,
} from "./version-plan"

const tag = "v1.2.3"
const target = "0123456789abcdef"
const draft = { tagName: tag, name: tag, targetCommitish: target, isDraft: true }
const release = (databaseId: number, tagName: string, publishedAt: string | null, isDraft = false) => ({
  databaseId,
  tagName,
  name: tagName,
  targetCommitish: target,
  isDraft,
  isPrerelease: tagName.includes("-"),
  publishedAt,
})

describe("release note planning", () => {
  test("uses the newest published release and ignores drafts", () => {
    expect(
      latestPublishedTag([
        release(1, "v1.2.0", "2026-01-02T00:00:00Z"),
        release(2, "v1.3.0-draft", null, true),
        release(3, "v1.1.0", "2026-01-01T00:00:00Z"),
      ]),
    ).toBe("v1.2.0")
    expect(latestPublishedTag([release(1, "v1.0.0-draft", null, true)])).toBeUndefined()
  })

  test("classifies semantic prerelease versions", () => {
    expect(isPrereleaseVersion("2.0.0-alpha-15")).toBeTrue()
    expect(isPrereleaseVersion("2.0.0-rc.1+build.2")).toBeTrue()
    expect(isPrereleaseVersion("2.0.0")).toBeFalse()
  })
})

describe("draft release planning", () => {
  test("accepts only the source or its generated release commit as the draft tag", () => {
    expect(normalizeReleaseTagTarget(tag, target, target, undefined)).toBe(target)
    expect(
      normalizeReleaseTagTarget(tag, target, "release-commit", {
        message: `release: ${tag}`,
        parents: [target],
      }),
    ).toBe(target)
    expect(
      normalizeReleaseTagTarget(tag, target, "other", {
        message: `release: ${tag}`,
        parents: ["unrelated"],
      }),
    ).toBe("other")
  })

  test("finds one exact release and refuses duplicate tag records", () => {
    const exact = release(1, tag, null, true)
    expect(releaseForTag(tag, [release(2, "v1.2.2", "2026-01-01T00:00:00Z"), exact])).toBe(exact)
    expect(releaseForTag(tag, [])).toBeUndefined()
    expect(() => releaseForTag(tag, [exact, { ...exact, databaseId: 3 }])).toThrow("Multiple GitHub releases")
  })

  test("creates only when neither release nor tag exists", () => {
    expect(planDraftRelease(tag, target, undefined, undefined)).toBe("create")
    expect(() => planDraftRelease(tag, target, undefined, target)).toThrow(
      "already exists without a matching draft release",
    )
  })

  test("reuses an exact matching draft with or without its exact tag", () => {
    expect(planDraftRelease(tag, target, draft, undefined)).toBe("reuse")
    expect(planDraftRelease(tag, target, draft, target)).toBe("reuse")
  })

  test("never overwrites a published or unrelated release or tag", () => {
    expect(() => planDraftRelease(tag, target, { ...draft, isDraft: false }, undefined)).toThrow("already published")
    expect(() => planDraftRelease(tag, target, { ...draft, targetCommitish: "other" }, undefined)).toThrow(
      "targets other",
    )
    expect(() => planDraftRelease(tag, target, { ...draft, name: "other" }, undefined)).toThrow("does not match")
    expect(() => planDraftRelease(tag, target, draft, "other")).toThrow("targets other")
  })
})
