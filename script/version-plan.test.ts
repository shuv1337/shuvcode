import { describe, expect, test } from "bun:test"
import { planDraftRelease } from "./version-plan"

const tag = "v1.2.3"
const target = "0123456789abcdef"
const draft = { tagName: tag, name: tag, targetCommitish: target, isDraft: true }

describe("draft release planning", () => {
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
