# Busy queue and wake execution proof

The earlier execution timeout was caused by the probe's provider configuration. No execution, runner, or inbox runtime change is needed for the behavior tested here. The corrected probe passes on the installed `shuvcode v2.0.0-alpha-19` binary and on the source CLI in this checkout (`shuvcode vlocal`, base commit `6829c0e589f73ed105a60b002b2535aed04847d3`). Both runs complete 22 assertions and make exactly two synthetic model requests.

## Diagnosis

The original fixture admitted and promoted its input but never reached its local model endpoint. Its plural `providers` configuration specified the package as `@ai-sdk/openai-compatible`. In V2, an AI SDK package needs the `aisdk:` prefix. Without that prefix, `ModelResolver.resolveCatalogModel` follows the native provider package loader, rather than the AI SDK mapping. The provider never reaches the intended model transport. Existing provider configuration and model resolver tests already use `aisdk:@ai-sdk/openai-compatible`.

Changing only the package string to `aisdk:@ai-sdk/openai-compatible` made the installed runtime reach the loopback model. That run made three calls because a second fixture setting enabled unrelated compaction: its 8,192-token context limit was below the default 20,000-token compaction reserve. `SessionCompaction.required` computes its prompt ceiling from that reserve. After the first response, the tiny fixture model therefore introduced an automatic compaction call. Raising the fixture context limit to 200,000 isolates queue execution and produces exactly two calls. This does not change production compaction behavior.

The broad original probe also recorded `noAdditionalModelCall: false` without asserting it, while still labelling the overall run passed. This replacement asserts every required result and exits nonzero on a mismatch.

The minimized red case retains the valid larger context and changes only the provider package back to its original unprefixed form. It receives HTTP 200 admission but makes zero model calls and exits with the expected timeout. `installed-legacy-package.json` records that failure. `installed-execution.json` and `source-execution.json` record the corrected result; the installed binary's SHA-256 is included.

## Verified public behavior

The agreed test seams are the V2 HTTP session endpoints and the external model transport. Internal services and database projections are not mocked or queried.

1. A normal prompt wakes an idle session and reaches the fake model. The model holds that request open so active execution is observable.
2. A second queued prompt is admitted while the first is busy. It remains in `/inbox`, and no parallel model request starts.
3. Replaying that pending ID with changed text and delivery mode returns the original receipt. The original queue placement and payload win.
4. Releasing the first model response lets both inputs complete serially. `/wait` settles, `/active` no longer contains the session, and `/context` contains user/assistant/user/assistant with completed native assistant messages.
5. Replaying an already promoted input preserves its original text and ID and starts no further model work, both with `resume: false` and with the normal advisory wake.
6. After an abrupt process restart, the completed transcript remains intact. Replaying the promoted ID again creates no duplicate model call or message.

The two provider requests are observed at the loopback HTTP boundary. Completion is independently verified through the native session transcript and active-session API; admission or an empty inbox alone is not treated as completion.

## Reproduce

Run these commands from the checkout root after dependencies are installed:

```sh
node docs/research/reply-routing/execution/probe.mjs --legacy-package
node docs/research/reply-routing/execution/probe.mjs
node docs/research/reply-routing/execution/probe.mjs --source
node docs/research/reply-routing/execution/verify.mjs
```

The first command intentionally exits 1. The other commands should exit 0. `--small-context` reproduces the unrelated compaction interference and intentionally fails the two-call assertion; it is a diagnosis aid rather than an additional passing gate.

Source mode uses the repository's normal `packages/cli` working directory so Bun loads its JSX preload. Every actual test session has an explicit disposable project location. Each server receives a fresh HOME, XDG directories, config, database, synthetic local password, and synthetic model key. A nested disposable Git root prevents project discovery from walking into unrelated checkouts. macOS `sandbox-exec` denies non-loopback networking. The probe invokes `serve --stdio` directly, never an installed host service. Cleanup stops its own child and removes its temporary state.

The raw model requests, authorization headers, and system instructions are not retained. Evidence contains synthetic receipts, message IDs, completion fields, counts, and selected transport metadata only. No paid model call, real notification, host-service restart, schema change, or public protocol change is involved.

## Scope and remaining limits

This closes the earlier **busy/wake/promoted-input execution probe** gap. It does not establish durable form or permission receipts, retained event recovery, distributed ownership, automatic recovery of a model request interrupted by process death, or physical phone delivery. Those are separate workstreams. The restart case here covers already-completed inputs and their idempotent replay; it does not restart unfinished model work.

Relevant source boundaries are `packages/core/src/provider.ts`, `packages/core/src/model-resolver.ts`, `packages/core/src/session/compaction.ts`, `packages/core/src/session/execution.ts`, `packages/core/src/session/run-coordinator.ts`, `packages/core/src/session/runner/llm.ts`, and `packages/core/src/session/inbox.ts`. They were inspected, not modified by this subtask.

## Compiled candidate and native TUI acceptance

The compiled reply-routing candidate additionally passes `candidate-execution.json`
(22 assertions) and `candidate-native-tui.json` (30 assertions). Both use exactly
two loopback model requests. Run them from the repository root with:

```sh
SHUV_EXECUTION_BINARY=/path/to/candidate/shuvcode node docs/research/reply-routing/execution/probe.mjs
SHUV_EXECUTION_BINARY=/path/to/candidate/shuvcode bun docs/research/reply-routing/execution/probe.mjs --tui
```

The TUI variant attaches the real native client to a seeded session through an
explicit server URL, submits its first input, and stays attached while the HTTP
client queues a follow-up. It checks the TUI's rendered completion and accepts a
synthetic boolean question and a synthetic permission request through actual
terminal input. Their stored receipts reject late competing HTTP replies. It
then checks completed-input replay and restart without extra model calls. The
question/permission fixtures do not execute a shell command. Terminal output and
credentials are not retained; the evidence records only synthetic assertions and
output byte counts.

This proves native TUI/HTTP cooperation on the candidate. It does not prove
Herdr passthrough, automatic enrollment of an unconfigured desktop owner, or
phone UI behavior. The candidate's binary hash is recorded in each evidence file.
