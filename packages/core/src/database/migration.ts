export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  foreignKeys?: boolean
  up: (tx: Transaction) => Effect.Effect<void, unknown>
}

export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      const tables = yield* db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      if (tables.some((table) => table.name === "session" || table.name === "session_v2")) {
        yield* bridgeForkTip(db, tables)
        return yield* applyOnly(db, migrations)
      }
      if (tables.length > 0) return yield* Effect.die(new Error("Database is not empty and has no session table"))
      const started = Date.now()
      yield* Effect.logInfo("database schema bootstrap started", { migrations: migrations.length })
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* schema.up(tx)
          yield* tx.run(
            sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          yield* Effect.forEach(migrations, (migration) =>
            tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            ),
          )
        }),
      )
      yield* Effect.logInfo("database schema bootstrap completed", {
        migrations: migrations.length,
        durationMs: Date.now() - started,
      })
    }),
  )
}

const forkBoundaryMigration = "20260804035517_session_tool_policy"
const upstreamSquashMigration = "20260804233008_loose_psylocke"

const bridgeForkTip = Effect.fn("DatabaseMigration.bridgeForkTip")(function* (
  db: Database,
  tables: ReadonlyArray<{ readonly name: string }>,
) {
  if (!tables.some((table) => table.name === "session")) return false
  if (tables.some((table) => table.name === "session_v2")) return false
  if (!tables.some((table) => table.name === "migration")) return false
  const columns = yield* db.all<{ name: string }>(sql`PRAGMA table_info('session')`)
  if (!columns.some((column) => column.name === "fork_boundary")) return false
  if (
    !(yield* db.get<{ id: string }>(
      sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${forkBoundaryMigration}`,
    ))
  )
    return false

  const started = Date.now()
  yield* Effect.logInfo("fork database bridge started", {
    boundaryMigration: forkBoundaryMigration,
    squashMigration: upstreamSquashMigration,
  })
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // Drop indexes before rename. Partial indexes that qualify the old table
      // name (e.g. WHERE "session"."time_suspended" IS NOT NULL) break SQLite's
      // ALTER TABLE ... RENAME and leave the database unmigratable.
      yield* Effect.forEach(
        ["session_project_idx", "session_workspace_idx", "session_parent_idx", "session_time_suspended_idx"],
        (index) => tx.run(sql`DROP INDEX IF EXISTS ${sql.identifier(index)}`),
        { discard: true },
      )
      yield* tx.run(sql`ALTER TABLE ${sql.identifier("session")} RENAME TO ${sql.identifier("session_v2")}`)
      yield* tx.run(sql`CREATE INDEX session_v2_project_idx ON session_v2 (project_id)`)
      yield* tx.run(sql`CREATE INDEX session_v2_workspace_idx ON session_v2 (workspace_id)`)
      yield* tx.run(sql`CREATE INDEX session_v2_parent_idx ON session_v2 (parent_id)`)
      yield* tx.run(
        sql`CREATE INDEX session_v2_time_suspended_idx ON session_v2 (time_suspended) WHERE time_suspended IS NOT NULL`,
      )
      yield* tx.run(sql`
        INSERT INTO ${sql.identifier("migration")} (id, time_completed)
        VALUES (${upstreamSquashMigration}, ${Date.now()})
      `)
    }),
  )
  yield* Effect.logInfo("fork database bridge completed", {
    boundaryMigration: forkBoundaryMigration,
    squashMigration: upstreamSquashMigration,
    durationMs: Date.now() - started,
  })
  return true
})

export function applyOnly(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    yield* db.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    let completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    if (completed.size === 0) {
      // Existing installs used Drizzle's migration journal. Seed the new
      // journal once so TypeScript migrations don't replay old SQL.
      if (
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        yield* db.run(sql`
          INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
          SELECT name, ${Date.now()}
          FROM ${sql.identifier("__drizzle_migrations")}
          WHERE name IS NOT NULL
        `)
        completed = new Set(
          (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }
    }

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      const started = Date.now()
      yield* Effect.logInfo("database migration started", { migration: migration.id })
      const apply = db.transaction((tx) =>
        Effect.gen(function* () {
          yield* migration.up(tx)
          yield* tx.run(
            sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          )
        }),
      )
      if (migration.foreignKeys !== false) {
        yield* apply.pipe(
          Effect.tapError((error) =>
            Effect.logError("database migration failed", {
              migration: migration.id,
              durationMs: Date.now() - started,
              error,
            }),
          ),
        )
        yield* Effect.logInfo("database migration completed", {
          migration: migration.id,
          durationMs: Date.now() - started,
        })
        continue
      }
      yield* db.run(sql`PRAGMA foreign_keys = OFF`)
      yield* apply.pipe(
        Effect.ensuring(db.run(sql`PRAGMA foreign_keys = ON`).pipe(Effect.orDie)),
        Effect.tapError((error) =>
          Effect.logError("database migration failed", {
            migration: migration.id,
            durationMs: Date.now() - started,
            error,
          }),
        ),
      )
      yield* Effect.logInfo("database migration completed", {
        migration: migration.id,
        durationMs: Date.now() - started,
      })
    }
  })
}
