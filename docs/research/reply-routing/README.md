# Reply-routing runtime candidate

This work fixes the shuvcode runtime gaps found during the SHark/SSHuv admission
spike. It lives in `/Volumes/shuvbot-repos/shuvcode-reply-recovery` on
`reply-routing-recovery`, based on alpha-19 commit
`6829c0e589f73ed105a60b002b2535aed04847d3`. The primary shuvcode checkout and its
unrelated files were preserved. The results below were captured before PR publication. No release, host activation,
or real notification was performed.

- [Event retention](event-persistence.md): supported opt-in for every CLI serve
  mode, including persisted service configuration, with crash/cursor replay.
- [Request receipts](request-receipts.md): first-answer atomicity, restart
  readback, exact response retries, and honest unavailable callbacks.
- [Execution and native TUI](execution/README.md): queued continuation and
  desktop/HTTP cooperation against a loopback model fixture.

## Validation

The source form/permission/recovery regressions pass, including real transaction
rollback and observer/policy races. MCP's 57 tests pass. The broader core rerun
passes **3,913 tests**, with 20 skipped, using a name filter excluding the
confirmed baseline `batches tool publication and suppresses terminal teardown
replay` failure. That exact failure also reproduces in an untouched worktree at
the base SHA. The initial unfiltered run passed 4,067 tests but found that
baseline failure and a missing Location binding in the websearch test fixture;
the fixture was fixed and its tests pass. These counts are reported per run.

The compiled candidate passes seven CLI receipt/event tests with **50
assertions**, including managed service configuration and `SIGKILL`. Its HTTP
execution probe passes 22 assertions; the native TUI variant passes **30
assertions**, including question and permission replies, with exactly two
loopback model calls. Fifteen selected server policy/options/event/workerd tests
pass, and the pending-request read test passes. Three unrelated OAuth-port tests
in the broader fetch file were blocked by an existing Python listener on 1455;
that listener was left alone.

Core, CLI, Client, and Server typechecks pass. Schema/Protocol typechecks and both
public generators pass. Targeted Oxlint has no errors (it reports warnings),
the touched production files pass the Effect-pattern checks, and diff checks
pass. The full standalone macOS ARM64 build, including web UI assets, succeeds.

## Candidate artifact and remaining acceptance

Binary: `/tmp/shuvcode-recovery-build/shuvcode-darwin-arm64/bin/shuvcode`

Version: `0.0.0-reply-routing-recovery-202609080357`

SHA-256: `b9c0ae94ca84b9e130b4f6ada94a35f544ea622016f189efccb5aeb8a3f64ba9`

The candidate uses a development channel. It was tested with fresh private
configuration and databases, and was not substituted into the elected host
service. Its runtime fixes do not themselves complete the SHark broker, Codex
or Claude admission, a global replayable notification feed, signed SSHuv
handoff, or Herdr passthrough. The current Codex task is outside a Herdr-managed
pane, so focused Herdr session control was not attempted.
