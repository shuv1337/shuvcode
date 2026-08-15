# Client-Scoped Execution Environment

## Goal

Allow shared-service clients to forward an explicit allowlist of client-local environment variables, such as `HERDR_PANE_ID`, into the work admitted by that client without exposing arbitrary client environment or relying on server-global `process.env`.

## Design

- Add `forward_environment: string[]` to the client-local CLI config (`cli.json`, `packages/cli/src/config/schema.ts`). Entries are variable names only. The client alone owns the decision of what it forwards; there is no server-side config surface for this feature. Keep the field optional and decode-tolerant so an invalid entry cannot silently empty the rest of `cli.json`.
- The TUI reads only configured names from its own `process.env`, filters forbidden names with a one-time warning, and sends only present values. Forbidden names, matched case-insensitively for Windows: `PATH`, `LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS`, `SHELL`. The server rejects any forbidden key that still arrives with `InvalidRequestError` as backstop; misconfiguration must degrade gracefully client-side, not fail every prompt.
- Add a dedicated optional `environment: Record<string, string>` field to the `session.prompt`, `session.command`, and `session.shell` payloads in `packages/protocol/src/groups/session.ts`. Do not add it to `PromptInput.Prompt` — it is not a model-facing prompt shape and must not leak into `Prompt.fields` spreads.
- Persist the environment on `SessionPending.UserData` (`packages/schema/src/session-pending.ts`) and the projected `SessionMessage.User` (`packages/schema/src/session-message.ts`) so queued work, exact retries, explicit resumes, and post-restart runner rebuilds retain identity. Do not place it in generic message metadata.
- Containment boundary, stated honestly: forwarded values are durable by design — they live in the `session.input.admitted` event, `session_pending` rows, and projected user messages, and are delivered to every subscribed client. Values are non-secret client identity. Exclusion applies to model requests (`runner/to-llm-message.ts`), transfer/export output, logs, traces, and UI transcript rendering only.
- When user input is promoted, the environment of the latest promoted user input by `admitted_seq` replaces the runner's current execution environment. An absent field replaces with empty — a client without forwarding configured clears any earlier client's values. Synthetic messages never affect it. Queued input establishes its environment when that input starts; synthetic continuation keeps the current environment. The environment survives compaction: the runner derives the current environment from the latest user message across full session history, including before a compaction boundary.
- Extend `Tool.Context` (`packages/schema/src/tool.ts`) with the current execution environment; the runner supplies it per step. Subagent prompt admission (`packages/core/src/tool/plugin/subagent.ts`, via the `PluginRuntime` session interface) copies the parent tool context environment into the child session's prompt, including nested subagents.
- Shell overlay: add an optional `env` field to `Shell.CreateInput` so `Shell.create` (`packages/core/src/shell.ts`) merges forwarded values into `invocation.env` after server defaults but before `hooks.trigger("shell", "create.before")` fires. Plugins see the effective environment and may deliberately override it. The overlay must not live in the bash tool's `before` callback, which runs after plugin hooks and would violate this ordering.
- Direct `!` shells: the `session.shell` endpoint passes its `environment` payload through to `Shell.create` the same way. User-initiated shells carry the same client identity as agent shells.
- Exact retries: `environment` participates in `SessionPending.equivalent` and in `promotedFromHistory` reconciliation. The TUI must capture the environment once per message ID and resend the identical payload on retry; it must never re-read `process.env` at retry time, or drifted values produce a `LifecycleConflict`.
- Leave canonical service `PATH` handling separate. Forwarded variables solve client identity; they must not make portable service startup depend on the reconnect-election winner. `PATH` forwarding is forbidden outright (see reject list); deterministic portable-service `PATH` is a separate effort.

## Implementation Order

1. Add `forward_environment` to the CLI config schema in `packages/cli/src/config/schema.ts` with the shared forbidden-name constant and client-side filtering helper; add config tests covering decode tolerance and filtering.
2. Add the dedicated field through `packages/schema/src/session-pending.ts` (`UserData`), `packages/schema/src/session-message.ts` (`User`), `packages/schema/src/tool.ts` (`Tool.Context`), and `packages/protocol/src/groups/session.ts` (`session.prompt`, `session.command`, `session.shell` payloads); add server-side forbidden-key rejection with `InvalidRequestError` at admission and at the shell endpoint.
3. Capture allowlisted values at the TUI admission call in `packages/tui/src/mini/stream-v2.transport.ts`, covering prompt, command, and direct shell requests; capture once per message ID and reuse the exact payload for retries; filter forbidden names with a one-time warning.
4. Carry the promoted environment through the runner (latest promoted user input by `admitted_seq`, replace-with-empty on absence, survival across compaction) and `Tool.Context`; add `env` to `Shell.CreateInput` and merge it in `packages/core/src/shell.ts` before the plugin hook; inherit it through the `PluginRuntime` session interface in `packages/core/src/tool/plugin/subagent.ts`.
5. Explicitly exclude the field in model conversion (`runner/to-llm-message.ts`), Session transfer/export, tracing, logs, and transcript rendering.
6. Regenerate the public clients with `bun run generate` from `packages/client`.

## Validation

- Two clients with different allowlisted values submit work to one shared service; each shell sees its submitting client's value.
- Unlisted variables never cross the API or appear in shell environments.
- A forbidden name in `forward_environment` is filtered client-side with a warning and prompts still succeed; a forbidden key sent directly to the API is rejected with `InvalidRequestError`. Matching is case-insensitive (`Path` on Windows).
- Queued prompts and exact retries preserve the captured environment; a retry with an identical payload reconciles, including after promotion via the durable admitted event.
- A promoted steer affects only subsequent steps; existing tool calls retain their step environment. When one boundary promotes multiple inputs, the latest by `admitted_seq` wins.
- A promoted input without an environment clears the previously established environment.
- The environment survives server restart (rebuilt from the projected user message) and compaction (derived from full history).
- Direct `!` shells receive the submitting client's environment.
- Foreground, background, and nested subagents inherit the parent step environment.
- A plugin `shell.create.before` hook observes forwarded values in `invocation.env` and may override them.
- Model requests, transcripts, exports, logs, and traces contain no forwarded values.
- Existing managed-service and portable-service lifecycle tests continue to pass.
