# Native supervisor

The native supervisor manages a lead and worker Sessions across registered Git projects. It keeps its backlog, decisions, delivery state, and verified reports in a dedicated supervisor home. Each dispatched worker has a pinned base commit, its own worktree, and a native Session. Shuvcode runs the model and enforces tool permissions.

The supported installed path is the Linux Shuvcode CLI package built with Bun. The package includes the supervisor plugin and optional voice assets under its platform package's `bin/supervisor-plugin` and `bin/supervisor-voice` directories. A source checkout can run the same commands with `bun run --cwd packages/cli dev supervisor ...`. Use an isolated home for evaluation; starting a supervisor does not replace an existing ShuvBro service.

## Start a home

```bash
shuvcode supervisor up \
  --home /absolute/path/to/supervisor \
  --project /absolute/path/to/git-repository \
  --model eval/gpt-6-sol \
  --provider-url https://llm.int.exe.xyz/openai/v1
shuvcode supervisor lead --home /absolute/path/to/supervisor
```

`up` initializes and starts a managed loopback server, creates the lead, and registers the initial project. Repeating it with the same home preserves that home's model, provider connection, permission policy, and lead. `init` prepares a home without starting it; `start` and `stop` control the managed processes. `lead` opens the terminal; `lead --no-open` prints the attach command. Set `SHUVCODE_SUPERVISOR_HOME` to use one home without repeating `--home`.

The lead and workers ask for tool permissions by default. `--auto` at initial setup allows automatic permissions; it cannot be added later to a prompt-based home. A project defaults to manual merge authority (`--yolo` is off). Projects with an origin remote default to `no-mistakes-prod-only`: internal work resolves to `direct-PR`, while product, mixed, or uncertain work resolves to `no-mistakes`. Projects without an origin default to `local-only`. The resolved delivery mode and merge authority are captured when work is queued. A lead can inherit existing permissions and policy, but changing worker permissions, increasing merge authority, or changing delivery mode requires the operator.

For a headless connection, use `supervisor send "..."`, `supervisor read`, and `supervisor status --watch`. `status --task NAME` shows the exact worker, worktree, decisions, permissions, and recovery state; `doctor` checks setup and actionable errors. A provider error appears in `read` and `status`.

## Projects and backlog

```bash
shuvcode supervisor projects
shuvcode supervisor project add /absolute/path/to/another-repo --name another
shuvcode supervisor project clone https://example.com/team/repo.git cloned
shuvcode supervisor project new scratch
shuvcode supervisor project default another
shuvcode supervisor project set another --mode local-only --base integration-v2
shuvcode supervisor project archive scratch
```

`project add` registers an existing repository; `clone` and `new` create one and register it. The first registered project is the default until `project default` changes it. `projects --all` includes archived projects. Archiving preserves the repository and historical work; choose another default first. Existing work keeps its pinned project, base, and Session when defaults change.

```bash
shuvcode supervisor task "Implement the API change" --name api --project another --kind ship
shuvcode supervisor task "Review the API change" --name review --project another --kind scout --depends-on api
shuvcode supervisor task "Prepare release notes" --name notes --after-landed api --resource release
shuvcode supervisor backlog
shuvcode supervisor bearings
shuvcode supervisor board
```

A task can wait for another work item to finish (`--depends-on`) or land (`--after-landed`), an explicit hold (`--hold`), a date (`--not-before` or `--until`), or an exclusive resource (`--resource`). `hold NAME REASON`, `release NAME`, `dispatch NAME`, and `retry NAME` manage those gates. `retry` retains the prior attempt's evidence. `board` opens the local fleet and decision view; `--no-open` prints its URL. The supervisor dispatches independent eligible work concurrently without a default worker cap.

