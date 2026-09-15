export * as CredentialImport from "./import.js"

import { readFile, lstat, mkdtemp, mkdir, chmod, rename, rm, readdir } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { Effect, Layer, Logger, Schema } from "effect"
import { Integration } from "@opencode/schema/integration"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Credential } from "../credential.js"
import { Database } from "../database/database.js"

const Provider = Schema.Literals(["openrouter", "anthropic", "google"])
const Mapping = Schema.Struct({
  accounts: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        integrationID: Provider,
        methodID: Schema.optional(Schema.Literals(["claude-pro-max", "google-ai-pro"])),
      }),
    ),
  ),
  active: Schema.optional(
    Schema.Struct({
      openrouter: Schema.optional(Schema.String),
      anthropic: Schema.optional(Schema.String),
      google: Schema.optional(Schema.String),
    }),
  ),
})
const Options = Schema.Struct({
  source: Schema.String,
  target: Schema.String,
  windowEnd: Schema.Number,
  legacyAccounts: Schema.optional(Schema.String),
  mapping: Schema.optional(Mapping),
  dryRun: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

const Row = Schema.Struct({
  id: Schema.String,
  integration_id: Schema.NullOr(Schema.String),
  connector_id: Schema.NullOr(Schema.String),
  method_id: Schema.NullOr(Schema.String),
  label: Schema.String,
  value: Schema.String,
  active: Schema.NullOr(Schema.Literals([0, 1])),
  time_created: Schema.Number,
})
const Legacy = Schema.Struct({
  activeIndex: Schema.Number,
  accounts: Schema.Array(
    Schema.Struct({
      accessToken: Schema.String,
      expires: Schema.Number,
      projectId: Schema.String,
      email: Schema.optional(Schema.String),
      metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
})
const providers = ["openrouter", "anthropic", "google"] as const

// Only fixed messages cross this boundary: schema errors and SQLite errors contain secrets.
export class ImportError extends Error {
  constructor() {
    super(
      "Credential import rejected; verify explicit paths, source schema, provider mapping, expiry window and private target. No target was published.",
    )
    this.name = "CredentialImportError"
  }
}

/** Offline only. Does not discover HOME, load plugins, refresh tokens, or read sessions. */
export async function run(input: unknown) {
  return perform(input).catch(() => {
    throw new ImportError()
  })
}

async function perform(input: unknown) {
  const options = Schema.decodeUnknownSync(Options)(input)
  if (![options.source, options.target, ...(options.legacyAccounts ? [options.legacyAccounts] : [])].every(isAbsolute))
    throw new Error("paths")
  if (!Number.isSafeInteger(options.windowEnd) || options.windowEnd < Date.now()) throw new Error("window")
  const target = resolve(options.target)
  if (await exists(target)) throw new Error("target")
  const rows = await readSource(options.source)
  const mapped = options.mapping?.accounts ?? {}
  if (Object.keys(mapped).some((id) => !rows.some((row) => row.id === id))) throw new Error("mapping")
  const accounts = rows.flatMap((row) => {
    const provider = mapped[row.id]?.integrationID ?? row.integration_id ?? row.connector_id
    if (!providers.some((id) => id === provider)) {
      // Unrelated providers are not imported. Unplaced records require an explicit mapping.
      if (!provider) throw new Error("placement")
      return []
    }
    const integrationID = Schema.decodeUnknownSync(Provider)(provider)
    const value = Schema.decodeUnknownSync(Schema.fromJsonString(Credential.Value))(row.value)
    const method = value.type === "oauth" ? (mapped[row.id]?.methodID ?? value.methodID) : undefined
    if (mapped[row.id]?.integrationID && row.integration_id && row.integration_id !== integrationID)
      throw new Error("conflicting placement")
    if (
      value.type === "oauth" &&
      mapped[row.id]?.methodID &&
      value.methodID !== "oauth" &&
      value.methodID !== method &&
      !(integrationID === "anthropic" && value.methodID === "anthropic" && method === "claude-pro-max")
    )
      throw new Error("conflicting method")
    if (
      value.type === "key" &&
      (!value.key.trim() ||
        mapped[row.id]?.methodID ||
        !(integrationID === "openrouter" || (integrationID === "anthropic" && value.key.startsWith("sk-ant-oat"))))
    )
      throw new Error("key")
    if (
      value.type === "oauth" &&
      !(
        (integrationID === "anthropic" && (method === "anthropic" || method === "claude-pro-max")) ||
        (integrationID === "google" && method === "google-ai-pro")
      )
    )
      throw new Error("method")
    return [
      {
        sourceID: row.id,
        integrationID,
        label: row.label,
        value: value.type === "key" ? value : accessOnly(value, integrationID, options.windowEnd),
        active: row.active,
        created: row.time_created,
      },
    ]
  })
  // The database is authoritative; never overlay a second Google account store.
  if (options.legacyAccounts) {
    if (accounts.some((account) => account.integrationID === "google")) throw new Error("duplicate source")
    const legacy = Schema.decodeUnknownSync(Schema.fromJsonString(Legacy))(
      await readFile(options.legacyAccounts, "utf8"),
    )
    if (!Number.isInteger(legacy.activeIndex) || legacy.activeIndex < 0 || legacy.activeIndex >= legacy.accounts.length)
      throw new Error("selection")
    accounts.push(
      ...legacy.accounts.map((account, index) => ({
        sourceID: `legacy-google-${index}`,
        integrationID: "google" as const,
        label: account.email ?? `Google account ${index + 1}`,
        value: accessOnly(
          Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("google-ai-pro"),
            access: account.accessToken,
            refresh: "",
            expires: account.expires,
            metadata: {
              ...account.metadata,
              projectId: account.projectId,
              ...(account.email ? { email: account.email } : {}),
            },
          }),
          "google",
          options.windowEnd,
        ),
        active: index === legacy.activeIndex ? (1 as const) : (0 as const),
        created: index,
      })),
    )
  }
  if (new Set(accounts.map((account) => account.sourceID)).size !== accounts.length) throw new Error("duplicates")
  const selections = providers.map((provider) => {
    const candidates = accounts.filter((account) => account.integrationID === provider)
    if (!candidates.length) throw new Error("required provider")
    const explicit = options.mapping?.active?.[provider]
    const selected = explicit
      ? candidates.find((account) => account.sourceID === explicit)
      : candidates
          .toSorted(
            (a, b) =>
              (a.active ?? -1) - (b.active ?? -1) ||
              a.created - b.created ||
              (a.sourceID < b.sourceID ? -1 : a.sourceID > b.sourceID ? 1 : 0),
          )
          .at(-1)
    if (!selected) throw new Error("selection")
    return selected
  })
  const summary = {
    dryRun: options.dryRun ?? false,
    accounts: accounts.length,
    providers: providers.map((provider) => ({
      provider,
      count: accounts.filter((account) => account.integrationID === provider).length,
      // Generated aliases only: user labels and source IDs may themselves contain secrets.
      active: `account-${accounts.indexOf(selections.find((account) => account.integrationID === provider)!) + 1}`,
      type:
        provider === "openrouter"
          ? "key"
          : selections.find((account) => account.integrationID === provider)?.value.type === "key"
            ? "setup-token"
            : "oauth-access-only",
    })),
  }
  if (options.dryRun) return summary
  const stage = await mkdtemp(join(dirname(target), ".credential-import-"))
  try {
    await chmod(stage, 0o700)
    const globals = privateGlobal(stage)
    await Promise.all(
      [...new Set(Object.values(globals))].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
    )
    // Precreate the database privately; WAL/SHM inherit its permissions.
    await Bun.write(join(stage, "opencode.db"), new Uint8Array(), { mode: 0o600 })
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const created = yield* Effect.forEach(accounts, (account) =>
          credentials.create({
            integrationID: Integration.ID.make(account.integrationID),
            label: account.label,
            value: account.value,
          }),
        )
        yield* Effect.forEach(selections, (selected) => credentials.activate(created[accounts.indexOf(selected)]!.id))
      }).pipe(Effect.provide(privateLayer(stage)), Effect.provideService(Logger.CurrentLoggers, new Set())),
    )
    // Effect.provide closes the scoped SQLite connection before publication.
    await secureTree(stage)
    if (await exists(target)) throw new Error("target")
    await rename(stage, target)
    return summary
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

function accessOnly(value: Credential.OAuth, provider: string, windowEnd: number) {
  if (!value.access.trim() || !Number.isSafeInteger(value.expires) || value.expires < windowEnd + 300_000)
    throw new Error("expiry")
  if (provider === "google" && (typeof value.metadata?.projectId !== "string" || !value.metadata.projectId.trim()))
    throw new Error("project")
  return Schema.decodeUnknownSync(Credential.OAuth)({
    ...value,
    methodID: provider === "anthropic" ? "claude-pro-max" : "google-ai-pro",
    refresh: "",
    metadata: { ...value.metadata, shuvcodeAuthImport: "access-only" },
  })
}

async function exists(path: string) {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false
      throw error
    },
  )
}

