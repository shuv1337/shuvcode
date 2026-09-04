import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Worktree } from "../src/worktree.js"

describe("Worktree.CreateInput", () => {
  test("allows the server to choose the destination", () => {
    const input = Schema.decodeUnknownSync(Worktree.CreateInput)({
      projectID: "project",
      strategy: "git",
    })
    expect(input.directory).toBeUndefined()
    expect(Schema.encodeSync(Worktree.CreateInput)({ ...input, directory: undefined })).toEqual({
      projectID: "project",
      strategy: "git",
    })
  })

  test("preserves an explicit destination", () => {
    const input = { projectID: "project", strategy: "git", directory: "/custom/worktrees" }
    expect(Schema.encodeSync(Worktree.CreateInput)(Schema.decodeUnknownSync(Worktree.CreateInput)(input))).toEqual(
      input,
    )
  })
})
