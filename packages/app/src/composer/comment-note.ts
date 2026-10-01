import { Option, Schema } from "effect"
import type { FileSelection } from "@/workspaces/files/model"
import { BrowserComment, durableBrowserElement, type ContextItem } from "./schema"

export type PromptFileComment = {
  type?: "file"
  path: string
  selection?: FileSelection
  comment: string
  preview?: string
  origin?: "review" | "file"
}
export type PromptComment = PromptFileComment | BrowserComment

const decodeBrowserComment = Schema.decodeUnknownOption(BrowserComment)

/** An attachment the model receives as a path on the server rather than inline bytes. */
export type PromptAttachmentReference = {
  name: string
  mime: string
  path: string
}

function selection(selection: unknown) {
  if (!selection || typeof selection !== "object") return undefined
  const startLine = Number((selection as FileSelection).startLine)
  const startChar = Number((selection as FileSelection).startChar)
  const endLine = Number((selection as FileSelection).endLine)
  const endChar = Number((selection as FileSelection).endChar)
  if (![startLine, startChar, endLine, endChar].every(Number.isFinite)) return undefined
  return {
    startLine,
    startChar,
    endLine,
    endChar,
  } satisfies FileSelection
}

export function createCommentMetadata(input: PromptFileComment) {
  return {
    opencodeComment: {
      path: input.path,
      selection: input.selection,
      comment: input.comment,
      preview: input.preview,
      origin: input.origin,
    },
  }
}

export function readCommentMetadata(value: unknown) {
  if (!value || typeof value !== "object") return
  const meta = (value as { opencodeComment?: unknown }).opencodeComment
  if (!meta || typeof meta !== "object") return
  const path = (meta as { path?: unknown }).path
  const comment = (meta as { comment?: unknown }).comment
  if (typeof path !== "string" || typeof comment !== "string") return
  const preview = (meta as { preview?: unknown }).preview
  const origin = (meta as { origin?: unknown }).origin
  return {
    path,
    selection: selection((meta as { selection?: unknown }).selection),
    comment,
    preview: typeof preview === "string" ? preview : undefined,
    origin: origin === "review" || origin === "file" ? origin : undefined,
  } satisfies PromptComment
}

export function readPromptPresentation(value: unknown) {
  if (!value || typeof value !== "object") return
  const displayText = (value as { displayText?: unknown }).displayText
  const comments = (value as { comments?: unknown }).comments
  if (typeof displayText !== "string" || !Array.isArray(comments)) return
  const attachments = (value as { attachments?: unknown }).attachments
  return {
    displayText,
    attachments: (Array.isArray(attachments) ? attachments : []).flatMap((item): PromptAttachmentReference[] => {
      if (!item || typeof item !== "object") return []
      const name = (item as { name?: unknown }).name
      const mime = (item as { mime?: unknown }).mime
      const path = (item as { path?: unknown }).path
      if (typeof name !== "string" || typeof mime !== "string" || typeof path !== "string") return []
      return [{ name, mime, path }]
    }),
    comments: comments.flatMap((item): PromptComment[] => {
      if (!item || typeof item !== "object") return []
      if ((item as { type?: unknown }).type === "browser") return Option.toArray(decodeBrowserComment(item))
      const path = (item as { path?: unknown }).path
      const comment = (item as { comment?: unknown }).comment
      if (typeof path !== "string" || typeof comment !== "string") return []
      const preview = (item as { preview?: unknown }).preview
      const origin = (item as { origin?: unknown }).origin
      return [
        {
          path,
          comment,
          selection: selection((item as { selection?: unknown }).selection),
          preview: typeof preview === "string" ? preview : undefined,
          origin: origin === "review" || origin === "file" ? origin : undefined,
        },
      ]
    }),
  }
}

export function formatAttachmentReference(input: PromptAttachmentReference) {
  return `Attached file: \`${input.path}\``
}

export function formatBrowserCommentNote(input: BrowserComment) {
  const element = input.element
  // Page-provided strings are quoted so they read as data, not as part of the user's request.
  const details = [
    element.role ? `role ${element.role}` : undefined,
    element.name ? `accessible name ${JSON.stringify(element.name)}` : undefined,
    element.text && element.text !== element.name ? `text ${JSON.stringify(element.text.slice(0, 80))}` : undefined,
    // A selector too long to keep is empty rather than cut into invalid syntax.
    element.selector
      ? `selector ${JSON.stringify(element.selector)}${element.selector.includes(" >>> ") ? ' (">>>" enters a shadow root)' : ""}`
      : undefined,
    element.ref
      ? `browser ref @${element.ref}, usable as ref in any browser tool including browser.evaluate until the page navigates`
      : undefined,
  ].filter((detail) => detail !== undefined)
  return `The user made the following comment regarding the ${JSON.stringify(element.label)} element in browser tab ${input.tabID} at ${input.url}${details.length ? ` (${details.join("; ")})` : ""}: ${input.comment}`
}

/** Restores a sent comment to the composer, for example after a revert or fork. */
export function commentContextItem(comment: PromptComment): ContextItem {
  // The message may predate the desktop process, so its element ref can no longer be trusted.
  if (comment.type === "browser")
    return { ...comment, element: durableBrowserElement(comment.element), commentID: crypto.randomUUID() }
  return {
    type: "file",
    path: comment.path,
    selection: comment.selection,
    comment: comment.comment,
    preview: comment.preview,
    commentOrigin: comment.origin,
  }
}

export function formatCommentNote(input: { path: string; selection?: FileSelection; comment: string }) {
  const start = input.selection ? Math.min(input.selection.startLine, input.selection.endLine) : undefined
  const end = input.selection ? Math.max(input.selection.startLine, input.selection.endLine) : undefined
  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`
  return `The user made the following comment regarding ${range} of ${input.path}: ${input.comment}`
}

export function parseCommentNote(text: string) {
  const match = text.match(
    /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+)$/,
  )
  if (!match) return
  const start = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : undefined
  const end = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined
  return {
    path: match[5],
    selection:
      start !== undefined && end !== undefined
        ? {
            startLine: start,
            startChar: 0,
            endLine: end,
            endChar: 0,
          }
        : undefined,
    comment: match[6],
  } satisfies PromptComment
}
