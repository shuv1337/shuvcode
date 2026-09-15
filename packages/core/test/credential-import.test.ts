import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { Effect, Logger } from "effect"
import { CredentialImport } from "../src/credential/import"
import { Credential } from "../src/credential"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "credential-import-test-"))
  roots.push(root)
  const source = join(root, "source.db")
  const target = join(root, "target")
  const windowEnd = Date.now() + 60_000
  const oauth = (methodID: string, account: string) => ({
    type: "oauth",
    methodID,
    access: `secret-access-${account}`,
    refresh: `secret-refresh-${account}`,
    expires: windowEnd + 600_000,
    metadata: { email: `${account}@example.test`, projectId: "test-project", custom: { retained: true } },
  })
  const db = new Database(source)
  db.exec(
    "CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, connector_id TEXT, method_id TEXT, label TEXT, value TEXT, active INTEGER, time_created INTEGER)",
  )
  const insert = db.query("INSERT INTO credential VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)")
  insert.run(
    "router",
    "openrouter",
    "secret-key-label",
    JSON.stringify({ type: "key", key: "secret-router", metadata: { organization: "test" } }),
    1,
    1,
  )
  insert.run("claude-old", "anthropic", "Old Claude", JSON.stringify(oauth("anthropic", "old")), 1, 1)
  insert.run("claude-new", "anthropic", "New Claude", JSON.stringify(oauth("claude-pro-max", "new")), 0, 2)
  insert.run("google", "google", "Google", JSON.stringify(oauth("google-ai-pro", "google")), null, 1)
  db.exec(
    "CREATE TABLE session_v2 (id TEXT); INSERT INTO session_v2 VALUES ('secret-source-session'); CREATE TABLE execution_claim (id TEXT); INSERT INTO execution_claim VALUES ('secret-source-claim')",
  )
  db.close()
  return { root, source, target, windowEnd }
}

async function credentials(root: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Credential.Service
      return yield* service.all()
    }).pipe(
      Effect.provide(CredentialImport.privateLayer(root)),
      Effect.provideService(Logger.CurrentLoggers, new Set()),
    ),
  )
}

function mutate(source: string, sql: string) {
  const db = new Database(source)
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}

async function rejected(input: Awaited<ReturnType<typeof fixture>>) {
  const before = await readFile(input.source)
  const error = await CredentialImport.run(input).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(CredentialImport.ImportError)
  expect(String(error)).not.toContain("secret")
  expect(String(error)).not.toContain(input.source)
  expect(await Bun.file(join(input.target, "opencode.db")).exists()).toBe(false)
  expect(await readdir(input.root)).not.toContain("target")
  expect((await readdir(input.root)).some((name) => name.startsWith(".credential-import-"))).toBe(false)
  expect(await readFile(input.source)).toEqual(before)
}

test("imports Claude setup tokens as subscription keys without inventing expiry or refresh state", async () => {
  const input = await fixture()
  const db = new Database(input.source)
  db.query("UPDATE credential SET value = ? WHERE id = 'claude-old'").run(
    JSON.stringify({ type: "key", key: "sk-ant-oat01-fixture-subscription" }),
  )
  db.close()
  const summary = await CredentialImport.run(input)
  expect(summary.providers.find((provider) => provider.provider === "anthropic")?.type).toBe("setup-token")
  expect((await credentials(input.target)).filter((row) => row.integrationID === "anthropic").at(-1)?.value).toEqual({
    type: "key",
    key: "sk-ant-oat01-fixture-subscription",
  })
})

test("imports typed credentials, metadata, all accounts and effective selection, with no refresh capability", async () => {
  const input = await fixture()
  const before = await readFile(input.source)
  const summary = await CredentialImport.run(input)
  expect(summary.accounts).toBe(4)
  expect(JSON.stringify(summary)).not.toContain("secret")
  expect(summary.providers.find((provider) => provider.provider === "anthropic")?.active).toBe("account-2")
  const first = await credentials(input.target)
  const second = await credentials(input.target)
  expect(first).toEqual(second)
  expect(first.filter((row) => row.integrationID === "anthropic").at(-1)?.label).toBe("Old Claude")
  expect(first.find((row) => row.integrationID === "openrouter")?.value).toEqual({
    type: "key",
    key: "secret-router",
    metadata: { organization: "test" },
  })
  for (const row of first.filter((row) => row.value.type === "oauth")) {
    expect(row.value).toMatchObject({
      refresh: "",
      expires: input.windowEnd + 600_000,
      metadata: { shuvcodeAuthImport: "access-only", custom: { retained: true } },
    })
    expect(String(row.value.type === "oauth" && row.value.methodID)).toBe(
      row.integrationID === "anthropic" ? "claude-pro-max" : "google-ai-pro",
    )
  }
  const db = new Database(join(input.target, "opencode.db"), { readonly: true })
  try {
    expect(db.query("SELECT count(*) AS count FROM session_v2").get()).toEqual({ count: 0 })
    const claims = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%claim%' OR name LIKE 'session_%')")
      .all() as { name: string }[]
    for (const table of claims)
      expect(db.query(`SELECT count(*) AS count FROM "${table.name}"`).get()).toEqual({ count: 0 })
  } finally {
    db.close()
  }
  async function permissions(path: string) {
    expect((await stat(path)).mode & 0o777).toBe(0o700)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await permissions(join(path, entry.name))
      else expect((await stat(join(path, entry.name))).mode & 0o777).toBe(0o600)
    }
  }
  await permissions(input.target)
  expect(await readFile(input.source)).toEqual(before)
  expect(await readdir(input.root)).toEqual(expect.arrayContaining(["source.db", "target"]))
  expect((await readdir(input.root)).filter((name) => name.startsWith("source.db"))).toEqual(["source.db"])
})

