import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260804035517_session_tool_policy",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`policy\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
