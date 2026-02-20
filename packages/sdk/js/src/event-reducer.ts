/**
 * Framework-agnostic event reducer for opencode SSE events.
 * Applies message/part events to a flat store using immutable updates.
 * Can be used from any UI framework (React, Solid, etc).
 */
import type { Message, Part } from "./v2/gen/types.gen.js"

function search<T>(array: T[], id: string, getId: (item: T) => string): { found: boolean; index: number } {
  let left = 0
  let right = array.length - 1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const midId = getId(array[mid])

    if (midId === id) return { found: true, index: mid }
    if (midId < id) {
      left = mid + 1
      continue
    }
    right = mid - 1
  }

  return { found: false, index: left }
}

export interface MessageStore {
  /** Messages keyed by sessionID */
  messages: Record<string, Message[]>
  /** Parts keyed by messageID */
  parts: Record<string, Part[]>
}

function upsertSorted<T>(array: T[], item: T, id: string, getId: (item: T) => string): T[] {
  const result = search(array, id, getId)
  const next = [...array]
  if (result.found) {
    next[result.index] = item
  } else {
    next.splice(result.index, 0, item)
  }
  return next
}

function removeSorted<T>(array: T[], id: string, getId: (item: T) => string): T[] | null {
  const result = search(array, id, getId)
  if (!result.found) return null
  const next = [...array]
  next.splice(result.index, 1)
  return next
}

/**
 * Apply a single SSE event to a MessageStore.
 * Returns a new store if the event was handled, or null if unrecognized/no-op.
 */
export function applyMessageEvent(
  store: MessageStore,
  event: { type: string; properties?: any },
): MessageStore | null {
  const props = event.properties

  switch (event.type) {
    case "message.updated": {
      const info = props?.info as Message | undefined
      if (!info) return null
      const sessionID = (info as any).sessionID
      if (!sessionID) return null
      const messages = store.messages[sessionID] ?? []
      const next = upsertSorted(messages, info, info.id, (m) => m.id)
      return { ...store, messages: { ...store.messages, [sessionID]: next } }
    }

    case "message.removed": {
      const { sessionID, messageID } = props as { sessionID: string; messageID: string }
      if (!sessionID || !messageID) return null
      const messages = store.messages[sessionID]
      if (!messages) return null
      const next = removeSorted(messages, messageID, (m) => m.id)
      if (!next) return null
      const { [messageID]: _, ...restParts } = store.parts
      return { messages: { ...store.messages, [sessionID]: next }, parts: restParts }
    }

    case "message.part.updated": {
      const part = props?.part as Part | undefined
      if (!part) return null
      const messageID = (part as any).messageID
      if (!messageID) return null
      const parts = store.parts[messageID] ?? []
      const next = upsertSorted(parts, part, (part as any).id, (p) => (p as any).id)
      return { ...store, parts: { ...store.parts, [messageID]: next } }
    }

    case "message.part.delta": {
      const { messageID, partID, field, delta } = props as {
        messageID: string
        partID: string
        field: string
        delta: string
      }
      if (!messageID || !partID || !field) return null
      const parts = store.parts[messageID]
      if (!parts) return null
      const result = search(parts, partID, (p) => (p as any).id)
      if (!result.found) return null
      const oldPart = parts[result.index] as any
      const newPart = { ...oldPart, [field]: (oldPart[field] ?? "") + delta }
      const next = [...parts]
      next[result.index] = newPart
      return { ...store, parts: { ...store.parts, [messageID]: next } }
    }

    case "message.part.removed": {
      const { messageID, partID } = props as { messageID: string; partID: string }
      if (!messageID || !partID) return null
      const parts = store.parts[messageID]
      if (!parts) return null
      const next = removeSorted(parts, partID, (p) => (p as any).id)
      if (!next) return null
      return { ...store, parts: { ...store.parts, [messageID]: next } }
    }

    default:
      return null
  }
}

/** Reconstruct message+parts pairs from the flat stores for a given session. */
export function getSessionMessages(
  store: MessageStore,
  sessionID: string,
): Array<{ info: Message; parts: Part[] }> {
  const messages = store.messages[sessionID]
  if (!messages) return []
  return messages.map((info) => ({
    info,
    parts: store.parts[info.id] ?? [],
  }))
}

/** Load fetched message+parts data into the store. */
export function loadMessages(
  store: MessageStore,
  sessionID: string,
  data: Array<{ info: Message; parts: Part[] }>,
): MessageStore {
  const messages = data.map((m) => m.info)
  const parts = { ...store.parts }
  for (const m of data) {
    parts[m.info.id] = m.parts
  }
  return {
    messages: { ...store.messages, [sessionID]: messages },
    parts,
  }
}