test("all Global fields are private and adjacent auth.json is never auto-imported", async () => {
  const input = await fixture()
  await Bun.write(join(input.root, "auth.json"), JSON.stringify({ openai: { type: "api", key: "secret-unrequested" } }))
  expect(
    Object.values(CredentialImport.privateGlobal(input.target)).every(
      (path) => path === input.target || path.startsWith(input.target + "/"),
    ),
  ).toBe(true)
  await CredentialImport.run(input)
  expect((await credentials(input.target)).map((account) => String(account.integrationID))).not.toContain("openai")
})

test("explicit placement resolves generic OAuth, but cannot reinterpret known incompatible methods", async () => {
  const input = await fixture()
  mutate(
    input.source,
    "UPDATE credential SET integration_id=NULL, value=json_set(value,'$.methodID','oauth') WHERE id='claude-old'",
  )
  const mapping = { accounts: { "claude-old": { integrationID: "anthropic", methodID: "claude-pro-max" } } }
  await CredentialImport.run({ ...input, mapping })
  expect((await credentials(input.target)).filter((account) => account.integrationID === "anthropic")).toHaveLength(2)
  await expect(
    CredentialImport.run({
      ...input,
      target: join(input.root, "conflicting"),
      mapping: {
        accounts: { ...mapping.accounts, google: { integrationID: "google", methodID: "claude-pro-max" } },
      },
    }),
  ).rejects.toBeInstanceOf(CredentialImport.ImportError)
})

test("dry-run validates without creating a target or staging tree", async () => {
  const input = await fixture()
  expect((await CredentialImport.run({ ...input, dryRun: true })).dryRun).toBe(true)
  expect(await readdir(input.root)).toEqual(["source.db"])
})

test("legacy null-active rows select newest, explicit nonsecret mapping selects older account", async () => {
  const input = await fixture()
  mutate(input.source, "UPDATE credential SET active=NULL WHERE integration_id='anthropic'")
  await CredentialImport.run(input)
  expect((await credentials(input.target)).filter((row) => row.integrationID === "anthropic").at(-1)?.label).toBe(
    "New Claude",
  )
  const target = join(input.root, "mapped")
  await CredentialImport.run({ ...input, target, mapping: { active: { anthropic: "claude-old" } } })
  expect((await credentials(target)).filter((row) => row.integrationID === "anthropic").at(-1)?.label).toBe(
    "Old Claude",
  )
})

test("checkpointed WAL-mode source is read from bytes without SQLite source side effects", async () => {
  const input = await fixture()
  mutate(input.source, "PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE)")
  const before = await readFile(input.source)
  await CredentialImport.run(input)
  expect(await readFile(input.source)).toEqual(before)
  expect((await readdir(input.root)).filter((name) => name.startsWith("source.db"))).toEqual(["source.db"])
})

for (const [name, sql] of [
  ["missing provider", "DELETE FROM credential WHERE integration_id='google'"],
  [
    "unknown method",
    "UPDATE credential SET value=json_set(value,'$.methodID','secret-unknown') WHERE integration_id='google'",
  ],
  ["wrong credential type", "UPDATE credential SET integration_id='anthropic' WHERE integration_id='openrouter'"],
  ["expired OAuth", "UPDATE credential SET value=json_set(value,'$.expires',1000) WHERE integration_id='google'"],
  [
    "relative seconds expiry",
    "UPDATE credential SET value=json_set(value,'$.expires',3600) WHERE integration_id='google'",
  ],
  [
    "missing project",
    "UPDATE credential SET value=json_remove(value,'$.metadata.projectId') WHERE integration_id='google'",
  ],
  ["invalid schema", "UPDATE credential SET value='secret-not-json' WHERE integration_id='google'"],
  ["missing access", "UPDATE credential SET value=json_set(value,'$.access','') WHERE integration_id='google'"],
])
  test(`rejects ${name} before staging without leaking or mutating source`, async () => {
    const input = await fixture()
    mutate(input.source, sql!)
    await rejected(input)
  })