async function readSource(path: string) {
  if (!(await lstat(path)).isFile()) throw new Error("source")
  // Read bytes, not a SQLite file connection: even readonly SQLite can create SHM files.
  // A stopped, checkpointed source is required; ignoring a WAL would lose account selection.
  for (const suffix of ["-wal", "-journal"]) {
    if (await exists(path + suffix)) {
      if ((await lstat(path + suffix)).size) throw new Error("uncheckpointed source")
    }
  }
  const bytes = await readFile(path)
  if (bytes.subarray(0, 16).toString() !== "SQLite format 3\0") throw new Error("sqlite")
  // A checkpointed WAL-mode file is a complete database; deserialize needs rollback mode.
  bytes[18] = 1
  bytes[19] = 1
  const sqlite = await import("bun:sqlite")
  const db = sqlite.Database.deserialize(bytes, { readonly: true })
  try {
    return Schema.decodeUnknownSync(Schema.Array(Row))(
      db
        .query("SELECT id, integration_id, connector_id, method_id, label, value, active, time_created FROM credential")
        .all(),
    )
  } finally {
    db.close()
  }
}

/** Every Global field is private, including the migration's data/auth.json lookup. */
export function privateGlobal(root: string): Global.Interface {
  return {
    home: join(root, "home"),
    data: root,
    config: join(root, "config"),
    state: join(root, "state"),
    cache: join(root, "cache"),
    tmp: join(root, "tmp"),
    bin: join(root, "cache", "bin"),
    log: join(root, "log"),
    repos: join(root, "repos"),
  }
}

export function privateLayer(root: string) {
  return LayerNode.compile(Credential.node, {
    replacements: [
      Global.node.replace(Layer.succeed(Global.Service, privateGlobal(root))),
      Database.node.replace(Database.configured({ path: join(root, "opencode.db") })),
    ],
  })
}

async function secureTree(root: string): Promise<void> {
  await chmod(root, 0o700)
  await Promise.all(
    (await readdir(root, { withFileTypes: true })).map((entry) =>
      entry.isDirectory() ? secureTree(join(root, entry.name)) : chmod(join(root, entry.name), 0o600),
    ),
  )
}
