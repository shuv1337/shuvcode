# PR 364 follow-up review

Reviewed against the original PR base `6829c0e589` and head `9a386b34`, including
[the review comment](https://github.com/Latitudes-Dev/shuvcode/pull/364#issuecomment-5579769199).
The follow-up also merges `integration-v2` at `ea995555`, preserving both event
retention and ticketed PTY handoff. No release is part of this work.

## Standards

- Fixed the prohibited import alias in the execution probe.
- Unified the repeated exact form-receipt match predicate; both the initial
  terminal read and conditional-write race now use the same comparison.
- Closed a temporary-directory cleanup gap when a CLI retention fixture fails
  during setup or startup.
- Left the two scenario-specific CLI launch fixtures separate; extracting a
  shared harness is not required for this correction. Retained the stored
  permission agent field rather than introduce unrelated migration churn.

One documented-standard violation and one cleanup defect were addressed.
The other observations are refactoring heuristics, not blocking violations.

## Contract and PR comments

1. **Orphan retention / global IDs: partially agree.** Cross-Location creation
   conflicts were undocumented. The contract now states that IDs are globally
   unique per request kind and retained IDs cannot be recreated. Cross-Location
   collision tests prove that creation fails without exposing the other
   Location's receipt. Foreign-runtime pending rows deliberately remain
   unavailable, even when old; a generation mismatch cannot prove the owner is
   dead. Tests lock that behavior. Automatic orphan GC or owner takeover is a
   separate lifecycle policy, not a safe change to make in this review.
2. **Permission duplicate defects: agree, fixed.** `ask` and `assert` now report
   typed `Permission.AlreadyExistsError`. HTTP create maps it to the existing
   `ConflictError` / 409 rather than 500, without overwriting the original
   request, waiter, or receipt. The new core regression failed four cases before
   the fix and passed afterward; the HTTP test covers pending and settled IDs.
3. **Stale OpenAPI: agree, fixed.** Protocol's generated check reproduced the
   failure. Ran the Client and Protocol generators and WWW OpenAPI generator.
   Protocol/WWW generated checks pass, and a second Client generation is
   byte-identical. Receipt routes, response IDs, and create conflicts are exposed.
4. **Coverage gaps: agree in part, filled.** Added focused permission reopen,
   exact replay without repeat grant/event effects, changed-payload rejection,
   graceful cancellation, foreign-pending fencing/non-expiry, and retained-ID
   collision tests. The existing CLI SIGKILL coverage remains and passes.

Two confirmed implementation/artifact defects were fixed. Two related contract
and coverage concerns were clarified and tested. No callback resurrection or
startup model-execution recovery was introduced.

## Verification

Using Bun 1.4.1, from the relevant package directories:

- Core form, permission, request-recovery, MCP and websearch: 200 tests passed.
- Server permission-conflict HTTP regression: 1 test passed.
- CLI event-persistence and request-receipt process tests: 7 tests passed.
- Core database migration and Drizzle tests: 30 tests passed.
- CLI service lifecycle, registration, and persistent-terminal restart: 26 tests passed.
- Core, CLI, Protocol, Schema, Server, and Client typechecks passed.
- Targeted Prettier and Oxlint: no errors; existing warning patterns remain.
- Client generation reproducibility and Protocol/WWW generated checks passed.

Initial integration checks caught old tuple-style LayerNode test overrides and a
missing PluginHooks fixture dependency. Both were corrected; final checks above
passed. These results are focused validation, not a full-workspace test rerun.
