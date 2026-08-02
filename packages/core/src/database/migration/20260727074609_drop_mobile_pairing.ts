import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260727074609_drop_mobile_pairing",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`pairing_device_request_id_unique\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`pairing_device_credential_hash_unique\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`pairing_device_invitation_hash_unique\`;`)
      yield* tx.run(`DROP TABLE \`pairing_device\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
