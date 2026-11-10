# Issue #474 follow-ups

Baseline: `0048b70a92` (`integration-v2`, `2.2.6-shuv.2`), including #477 and #479.
Compared #473's merge `76d5ab2b35` with its first parent and the baseline above.

## Disposition

| Item                            | Disposition                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree setup deadlines        | Fixed here                                    | `run.ts` still passed the unbounded client to `createWorktreeLocation`; `setup.ts` still omitted `worktree.create`. Both stalled lookup/create subprocess regressions required the watchdog to kill the old CLI. Both now exit 1 with the phase-specific timeout, without retrying or admitting a prompt.                                                                    |
| Experimental Evaluation headers | Fixed here                                    | Both experimental files were last changed by #473 (`35a5a12f77`). `EvaluationRequest` still dropped top-level headers and System One used only configuration headers. Both new outgoing-request tests failed with a missing sentinel before the fix.                                                                                                                         |
| MCP completion/refresh UI       | Resolved earlier                              | `f39aa60608` (upstream #62102), included in #477, replaces the settled boolean with the shared MCP sign-in machine. `complete` enters `completing`; refresh rejection/timeout enters a retryable failure; retry refreshes without reauthorizing. The existing production-build browser tests exercise this from both the dialog and popover. No duplicate UI fix/test added. |
| OAuth/access-flow assessment    | Completed here; no demonstrated vulnerability | See the focused assessment below. Added injected-fetch regression coverage; no security-policy runtime changes. #479 also includes `66071f9edd`, which serializes persisted credential refresh under the shared credential lock.                                                                                                                                             |
| Baseline OpenAPI drift          | Fixed here                                    | `check:generated` still failed at the baseline. Regeneration adds exactly the missing `permission.cancelled` and `session.tool.subagent.prepared` schemas and references. Client generation was rerun and produced no changes.                                                                                                                                               |

No feature flag: these are regression fixes, tests, documentation, and generated-document reconciliation.

## Worktree setup deadline

Worktree creation reuses the 120-second `RUN_ADMISSION_TIMEOUT_MS` limit rather than the normal
30-second setup RPC limit. The server runs `git worktree add`, saves the record, and runs the project's
`commands.start` (for example, `bun install`) before replying, so creation needs time for project setup.
A client timeout interrupts the handler but does not roll back the worktree or saved record. The timeout
therefore warns that the worktree may already exist and asks the user to check before retrying; a blind retry
can create a suffixed worktree such as `<name>-2`. Creation is not retried automatically.

## Evaluation header contract

Evaluation and System One are fork-only APIs. Upstream removed them in #58758 (`097a93e511`) in favour of
Decision; this fork intentionally retains them for `jev.systemOne` (#397). Preserve this fork contract during
future upstream syncs rather than treating it as accidental drift.

Use top-level `headers: Record<string, string>` on `Evaluation.request` / `Evaluation.run`.
System One applies configuration headers, then case-insensitive per-call overrides, then authentication.
This follows the existing text/media request pipeline: bearer authentication replaces an authorization override;
`Auth.none` preserves it. Body encoding sets `content-type: application/json`.

The historical `http.headers` shape is unsupported, not forwarded, and documented as such in the AI README.
Move it to top-level `headers`. `HttpOptions` remains query/body/encoding only.
The newer Decision API already forwards top-level headers (`test/decision.test.ts`), but does not fix the
separately exported experimental Evaluation API.

The regression tests exercise `Evaluation.run`, schema construction, client normalization, System One,
authentication, and the outgoing HTTP request. They cover configuration-only headers, mixed-case collisions,
authorization precedence with bearer/passthrough auth, and retained query/body defaults.

## Focused security/access-flow assessment

### Callback validation and attempt lifecycle

- `mcp/oauth.ts` creates a fresh 32-byte random state for each authorization. Pasted input must be a full URL,
  have the matching state, and contain a code (or an OAuth error). Invalid/nonmatching pastes leave the attempt
  available for correction. The pasted URL is parsed, not fetched: its host cannot redirect the token exchange.
- Both completion paths feed the same one-shot Deferred and SDK authorization exchange. Token exchange stays
  bound to the configured/discovered provider and its stored PKCE verifier; `iss` is forwarded to the SDK.
  Existing tests cover wrong-state/non-URL paste, one token exchange, loopback replay returning 409, PKCE,
  issuer-bearing completion, and rejected token exchange.
- The loopback listener binds `127.0.0.1` and validates the configured callback path. A malformed OAuth-bearing
  loopback callback can fail that attempt, unlike a wrong paste; this is existing behavior, not a new claim of
  credential compromise. Callbacks without code/state leave it waiting. No speculative hardening was added.
- `integration.ts` scopes lookup/cancel/complete by integration and attempt IDs. Cancellation/expiration close
  the attempt scope; terminal attempts cannot be completed again. Credential persistence is claimed once,
  recorded before reporting completion, and protected from cancellation while persisting. Existing integration
  tests cover cancellation, expiration, completion, and persistence outcomes.

### Injectable authenticated fetch

- `sender` resolves `FetchHttpClient.Fetch` from the owning Effect context. The trusted embedder supplies it;
  OAuth callback input does not select an executor. Discovery, exchange and refresh use that dependency.
- The wrapper preserves URL, method, authentication headers, body, and AbortSignal, disabling only Bun's idle
  fetch timeout. The added regression captures that exact outgoing request and verifies the returned response.
  It uses a sentinel credential and no network or global-fetch mutation.
- Refresh sharing is keyed by endpoint/client/refresh-token; settled entries are removed. Persisted credentials
  additionally use the shared credential lock added in #479. Existing refresh tests cover concurrent/stale
  refresh, rotation, sign-out, invalidation, rejected refresh, and lock release after transport failure.
- Logging records origin/method/status and provider error summaries, not request bodies or authorization
  headers. This is a focused assessment, not a blanket guarantee about arbitrary provider error text or custom
  embedder code.

### Permission semantics

- The actual #473 first-parent diff in `core/src/permission.ts` only adds `Permission.invocation(context)`,
  carrying session/agent/tool-source identity. It does not rewrite the policy evaluator.
- Current evaluation is last matching rule within ordered agent/session rules, with ask as the unmatched
  default. Configured denies are checked before saved approvals or plugin evaluation. Missing agents default
  to deny. Saved approvals are project-scoped; unattended rules can settle an ask but cannot override an
  effective configured deny.
- The existing permission suites verify explicit agent selection, session/saved-rule ordering, configured-deny
  precedence, and plugin permission behavior. Those suites pass without changing authorization semantics.

## Verification

- Frozen installation; unchanged lockfile. `bun run check`: lint and 39/39 typecheck tasks.
  Official `typecheck:tsc`: 32/32 tasks. Effect/lint-rule tests: 10/10 and 6/6.
- Broad validation: 36/36 non-Core Turbo test tasks passed, including the full CLI and TUI suites.
  Core passed separately in an isolated network namespace: 7,406 passed, 27 skipped, zero failed.
- Setup subprocess suite: 17/17 each on source, compiled Bun, and compiled Node. New worktree cases:
  20/20 across ten repetitions. Evaluation transport cases: 20/20 across ten repetitions.
- Focused OAuth/integration/permission suites: 183/183. Injected-fetch regression: 10/10 repetitions.
- Production-build MCP refresh-recovery browser tests: 2/2, then 20/20 across five workers with no retries.
- Linux x64 Bun and Node SEA builds, compiled service-lifecycle smoke tests, client generation,
  OpenAPI generation check, and whitespace checks passed.

Final execution checks use disposable HOME/XDG/database state, loopback fixtures or mocked browser API state.
The first smoke invocation exposed inherited `OPENCODE_CONFIG_DIR` despite its HOME/XDG isolation.
The smoke runner now uses the existing `cleanProcessEnv()` helper and a throwaway working directory.
A deliberately invalid throwaway config plus disabled project-config discovery fails the old script and
passes the corrected script for both compiled runtimes. No live service was targeted or stopped.

The initial broad Core run encountered an unrelated listener on its GitLab OAuth callback port 8080.
The listener was left alone. On Linux, rerun without host networking and drop namespace capabilities
so filesystem permission tests remain meaningful:

```sh
unshare --user --map-root-user --net bash -c '
  ip link set lo up
  cd packages/core
  CI=true setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all bun run test
'
```

Without the capability drop, two unwritable-lock-root tests incorrectly succeed under namespace root.
This command passed the full Core suite; the recurring fixed-port test-helper gap is also tracked by
papercut `pc_e9cd388c39fd`.

Cross-platform native release validation remains for release CI: this Linux x64 host cannot execute
macOS/Windows/ARM artifacts. No merge or release is requested.
