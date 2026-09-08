# Durable native request receipts

Observed 2026-09-07 on the local `reply-routing-recovery` worktree, based on
`6829c0e589f73ed105a60b002b2535aed04847d3` (shuvcode alpha-19). These are
candidate changes. The elected host service and installed release
have not been changed.

## Behavior

Forms and permissions now commit their request and terminal outcome to SQLite.
A conditional update from `pending` chooses the first reply before callbacks or
notification listeners run. Permission `always` grants commit in the same
transaction as their receipt. A failing observer cannot erase an admitted
request, undo an accepted answer, or keep its waiter blocked. A policy hook
that yields must still win the conditional update before auto-approving another
pending request.

The additive authenticated endpoints are:

- `GET /api/session/:sessionID/form/:formID/receipt`
- `GET /api/session/:sessionID/permission/:requestID/receipt`

Each returns `{ data: { request, state, available, responseID?, time } }`.
`available` is true only for a pending callback owned by the serving Location
runtime. The directory and optional workspace identity must match exactly, and
the HTTP route enforces session ownership. The temporary MCP `global` form
owner retains its existing exact-Location behavior.

Reply bodies accept optional `responseID` strings of 1–200 characters. A retry
with the same request, response ID, and complete answer (including permission
feedback) acknowledges the retained answer without another side effect, even
after restart. Changing that payload or using another response ID does not
replace the winner. Form conflicts remain 409; ordinary late permission replies
retain the previous 404 behavior. Existing callers may omit the response ID.

Existing pending list/get behavior for permissions and pending list behavior
for forms remain unchanged. Listing session requests still does not load an
unloaded Location. Form get/state additionally recover stored terminal records.
The client and website OpenAPI generators were run after the additive protocol
changes.

## Restart and retention contract

A graceful Location shutdown records cancellation for its own remaining
callbacks. After process death, an unresolved request remains `pending` with
`available: false`; an exact retained answer remains queryable and replayable.
A different generation does not prove that the old process is dead, so reading
from another runtime never cancels it or resurrects its callback.

An accepted receipt proves durable answer admission, not successful continuation
of the tool or model. A crash after commit but before the callback runs can
leave interrupted execution. Existing execution claims remain inert on restart;
this change does not automatically replay provider work.

Terminal receipts are retained for seven days, with lazy cleanup on request
operations. Pending requests do not expire merely because another runtime reads
them. After a terminal receipt expires, absence is unknown and is not permission
to resend an old action. Receipts include request/answer content and live in the
same protected local database as session history. The tests establish process
crash recovery using the existing SQLite settings, not power-loss durability.

Form and permission notifications remain ephemeral. Reconcile known request IDs
through receipts and live pending inventories after a feed disconnect. For
session lifecycle replay, separately enable the documented
[CLI event retention option](event-persistence.md).

## Evidence

The initial form regression failed on reopen with `Form.NotFoundError`. The
original form and permission event-listener races allowed competing replies;
the deferred-listener regression cases now pass. The permission policy test
also proves that a later hook continuation cannot overwrite an intervening
reply. A real SQLite trigger failure proves grant/receipt rollback together.

From `packages/core`:

```sh
bun run test test/form.test.ts test/permission.test.ts test/request-recovery.test.ts
bun run test test/mcp.test.ts test/plugin/websearch.test.ts
```

From `packages/cli`:

```sh
bun test test/request-receipts.test.ts
```

The real HTTP test passes 34 assertions: reply-ID bounds, retained outcomes,
exact replay after `SIGKILL`, changed-payload rejection, unavailable pending
callbacks, and session/Location isolation. The same test passes against the
compiled candidate with `SHUV_RECEIPT_BINARY` set to its path.

The [execution probe](execution/README.md) also runs the actual compiled TUI in
a disposable PTY. The TUI submits the first prompt, another HTTP client queues a
follow-up, the TUI renders its completion, and native question/permission replies
produce durable receipts that reject competing late HTTP responses. This is
native TUI evidence; it does not prove Herdr transport or physical phone input.
