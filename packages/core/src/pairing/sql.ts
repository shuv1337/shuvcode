import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Pairing } from "@opencode-ai/schema/pairing"
import { Timestamps } from "../database/schema.sql"

export const PairingDeviceTable = sqliteTable(
  "pairing_device",
  {
    id: text().$type<Pairing.DeviceID>().primaryKey(),
    request_id: text().$type<Pairing.RequestID>().notNull(),
    name: text().$type<Pairing.DeviceName>().notNull(),
    credential_hash: text().notNull(),
    invitation_hash: text().notNull(),
    ...Timestamps,
    time_revoked: integer(),
  },
  (table) => [
    uniqueIndex("pairing_device_request_id_unique").on(table.request_id),
    uniqueIndex("pairing_device_credential_hash_unique").on(table.credential_hash),
    uniqueIndex("pairing_device_invitation_hash_unique").on(table.invitation_hash),
  ],
)
