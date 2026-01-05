import { describe, expect, test } from "bun:test"
import { PermissionEditor } from "../../src/permission/editor"
import type { Permission } from "../../src/permission"

function makePermission(type: string, metadata: Record<string, unknown>): Permission.Info {
  return {
    id: "test-permission",
    type,
    sessionID: "test-session",
    messageID: "test-message",
    message: "Test Permission",
    metadata,
    time: { created: Date.now() },
  }
}

describe("PermissionEditor.canEdit", () => {
  test("returns true for valid single-file edit permission", () => {
    const permission = makePermission("edit", {
      filePath: "/test/file.ts",
      originalContent: "original",
      suggestedContent: "suggested",
    })
    expect(PermissionEditor.canEdit(permission)).toBe(true)
  })

  test("returns false when missing filePath", () => {
    const permission = makePermission("edit", {
      originalContent: "original",
      suggestedContent: "suggested",
    })
    expect(PermissionEditor.canEdit(permission)).toBe(false)
  })

  test("returns false when missing originalContent", () => {
    const permission = makePermission("edit", {
      filePath: "/test/file.ts",
      suggestedContent: "suggested",
    })
    expect(PermissionEditor.canEdit(permission)).toBe(false)
  })

  test("returns false when missing suggestedContent", () => {
    const permission = makePermission("edit", {
      filePath: "/test/file.ts",
      originalContent: "original",
    })
    expect(PermissionEditor.canEdit(permission)).toBe(false)
  })

  test("returns false for non-edit permission types", () => {
    const permission = makePermission("bash", {
      filePath: "/test/file.ts",
      originalContent: "original",
      suggestedContent: "suggested",
    })
    expect(PermissionEditor.canEdit(permission)).toBe(false)
  })
})

describe("PermissionEditor.isEditable", () => {
  test("returns true for single-file editable permission", () => {
    const permission = makePermission("edit", {
      filePath: "/test/file.ts",
      originalContent: "original",
      suggestedContent: "suggested",
    })
    expect(PermissionEditor.isEditable(permission)).toBe(true)
  })

  test("returns false for non-editable permission", () => {
    const permission = makePermission("bash", { command: "ls" })
    expect(PermissionEditor.isEditable(permission)).toBe(false)
  })
})

describe("PermissionEditor.getStartLine", () => {
  test("returns 1 when first line differs", () => {
    const original = "line1\nline2\nline3"
    const suggested = "changed\nline2\nline3"
    expect(PermissionEditor.getStartLine(original, suggested)).toBe(1)
  })

  test("returns correct line when middle line differs", () => {
    const original = "line1\nline2\nline3"
    const suggested = "line1\nchanged\nline3"
    expect(PermissionEditor.getStartLine(original, suggested)).toBe(2)
  })

  test("returns correct line when last line differs", () => {
    const original = "line1\nline2\nline3"
    const suggested = "line1\nline2\nchanged"
    expect(PermissionEditor.getStartLine(original, suggested)).toBe(3)
  })

  test("returns 1 for empty original", () => {
    const original = ""
    const suggested = "new content"
    expect(PermissionEditor.getStartLine(original, suggested)).toBe(1)
  })

  test("returns 1 when all lines are the same (edge case)", () => {
    const original = "line1\nline2"
    const suggested = "line1\nline2"
    expect(PermissionEditor.getStartLine(original, suggested)).toBe(1)
  })

  test("handles addition at end", () => {
    const original = "line1\nline2"
    const suggested = "line1\nline2\nline3"
    expect(PermissionEditor.getStartLine(original, suggested)).toBe(3)
  })
})

describe("PermissionEditor.hasChanges", () => {
  test("returns false for identical content", () => {
    expect(PermissionEditor.hasChanges("hello", "hello")).toBe(false)
  })

  test("returns true for different content", () => {
    expect(PermissionEditor.hasChanges("hello", "world")).toBe(true)
  })

  test("normalizes CRLF to LF before comparison", () => {
    expect(PermissionEditor.hasChanges("hello\r\nworld", "hello\nworld")).toBe(false)
  })

  test("returns true for whitespace differences (not line endings)", () => {
    expect(PermissionEditor.hasChanges("hello world", "hello  world")).toBe(true)
  })
})

describe("PermissionEditor.computeDiff", () => {
  test("produces valid unified diff", () => {
    const diff = PermissionEditor.computeDiff("/test.ts", "old", "new")
    expect(diff).toContain("-old")
    expect(diff).toContain("+new")
  })

  test("handles empty original (new file)", () => {
    const diff = PermissionEditor.computeDiff("/test.ts", "", "new content")
    expect(diff).toContain("+new content")
  })

  test("handles empty suggested (file deletion)", () => {
    const diff = PermissionEditor.computeDiff("/test.ts", "old content", "")
    expect(diff).toContain("-old content")
  })
})

describe("PermissionEditor.getExtension", () => {
  test("returns file extension for single-file permission", () => {
    const permission = makePermission("edit", {
      filePath: "/test/file.tsx",
      originalContent: "",
      suggestedContent: "",
    })
    expect(PermissionEditor.getExtension(permission)).toBe(".tsx")
  })

  test("returns .txt for files without extension", () => {
    const permission = makePermission("edit", {
      filePath: "/test/Makefile",
      originalContent: "",
      suggestedContent: "",
    })
    expect(PermissionEditor.getExtension(permission)).toBe(".txt")
  })
})
