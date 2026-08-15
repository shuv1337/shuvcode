import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260815073846_fork_session_policy",
  up(tx) {
    return Effect.gen(function* () {
      // Fork-tip databases carry `policy` from `20260804035517_session_tool_policy` through the
      // bridge rename, and fresh databases bootstrap it. Only an upstream V2 database that recorded
      // the squash before the fork merged still lacks the column.
      const columns = yield* tx.all<{ name: string }>(sql`PRAGMA table_info('session_v2')`)
      if (columns.some((column) => column.name === "policy")) return
      yield* tx.run(sql`ALTER TABLE \`session_v2\` ADD \`policy\` text;`)
    })
  },
}

export default migration
