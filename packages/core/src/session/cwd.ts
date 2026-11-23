export * as SessionCwd from "./cwd.js"

import { eq } from "drizzle-orm"
import { Effect, Option, PlatformError } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { posix } from "node:path"
import { Database } from "../database/database.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { Flag } from "../flag.js"
import { Machines } from "../machine/machines.js"
import { CwdError } from "./error.js"
import type { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"

export { readStored, writeStored } from "./cwd-stored.js"
import { readStored, writeStored } from "./cwd-stored.js"

export const read = Effect.fn("SessionCwd.read")(function* (db: Database.Interface["db"], sessionID: SessionSchema.ID) {
  const row = yield* db
    .select({ metadata: SessionTable.metadata })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  return readStored(row?.metadata).cwd
})

export const write = Effect.fn("SessionCwd.write")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  cwd: Environment.Place | undefined,
) {
  const row = yield* db
    .select({ metadata: SessionTable.metadata })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  const existing = readStored(row.metadata)
  if (existing.cwd?.absolute === cwd?.absolute && existing.cwd?.environment.id === cwd?.environment.id) return
  yield* db
    .update(SessionTable)
    .set({ metadata: writeStored(row.metadata, cwd) })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

/**
 * Experimental: resolves a typed cwd string in this Location (local path or paired machine path)
 * and verifies that the target exists and is a directory.
 */
export const locate = Effect.fn("SessionCwd.locate")(function* (text: string) {
  const access = yield* FileAccess.Service
  const target = yield* access.resolve({ path: text, kind: "directory" })
  const invalid = (message: string) => new CwdError({ cwd: text, message })
  const type = yield* Environment.typeFollowing(target.environment.files, target.absolute).pipe(
    Effect.catchTag("Environment.NotFound", () => Effect.fail(invalid(`Working directory does not exist: ${text}`))),
    Effect.catchTag("Environment.Failed", () => Effect.fail(invalid(`Unable to read working directory: ${text}`))),
  )
  if (type !== "directory") return yield* invalid(`Working directory is not a directory: ${text}`)
  return { absolute: target.absolute, environment: { id: target.environment.id } } satisfies Environment.Place
})

/**
 * Build once in a Location layer (or call `SessionCwd.current` directly where Location services are in context).
 * Resolves a session's stored cwd to its bound environment when the `machines` flag is on.
 */
export const make = Effect.gen(function* () {
  const database = Option.getOrUndefined(yield* Effect.serviceOption(Database.Service))
  const flags = Option.getOrUndefined(yield* Effect.serviceOption(Flag.Service))
  const environment = Option.getOrUndefined(yield* Effect.serviceOption(Environment.Service))
  const machines = Option.getOrUndefined(yield* Effect.serviceOption(Machines.Service))

  const resolve = Effect.fn("SessionCwd.current")(function* (sessionID: SessionSchema.ID) {
    if (!database || !flags || !environment) return undefined
    if (!(yield* flags.enabled("machines"))) return undefined
    const cwd = yield* read(database.db, sessionID)
    if (!cwd) return undefined
    if (cwd.environment.id === environment.id) return { absolute: cwd.absolute, environment }
    if (!machines) return undefined
    const machine = yield* machines
      .get(cwd.environment.id)
      .pipe(Effect.catchTag("Machines.NotFound", (error) => Effect.succeed(missingMachine(cwd.environment.id, error))))
    return { absolute: cwd.absolute, environment: machine }
  })

  return { current: resolve }
})

export const current = Effect.fn("SessionCwd.current")(function* (sessionID: SessionSchema.ID) {
  const resolver = yield* make
  return yield* resolver.current(sessionID)
})

// A session whose cwd names a removed machine must fail loudly rather than silently falling back to this server.
const missingMachine = (id: Environment.ID, error: Machines.NotFound): Environment.Interface => {
  const spawner = ChildProcessSpawner.make(() =>
    Effect.fail(
      PlatformError.systemError({
        _tag: "Unknown",
        module: "Machine",
        method: "spawn",
        description: error.message,
        cause: error,
      }),
    ),
  )
  const fail = (path: string) => Effect.fail(new Environment.Failed({ path, cause: error }))
  return Environment.make(
    id,
    {
      spawner,
      overrides: {
        read: (path) => fail(path),
        write: (path) => fail(path),
        stat: (path) => fail(path),
        list: (path) => fail(path),
        remove: (path) => fail(path),
        move: (from) => fail(from),
        mkdir: (path) => fail(path),
        append: (path) => fail(path),
      },
    },
    { path: posix, shell: "sh" },
  )
}