test("enforces the full window plus five minutes for every account, including inactive ones", async () => {
  const input = await fixture()
  mutate(
    input.source,
    `UPDATE credential SET value=json_set(value,'$.expires',${input.windowEnd + 299_999}) WHERE id='claude-new'`,
  )
  await rejected(input)
})

test("rejects existing target without modifying it", async () => {
  const input = await fixture()
  await CredentialImport.run(input)
  const before = await readFile(join(input.target, "opencode.db"))
  await expect(CredentialImport.run(input)).rejects.toBeInstanceOf(CredentialImport.ImportError)
  expect(await readFile(join(input.target, "opencode.db"))).toEqual(before)
})

test("rejects uncheckpointed source and invalid mappings and relative paths", async () => {
  const input = await fixture()
  await Bun.write(input.source + "-wal", "secret-wal")
  await rejected(input)
  await rm(input.source + "-wal")
  for (const patch of [
    { source: "source.db" },
    { target: "relative-target" },
    { windowEnd: NaN },
    { mapping: { active: { anthropic: "missing" } } },
    { mapping: { accounts: { missing: { integrationID: "google" } } } },
    { mapping: { accounts: { google: { integrationID: "unknown" } } } },
  ])
    await expect(CredentialImport.run({ ...input, ...patch })).rejects.toBeInstanceOf(CredentialImport.ImportError)
  expect(await readdir(input.root)).toEqual(["source.db"])
})

test("legacy adapter accepts only complete absolute-expiry accounts and preserves activeIndex", async () => {
  const input = await fixture()
  mutate(input.source, "DELETE FROM credential WHERE integration_id='google'")
  const legacyAccounts = join(input.root, "accounts.json")
  await Bun.write(
    legacyAccounts,
    JSON.stringify({
      activeIndex: 0,
      accounts: [0, 1].map((index) => ({
        email: `legacy${index}@example.test`,
        refreshToken: "secret-refresh-never-copied",
        accessToken: `secret-legacy-${index}`,
        expires: input.windowEnd + 300_000,
        projectId: "project",
        metadata: { custom: 42 },
      })),
    }),
  )
  const before = await readFile(legacyAccounts)
  await CredentialImport.run({ ...input, legacyAccounts })
  const google = (await credentials(input.target)).filter((row) => row.integrationID === "google")
  expect(google).toHaveLength(2)
  expect(google.at(-1)?.label).toBe("legacy0@example.test")
  expect(google[0]?.value).toMatchObject({
    refresh: "",
    metadata: { projectId: "project", custom: 42, shuvcodeAuthImport: "access-only" },
  })
  expect(await readFile(legacyAccounts)).toEqual(before)
})

test("refresh-only legacy account cannot trigger a refresh or publish an incomplete target", async () => {
  const input = await fixture()
  mutate(input.source, "DELETE FROM credential WHERE integration_id='google'")
  const legacyAccounts = join(input.root, "accounts.json")
  await Bun.write(
    legacyAccounts,
    JSON.stringify({
      activeIndex: 0,
      accounts: [{ refreshToken: "secret-refresh|project", email: "test@example.test" }],
    }),
  )
  await expect(CredentialImport.run({ ...input, legacyAccounts })).rejects.toBeInstanceOf(CredentialImport.ImportError)
  expect(await readdir(input.root)).not.toContain("target")
})

test("CLI prints only safe summary or fixed errors", async () => {
  const input = await fixture()
  const args = [
    "bun",
    "run",
    "script/import-test-auth.ts",
    "--source",
    input.source,
    "--target",
    input.target,
    "--window-end",
    new Date(input.windowEnd).toISOString(),
    "--dry-run",
  ]
  const success = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  expect(await success.exited).toBe(0)
  const stdout = await new Response(success.stdout).text()
  expect(JSON.parse(stdout).accounts).toBe(4)
  expect(stdout).not.toContain("secret")
  expect(await new Response(success.stderr).text()).toBe("")
  mutate(input.source, "UPDATE credential SET value='secret-invalid-json'")
  const failure = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  expect(await failure.exited).toBe(1)
  expect(await new Response(failure.stdout).text()).toBe("")
  expect(await new Response(failure.stderr).text()).toBe(new CredentialImport.ImportError().message + "\n")
})
