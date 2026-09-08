import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260908005645_input_request_receipts",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`form_request\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`workspace_id\` text,
          \`owner_generation\` text NOT NULL,
          \`request\` text NOT NULL,
          \`status\` text NOT NULL,
          \`state\` text NOT NULL,
          \`response_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`permission_request\` (
          \`id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`workspace_id\` text,
          \`generation\` text NOT NULL,
          \`request\` text NOT NULL,
          \`agent\` text,
          \`status\` text NOT NULL,
          \`state\` text NOT NULL,
          \`response_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`form_request_retention_idx\` ON \`form_request\` (\`status\`,\`time_updated\`);`)
      yield* tx.run(
        `CREATE INDEX \`permission_request_location_idx\` ON \`permission_request\` (\`directory\`,\`workspace_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`permission_request_retention_idx\` ON \`permission_request\` (\`status\`,\`time_updated\`);`,
      )
    })
  },
}

export default migration
