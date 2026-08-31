// Filesystem persistence for goal shards: atomic state replacement, the
// bounded append-only ledger, and no-replace owner files. Node APIs are used
// deliberately so the packed plugin runs on any OpenCode-supported runtime.

import { createHash, randomUUID } from "node:crypto"
import { appendFile, lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import type { GoalRecord } from "./state"

export const LEDGER_ROTATE_BYTES = 256 * 1024

export interface Shard {
  readonly directory: string
  readonly state: string
  readonly ledger: string
  readonly owner: string
}

export interface OwnerInfo {
  readonly pid: number
  readonly instance: string
  readonly created: number
}

export interface LedgerEntry {
  readonly at: number
  readonly goalID: string
  readonly from: string
  readonly to: string
  readonly code: string
  readonly detail?: string
}

export class PersistenceError extends Error {
  constructor(
    readonly reason: "corrupt" | "version" | "io" | "unsafe",
    message: string,
  ) {
    super(message)
    this.name = "GoalPersistenceError"
  }
}

export function shardFor(root: string, sessionID: string): Shard {
  const digest = createHash("sha256").update(sessionID).digest("hex")
  const directory = path.join(root, digest)
  return {
    directory,
    state: path.join(directory, "state.json"),
    ledger: path.join(directory, "ledger.jsonl"),
    owner: path.join(directory, "owner.json"),
  }
}

export type LoadResult =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly record: GoalRecord }
  | { readonly status: "corrupt" }
  | { readonly status: "version" }

export async function loadRecord(shard: Shard): Promise<LoadResult> {
  const text = await readFile(shard.state, "utf8").then(
    (value) => value,
    (error: unknown) => {
      if (code(error) === "ENOENT") return undefined
      throw new PersistenceError("io", `failed to read goal state: ${String(error)}`)
    },
  )
  if (text === undefined) return { status: "missing" }
  const parsed = parseJson(text)
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) return { status: "corrupt" }
  const record = parsed as GoalRecord
  if (record.version !== 1) return { status: "version" }
  const shaped =
    typeof record.goalID === "string" &&
    typeof record.sessionID === "string" &&
    typeof record.state === "string" &&
    typeof record.mutation === "number" &&
    typeof record.window === "object" &&
    typeof record.execution === "object" &&
    Array.isArray(record.history)
  if (!shaped) return { status: "corrupt" }
  // Records written before references existed normalize to an empty list.
  if (!Array.isArray(record.references)) record.references = []
  return { status: "ok", record }
}

/**
 * Atomically replace state. A terminal transition appends its ledger intent
 * before the state file changes so recovery can never convert a completed,
 * blocked, or limited goal back into active work; other entries append after.
 */
export async function persistRecord(shard: Shard, record: GoalRecord, entry?: LedgerEntry): Promise<void> {
  await ensureShard(shard)
  const terminal = entry !== undefined && (entry.to === "completed" || entry.to === "blocked" || entry.to === "limited")
  if (terminal) await appendLedger(shard, entry)
  const temporary = `${shard.state}.${randomUUID()}.tmp`
  const handle = await open(temporary, "wx", 0o600).catch((error: unknown) => {
    throw new PersistenceError("io", `failed to create goal state file: ${String(error)}`)
  })
  await handle
    .writeFile(JSON.stringify(record))
    .then(() => handle.sync().catch(() => undefined))
    .finally(() => handle.close())
    .catch((error: unknown) => {
      throw new PersistenceError("io", `failed to write goal state: ${String(error)}`)
    })
  await refuseSymlink(shard.state)
  await rename(temporary, shard.state).catch((error: unknown) => {
    throw new PersistenceError("io", `failed to replace goal state: ${String(error)}`)
  })
  if (entry !== undefined && !terminal) await appendLedger(shard, entry).catch(() => undefined)
}

export async function appendLedger(shard: Shard, entry: LedgerEntry): Promise<void> {
  await ensureShard(shard)
  const size = await stat(shard.ledger).then(
    (info) => info.size,
    () => 0,
  )
  if (size > LEDGER_ROTATE_BYTES) await rename(shard.ledger, `${shard.ledger}.1`).catch(() => undefined)
  await appendFile(shard.ledger, `${JSON.stringify(entry)}\n`, { mode: 0o600 }).catch((error: unknown) => {
    throw new PersistenceError("io", `failed to append goal ledger: ${String(error)}`)
  })
}

/** Remove live state and ownership while retaining the audit ledger. */
export async function removeState(shard: Shard): Promise<void> {
  await unlink(shard.state).catch(ignoreMissing)
  await unlink(shard.owner).catch(ignoreMissing)
}

export type OwnerStatus = "owned" | "contended"

/**
 * Acquire the shard with a no-replace owner file. A dead owner is adopted
 * only on liveness evidence (its pid no longer exists on this host), never on
 * timestamp age; clocks cannot prove another server is dead.
 */
export async function acquireOwner(shard: Shard, self: OwnerInfo): Promise<OwnerStatus> {
  await ensureShard(shard)
  const created = await writeExclusive(shard.owner, JSON.stringify(self))
  if (created) return "owned"
  const current = parseJson(await readFile(shard.owner, "utf8").catch(() => "")) as OwnerInfo | undefined
  if (current === undefined || typeof current.pid !== "number") return "contended"
  if (current.instance === self.instance) return "owned"
  // A same-pid owner is a previous plugin generation of this very process;
  // the supervisor runs one generation at a time, so adoption is safe.
  if (current.pid !== self.pid && processAlive(current.pid)) return "contended"
  await takeoverOwner(shard, self)
  return "owned"
}

/** Force-replace the owner file. Only an explicit user action reaches this. */
export async function takeoverOwner(shard: Shard, self: OwnerInfo): Promise<void> {
  await ensureShard(shard)
  const temporary = `${shard.owner}.${randomUUID()}.tmp`
  const handle = await open(temporary, "wx", 0o600)
  await handle
    .writeFile(JSON.stringify(self))
    .finally(() => handle.close())
  await rename(temporary, shard.owner)
}

export async function releaseOwner(shard: Shard, self: OwnerInfo): Promise<void> {
  const current = parseJson(await readFile(shard.owner, "utf8").catch(() => "")) as OwnerInfo | undefined
  if (current?.instance !== self.instance) return
  await unlink(shard.owner).catch(ignoreMissing)
}

// --- Supporting details ---------------------------------------------------

async function ensureShard(shard: Shard): Promise<void> {
  await mkdir(shard.directory, { recursive: true, mode: 0o700 }).catch((error: unknown) => {
    throw new PersistenceError("io", `failed to create goal shard: ${String(error)}`)
  })
  await refuseSymlink(shard.directory)
}

async function refuseSymlink(target: string): Promise<void> {
  const info = await lstat(target).catch(ignoreMissing)
  if (info?.isSymbolicLink())
    throw new PersistenceError("unsafe", `refusing symlinked goal state path: ${target}`)
}

async function writeExclusive(target: string, content: string): Promise<boolean> {
  const handle = await open(target, "wx", 0o600).catch((error: unknown) => {
    if (code(error) === "EEXIST") return undefined
    throw new PersistenceError("io", `failed to create goal owner file: ${String(error)}`)
  })
  if (handle === undefined) return false
  await handle.writeFile(content).finally(() => handle.close())
  return true
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH proves the pid is gone; EPERM means it exists under another user.
    return code(error) !== "ESRCH"
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function ignoreMissing(error: unknown): undefined {
  if (code(error) === "ENOENT") return undefined
  throw error
}

function code(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code)
  return undefined
}