The lead's direct tools are `supervisor_projects`, `supervisor_project`, `supervisor_task`, `supervisor_work`, `supervisor_control`, `supervisor_status`, and `supervisor_answer`. Delivery, delegation, channels, knowledge, and away mode use `supervisor_delivery`, `supervisor_delegate`, `supervisor_channel`, `supervisor_knowledge`, and `supervisor_away`; `supervisor` exposes typed operations not covered by the friendly tools. A worker uses `supervisor_decision` for a question or user approval, then `supervisor_result` with a relative report path in its assigned worktree. Ship work must be committed with a clean tracked/index state. The supervisor verifies the report and Git evidence after native execution becomes idle, then keeps the report bytes durably. A report receipt is distinct from delivery or landing.

## Decisions, delivery, and recovery

`supervisor decisions` lists open questions; `answer TASK DECISION TEXT` resolves one. A lead can answer routine questions within its authority. User-only decisions and worker permission requests require an operator answer; `approve TASK REQUEST` or `approve TASK REQUEST --deny` handles the latter. `steer TASK MESSAGE` sends guidance now, while `--queue` waits for an idle boundary. `interrupt`, `resume`, and `cancel` have separate effects. A cancellation never silently discards the worktree.

For a completed ship task, inspect its captured policy and current evidence before taking delivery actions:

```bash
shuvcode supervisor delivery prepare TASK
shuvcode supervisor validate start TASK --intent "Check the agreed change"
shuvcode supervisor validate status TASK
shuvcode supervisor delivery approve TASK --reference "user approval reference"
shuvcode supervisor delivery land TASK
shuvcode supervisor delivery cleanup TASK
```

The validation commands apply to `no-mistakes` work. A `direct-PR` task instead uses `delivery publish TASK --title "..." --body-file /path/to/body.md` after preparation. `local-only` work does not publish a PR. `delivery reconcile TASK` checks an uncertain publish or landing against current Git and forge evidence. `delivery cancel TASK` stops pending delivery and reconciles active validation; `validate abort TASK` stops a bound validation run. `validate respond TASK --action approve|fix|skip` answers a validation gate; user decisions need `--reference`. Landing checks the current source, target, PR, checks, and approved merge authority. Cleanup requires verified landing and a clean worktree. `discard TASK --reference ...` is a separate, explicitly authorized terminal-worktree action.

Managed restart fences the previous owned native process and reuses the preserved native database. If prompt admission timed out, `recover TASK` restarts that owned process and reconciles the task before it can complete or clean up. External-server mode (`up --endpoint`) cannot fence a server it does not own, so uncertainty remains blocked for operator reconciliation. `serve` and `request` are diagnostic interfaces; ordinary operation uses the commands and tools above.

## Delegates and optional channels

A delegate has its own home, project registry, backlog, lead, and workers. The lead can manage one with `supervisor_delegate`; the CLI exposes `delegate add NAME --delegate-home PATH --scope DESCRIPTION`, `delegate provision`, `delegate status`, and `handoff create HANDOFF --delegate NAME --work WORK`. Handoffs are durable and dependency-closed. `handoff status`, `retry`, and `cancel` inspect or settle the exact handoff. A delegate that is idle makes no model calls.

Relay and voice are opt-in. `supervisor_channel` and the `channel`, `inbox`, and `reply` CLI commands manage durable intake and outbound replies. For example, `channel configure x --kind relay --endpoint URL --enabled on` enables a Relay endpoint, while `channel poll` fetches offers and `channel flush` posts prepared replies. `FMX_PAIRING_TOKEN` comes from the process environment, not the channel record. Automatic reply posting is off unless the channel is configured with `--auto-replies`. Reply promises stay bound to their original request; unknown posting outcomes require explicit `reply reconcile` before another attempt. `reply send ID --text ... --image /path/to/image.png` can attach one validated local image to the opener. Pure acknowledgments can use `inbox dismiss ID` without a public reply.

`voice configure --region REGION --model MODEL` sets the speech connection; `voice talk` captures a request, and `voice snapshot` reports what the lead may disclose. `voice test FILE` accepts a 16 kHz mono PCM fixture. The optional ShuvBro voice-note channel uses `channel configure voice --kind voice --directory PATH --enabled on`. Speech calls and devices require their own configured services. `supervisor_away` or `away propose --words ...` records an away contract and returns a readback for `away confirm ID`; `away return` and `away check` drive catch-up. `supervisor_knowledge` and `knowledge put/list/get` retain scoped preferences, fleet notes, project notes, and task notes without treating untrusted Relay text as authority.

