export * as SessionCwdStored from "./cwd-stored.js"

import { Option, Schema } from "effect"
import { Environment } from "../environment/index.js"
import type { SessionSchema } from "./schema.js"

// Pure metadata helpers, kept apart from `cwd.ts` so `session/info.ts` can use them without
// importing `file-access.ts` -> `permission.ts` -> `session/store.ts`, an import cycle that
// leaves `SessionStore.node` uninitialized when `session/store.ts` is the first module loaded.
// Experimental storage inside session_v2.metadata so this stays internal with zero DB migration.
// Stripped from public Session.Info.metadata and preserved across MetadataUpdated.
const metadataKey = "$opencode_experimental_cwd"
const decodePlace = Schema.decodeUnknownOption(Environment.Place)

export function readStored(metadata: SessionSchema.Metadata | null | undefined): {
  readonly cwd: Environment.Place | undefined
  readonly metadata: SessionSchema.Metadata | undefined
} {
  if (!metadata) return { cwd: undefined, metadata: undefined }
  if (!Object.hasOwn(metadata, metadataKey)) return { cwd: undefined, metadata }
  const cwd = Option.getOrUndefined(decodePlace(metadata[metadataKey]))
  const rest = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== metadataKey))
  return { cwd, metadata: Object.keys(rest).length > 0 ? rest : undefined }
}

export function writeStored(
  metadata: SessionSchema.Metadata | null | undefined,
  cwd: Environment.Place | undefined,
): SessionSchema.Metadata | null {
  if (!cwd && (!metadata || !Object.hasOwn(metadata, metadataKey))) return metadata ?? null
  const clean = Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => key !== metadataKey))
  const next = cwd ? { ...clean, [metadataKey]: cwd } : clean
  return Object.keys(next).length > 0 ? next : null
}
