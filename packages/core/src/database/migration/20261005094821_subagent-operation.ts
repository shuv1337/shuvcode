import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261005094821_subagent-operation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`subagent_operation\` (
          \`session_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`call_id\` text NOT NULL,
          \`child_session_id\` text NOT NULL,
          \`inbox_id\` text NOT NULL UNIQUE,
          \`input_digest\` text NOT NULL,
          \`agent\` text NOT NULL,
          \`model\` text,
          \`status\` text NOT NULL,
          CONSTRAINT \`subagent_operation_pk\` PRIMARY KEY(\`session_id\`, \`assistant_message_id\`, \`call_id\`),
          CONSTRAINT \`fk_subagent_operation_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