## Knowledge curation

`knowledge startup` shows the lead's startup context: private home preferences, primary-owned shared preferences, and home fleet learnings. Project and task notes stay available on demand. `knowledge stow --plan /path/to/changes.json` curates owned records and applies aging or perishable retention; the plan is an array of changes with an action, ID, and evidence. For example:

```json
[
  {
    "action": "archive",
    "id": "old-rule",
    "evidence": "Replaced by policy 42",
    "reason": "Superseded"
  }
]
```

`knowledge archive [ID]` reads preserved prior values and retirement evidence. Substantive edits preserve the old value; repeating the same evidence does not renew its retention clock. A primary stow also cascades shared preferences to registered delegates, synchronizing shared records before each delegate stows its own notes. `knowledge shared-status` shows the local shared cache and its age. Delegate shared records are read-only and bound to the primary home's persistent identity.

The operator-set startup budget defaults to 7,500 estimated tokens per home. `knowledge startup` reports both the estimate and the limit. If it is exceeded, ordinary work intake and dispatch wait while the lead can still curate knowledge. The operator can change the durable limit with `shuvcode supervisor knowledge budget --budget-tokens 10000 --home /absolute/path/to/supervisor`; the next intake or dispatch reevaluates the current context. A delegate may have a different limit, so cascade reports its budget block for remediation instead of treating it as a successful sync.

## Evaluation and evidence

For the integrated Herdr, Shuvcode, and ShuvBro trial, run `ssh -t shuvcode-test.exe.xyz native-fleet`. The new home at `/home/exedev/eval/native-herdr` uses a disposable project, real `eval/gpt-6-sol` work, and the pinned ShuvBro candidate under publication review. A real worker, three passing tests, local landing, and restored display identities after Herdr restart have been verified. See the [entry instructions and three-repository evidence](native-supervisor-herdr.md#exedev-testing-october-6-2026-pdt). Use `shuvcode-native supervisor status` from an ordinary SSH shell to inspect this home.

The original approved pilot remains at `/home/exedev/eval/pilot` on `shuvcode-test.exe.xyz`, reached through its `shuvcode-pilot` wrapper. Its historical October 5, 2026 PDT run used source base `28350a1f141e1fe7fef440d72ca791d31f595349` and a real `eval/gpt-6-sol` lead. At 11:54 PDT, ship worker `implement-slug` committed `95f4fc3fa905f1dda013d414bc5e3356c419651d`; an independent rerun passed six tests and seven assertions. Scout worker `review-input` received an answer to its question and returned a verified report. Both tasks completed with their reports preserved. A forced manager-death restart retained lead generation 1, three receipts, obligations, and the decision answer; five seconds of resumed reconciliation added no Session step starts or inbox enqueues. Raw run evidence remains under `/home/exedev/eval/evidence/`. These observations qualify that pilot run only; no merge or worktree removal was requested.

The test box's default `shuvcode` and explicit `shuvcode-parity` commands now use the compiled parity distribution at `/home/exedev/eval/parity-dist`. Run `ssh -t shuvcode-test.exe.xyz shuvcode supervisor lead` to attach. Its home is `/home/exedev/eval/parity`, with registered projects `parity-a` and `parity-b` and a separate delegate home at `/home/exedev/eval/secondmate`. The source snapshot remains at `/home/exedev/repos/shuvcode-parity`. These are isolated from the approved pilot and the production ShuvBro deployment. The [parity matrix](native-supervisor-parity.md) records the passing 169-test supervisor suite, real multi-project workflow, SSH handoff/recovery, compiled two-home knowledge evaluation, and remaining live integration and performance qualification.

Run focused tests from `packages/cli` (`bun test test/supervisor-*.test.ts` and `bun typecheck`); run `bun run check` and `git diff --check` from the repository root. The 1,000-obligation test measures storage and idempotence, not 1,000 model executions.
