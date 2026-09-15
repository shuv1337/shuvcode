# Offline test credential import

Prerequisite helper only. Implementing or dry-running it is **not** permission to
read live credentials. Obtain the separate shutdown/import approval in Setup 3a
before pointing either command at a real credential source. No refresh-ownership
transfer is supported. Never use shell tracing with credential work.

From `packages/core`, after approval and with the source owner stopped:

```sh
bun run script/import-test-auth.ts \
  --source /absolute/checkpointed-source/opencode.db \
  --target /absolute/new-private-test-root \
  --window-end 2026-09-15T16:00:00-07:00 \
  --dry-run
```

Replace the timestamp with the intended test window's **future** end, including
its explicit Pacific UTC offset (`-07:00` PDT or `-08:00` PST). Repeat the same
command without `--dry-run` to publish. The parent directory must already exist;
the final target must not exist, even as an empty directory or dangling symlink.
Dry-run performs the same input/provider/expiry checks but writes nothing.

Output is JSON containing only provider IDs, counts, generated account aliases,
credential types and active aliases. Labels, emails, source IDs, paths, keys and
tokens never appear. Failures print a fixed message; there is intentionally no
raw-schema/SQL debug mode. Investigate input schemas locally without dumping
secret records.

## Source and mappings

The preferred source is the existing SQLite `credential` table with columns
`id`, `integration_id`, `connector_id`, `method_id`, `label`, `value`, `active`,
`time_created`. `value` must decode as the current typed Credential.Value.
The helper reads file bytes into a readonly in-memory SQLite connection; it
never opens or migrates the source database as a writable SQLite connection.
A nonempty WAL or rollback journal is rejected: arrange a clean checkpoint
through the source owner's normal approved shutdown procedure, never delete
sidecars to bypass the check. Source mutation during import is unsupported;
keep its owner stopped. Source symlinks are rejected.

All three providers are mandatory:

- `openrouter`: nonempty `key` credential; metadata/configuration preserved.
- `anthropic`: OAuth `claude-pro-max`; historical `anthropic` method normalizes
  to `claude-pro-max`. Existing `sk-ant-oat…` setup-token keys are also accepted
  as subscription auth, unchanged. Ordinary Anthropic API keys are rejected;
  no expiry or refresh capability is invented for setup tokens.
- `google`: OAuth `google-ai-pro` and nonempty `metadata.projectId`.

All matching accounts are retained, including inactive accounts; unrelated
providers are omitted. Every imported OAuth access token must be nonempty and
have an absolute Unix-millisecond expiry at least **window end + five minutes**.
This validates stored fields, not remote token validity. Metadata is preserved,
with `shuvcodeAuthImport: 'access-only'` added/overwritten; top-level `refresh`
is always the empty string. No network call or refresh is attempted. The central
connection guard must enforce this marker before any provider refresh; expired
or near-expiry imported credentials are not usable for refresh tests.

Effective selection follows Core's ordering: active flag, creation time, then
source ID, taking the maximum (null flags sort before false). Target IDs are
new. Labels and values are preserved and effective selections are explicitly
activated after all creates; selection persists across restart.

Optional `--mapping /absolute/nonsecret-mapping.json`:

```json
{
  "accounts": {
    "cred_unplaced": { "integrationID": "anthropic", "methodID": "claude-pro-max" }
  },
  "active": { "anthropic": "cred_selected" }
}
```

Use actual source record IDs locally, never tokens. Account mappings can place
unplaced rows or resolve a generic `oauth` method. Conflicting known placement
or methods, unknown providers/methods, missing IDs or invalid selections fail
closed. Active mappings may select any imported account for that provider.
No mapping means preserve the effective source selection.

## Optional complete legacy Google accounts

Only if the database contains no Google credentials, explicitly supply
`--legacy-accounts /absolute/antigravity-accounts.json`. This does not discover
HOME, IDE state databases, or other account stores. Accepted JSON is:

```json
{
  "activeIndex": 0,
  "accounts": [
    {
      "accessToken": "<access token>",
      "expires": 1790000000000,
      "projectId": "<Cloud Code project>",
      "email": "optional-label@example.test",
      "metadata": { "optional": "preserved" }
    }
  ]
}
```

The complete-field spellings correspond to the old OAuth adapter's
`accessToken`, absolute `expires`, `projectId`, and account-list `activeIndex`.
The old refresh-only account-list format does **not** establish a usable access
snapshot: missing access/absolute expiry/project is rejected, even if it has a
refresh token or relative `expires_in`. All accounts must be complete; none are
silently dropped. No refresh token is copied, including legacy `refreshToken`.
Legacy source aliases for explicit selection are `legacy-google-0`, etc.
A simultaneous authoritative Google database record is rejected rather than
merging two potentially divergent selections.

## Isolation and publication

A mode-0700 sibling staging root contains fully private Global paths (home,
data, config, state, cache, tmp, bin, log, repos). No normal-root `auth.json` is
read. The only service graph is Credential → Database + Bus, with private
Global overrides; no server, SDK, plugin, sessions or execution runner starts.
The target DB is `TARGET/opencode.db`. Database and sidecars are mode 0600;
directories are 0700. SQLite is closed before staging is atomically renamed to
the target. Errors clean up staging and leave no published target. An existing
target is never intentionally reused or replaced. Keep the destination parent
private and do not run concurrent importers targeting the same name.

The helper does not copy config or create a wrapper. The live-test owner must
wire the resulting private paths into its separately reviewed wrapper and
verify imported accounts resolve rather than environment-key fallbacks.

Offline synthetic verification:

```sh
cd packages/core
bun test test/credential-import.test.ts
bun typecheck
```
