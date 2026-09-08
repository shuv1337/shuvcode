# CLI event retention recovery

Observed 2026-09-07 using Bun 1.3.14 and the source CLI on the
`reply-routing-recovery` branch, based on
`6829c0e589f73ed105a60b002b2535aed04847d3` (installed alpha-19 source).
These results describe the candidate source runtime. No installed binary or
elected host service was replaced or restarted.

## Regression and fix

The real CLI child accepted a synthetic prompt with `resume: false`, but its
authenticated session log contained no `session.inbox.enqueued` event even
when started with `OPENCODE_PERSIST_EVENTS=true`. Before the implementation,
`bun test test/event-persistence.test.ts` failed at the first event assertion:
expected `true`, received `false` (0 pass, 1 fail).

The CLI now passes the existing server `events.persist` option. The process
environment is authoritative, including explicit `false`; an unset environment
value falls back to `service.json`'s `env.OPENCODE_PERSIST_EVENTS` in managed
service mode. Without either setting it remains disabled. The saved fallback
also covers direct systemd `serve --service` startup, which does not inherit the
environment supplied to the `systemctl` caller.

No Bus defaults, event schema, protocol routes, generated clients, or request
settlement logic changed for this fix. Configuration and retention limits are
documented in [shared-service.md](../../shared-service.md#retaining-session-events).

## Verified behavior

All child runtimes use fresh configuration, state and databases in temporary
directories, loopback listeners, synthetic input and credentials, disabled
model downloads and automatic updates, and `resume: false`. They neither use an
external model nor send notifications. Every child is terminated and each
temporary directory removed by the test.

The regression checks that the ordered HTTP log is identical after `SIGKILL`
and restart. Reading after its captured cursor returns only the sync marker;
admitting another prompt then returns one new enqueue event with a higher
sequence. Both prompt IDs remain in the durable inbox. Separate real-process
cases cover standalone and managed defaults, foreground opt-in, the saved
managed setting, and explicit environment `false` overriding saved `true`.

From `packages/cli`:

```sh
bun test test/event-persistence.test.ts test/server-connection.test.ts
bun typecheck
```

Results: 8 tests passed, 25 assertions, no test failures; typecheck passed.
Formatting and `git diff --check` passed. Targeted Oxlint finished with zero
errors and two existing `consistent-return` warnings in `server-process.ts`.

This closes the source CLI configuration/replay blocker. It does not establish
installed-host activation, complete historical collection, a replayable global
feed, or durable form/permission outcomes. Retention begins when enabled and
does not backfill. Deleting a session removes its event aggregate, so a
disconnected consumer must reconcile deletion through authoritative session
lookup rather than expect its former log to retain the deletion event.
