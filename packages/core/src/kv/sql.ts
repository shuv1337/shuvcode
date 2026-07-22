import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { KV } from "../kv"

export const KVTable = sqliteTable("kv", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).$type<KV.Value>().notNull(),
  ...Timestamps,
})
