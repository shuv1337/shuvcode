import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

const migration: DatabaseMigration.Migration = {
  id: "20260714225613_mobile_pairing",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`pairing_device\` (
          \`id\` text PRIMARY KEY,
          \`request_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`credential_hash\` text NOT NULL,
          \`invitation_hash\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_revoked\` integer
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX \`pairing_device_request_id_unique\` ON \`pairing_device\` (\`request_id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`pairing_device_credential_hash_unique\` ON \`pairing_device\` (\`credential_hash\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`pairing_device_invitation_hash_unique\` ON \`pairing_device\` (\`invitation_hash\`);`,
      )
    })
  },
}

export default migration
