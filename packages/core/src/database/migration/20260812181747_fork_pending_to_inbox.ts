import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import {
  CompactionPayload,
  Delivery,
  SyntheticPayload,
  UserPayload,
} from "@opencode-ai/schema/session-inbox"
import type { DatabaseMigration } from "../migration.js"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeUser = Schema.decodeUnknownOption(UserPayload)
const encodeUser = Schema.encodeSync(UserPayload)
const decodeSynthetic = Schema.decodeUnknownOption(SyntheticPayload)
const encodeSynthetic = Schema.encodeSync(SyntheticPayload)
const decodeCompaction = Schema.decodeUnknownOption(CompactionPayload)
const encodeCompaction = Schema.encodeSync(CompactionPayload)
const decodeDelivery = Schema.decodeUnknownOption(Delivery)

type PendingRow = {
  readonly id: string
  readonly session_id: string
  readonly type: string
  readonly data: unknown
  readonly delivery: string | null
  readonly admitted_seq: number
  readonly time_created: number
}

const migration: DatabaseMigration.Migration = {
  id: "20260812181747_fork_pending_to_inbox",
  up(tx) {
    return Effect.gen(function* () {
      if (
        !(yield* tx.get(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"session_pending"}`,
        ))
      )
        return
      if (
        !(yield* tx.get(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"session_inbox"}`,
        ))
      )
        return yield* Effect.fail(new Error("session_inbox must exist before fork pending copy"))

      const rows = yield* tx.all<PendingRow>(sql`
        SELECT id, session_id, type, data, delivery, admitted_seq, time_created
        FROM session_pending
        ORDER BY session_id ASC, admitted_seq ASC, id ASC
      `)

      for (const row of rows) {
        const payload = encodePayload(row)
        const delivery = row.type === "compaction" ? (row.delivery ?? "queue") : requireDelivery(row)
        yield* tx.run(sql`
          INSERT INTO session_inbox (id, session_id, type, payload, delivery, enqueued_seq, time_created)
          VALUES (
            ${row.id},
            ${row.session_id},
            ${row.type},
            ${payload},
            ${delivery},
            ${row.admitted_seq},
            ${row.time_created}
          )
          ON CONFLICT(id) DO NOTHING
        `)
      }
    })
  },
}

export default migration

function requireDelivery(row: PendingRow) {
  const delivery = Option.getOrUndefined(decodeDelivery(row.delivery))
  if (!delivery) throw new Error(`session_pending row ${row.id} is missing delivery`)
  return delivery
}

function encodePayload(row: PendingRow) {
  const data = parseData(row.data)
  if (row.type === "user") {
    const payload = Option.getOrUndefined(decodeUser(data))
    if (!payload) throw new Error(`session_pending row ${row.id} has invalid user payload`)
    return JSON.stringify(encodeUser(payload))
  }
  if (row.type === "synthetic") {
    const payload = Option.getOrUndefined(decodeSynthetic(data))
    if (!payload) throw new Error(`session_pending row ${row.id} has invalid synthetic payload`)
    return JSON.stringify(encodeSynthetic(payload))
  }
  if (row.type === "compaction") {
    const payload = Option.getOrUndefined(decodeCompaction(data ?? {}))
    if (!payload) throw new Error(`session_pending row ${row.id} has invalid compaction payload`)
    return JSON.stringify(encodeCompaction(payload))
  }
  throw new Error(`session_pending row ${row.id} has unsupported type ${row.type}`)
}

function parseData(data: unknown) {
  if (typeof data === "string") {
    const parsed = Option.getOrUndefined(decodeJson(data))
    if (parsed === undefined) throw new Error("session_pending data is not valid JSON")
    return parsed
  }
  return data
}
