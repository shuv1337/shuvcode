import * as path from "path"
import { createTwoFilesPatch } from "diff"
import type { Permission } from "./index"
import { Text } from "../util/text"

export namespace PermissionEditor {
  // Metadata shape for single-file edits (edit tool)
  export interface SingleFileMetadata {
    filePath: string
    originalContent: string
    suggestedContent: string
  }

  // Response data sent back through permission system
  export interface SingleFileModifyData {
    content: string
  }

  /**
   * Check if permission supports single-file editing (edit tool)
   */
  export function canEdit(permission: Permission.Info): boolean {
    if (permission.type !== "edit") return false
    const m = permission.metadata
    return (
      typeof m?.filePath === "string" &&
      typeof m?.originalContent === "string" &&
      typeof m?.suggestedContent === "string"
    )
  }

  /**
   * Check if permission supports editing
   */
  export function isEditable(permission: Permission.Info): boolean {
    return canEdit(permission)
  }

  /**
   * Get content to edit for single-file permission
   */
  export function getContent(permission: Permission.Info): string {
    return permission.metadata.suggestedContent as string
  }

  /**
   * Get file extension for syntax highlighting in editor
   */
  export function getExtension(permission: Permission.Info): string {
    return path.extname(permission.metadata.filePath as string) || ".txt"
  }

  /**
   * Calculate starting line number (first changed line) for editor positioning
   */
  export function getStartLine(original: string, suggested: string): number {
    return Text.getFirstDifferingLine(original, suggested)
  }

  /**
   * Check if edited content differs from suggestion
   */
  export function hasChanges(suggested: string, edited: string): boolean {
    return Text.hasChanges(suggested, edited)
  }

  /**
   * Compute unified diff for display
   */
  export function computeDiff(filePath: string, original: string, modified: string): string {
    return createTwoFilesPatch(
      filePath,
      filePath,
      Text.normalizeLineEndings(original),
      Text.normalizeLineEndings(modified),
    )
  }
}
