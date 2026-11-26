<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts. The body below becomes the skill's
  content.
-->

# Report a Shuvcode Issue

Use this skill when the user wants to report a Shuvcode issue or bug. Your job
is to turn the user's problem into a useful GitHub issue with standard
diagnostics plus the context needed to reproduce and resolve it.

## Workflow

1. Check that it is a bug. Read the documentation page for the area at
   <https://opencode.ai/docs/> for inherited behavior. If Shuvcode works as documented, tell the user
   instead of filing an issue.
2. Search for an existing issue with
   `gh issue list --repo shuv1337/shuvcode --state all --search "<keywords>"`.
   If one matches, give the user its URL and offer to add their details there
   instead of opening a new one.
3. Collect the standard diagnostics below. Compare the installed Shuvcode
   version with the latest version on its npm release channel (for example,
   `npm view shuvcode@latest version` for `latest`).
   If the user is behind, ask them to update and check whether it still happens.
4. Ask only for missing details that are necessary to reproduce or understand
   impact.
5. Draft the issue in the standard format below.
6. Publish it with GitHub CLI after the user confirms the title and body.

Do not publish an issue without user confirmation. If GitHub CLI is not
installed or not authenticated, explain the blocker and provide the exact issue
title/body for the user.

## Standard Diagnostics

The runtime diagnostics snapshot at the end of this skill already has most of
these values. Use them, and only run commands for values it marks unavailable or
that the user says differ, for example when the bug is in another install.

Collect these values when possible:

- Shuvcode version: run `shuvcode --version`.
- Client: the TUI, the desktop app, `shuvcode run`, the web app, or a server
  started with `shuvcode serve`.
- Model and provider: the provider and model ID in use when the problem
  happened, if the problem involves a model.
- Operating system: run `uname -a` on Unix-like systems, or `ver` on Windows.
- Terminal: inspect `$TERM`, `$TERM_PROGRAM`, `$COLORTERM`, and any obvious
  terminal app context the user provides.
- Shell: inspect `$SHELL` on Unix-like systems, or `%COMSPEC%`/`$ComSpec` on
  Windows when relevant.
- Install/channel context: include whether this appears to be local, dev, beta,
  or release if the version output or environment reveals it.
- Active plugins: the snapshot lists plugins from Shuvcode server config only. Also
  check `plugins` in `~/.config/shuvcode/cli.json` for terminal plugins, and
  local plugin files under `.opencode/plugin/` or `.opencode/plugins/`. Record
  plugin names and versions, and note if plugin status could not be determined.

If a diagnostic command fails, include `Unavailable` with the reason instead of
guessing.

## Logs

Shuvcode writes logs to `opencode.log` in the log directory named in the
snapshot, or `opencode-<channel>.log` for builds run from source. Find the
lines around the failure, such as the error and the few lines before it, and
include only those, at most about 40 lines. Never attach a whole log file.

## User-Specific Context

Capture the details that make the issue actionable:

- What the user was trying to do.
- What happened.
- What the user expected to happen.
- Reproduction steps, ideally minimal and numbered.
- Relevant logs, stack traces, screenshots, terminal output, or config snippets.
- Whether the issue is reproducible consistently, intermittently, or only once.
- Recent changes that may be related, such as updating Shuvcode, changing
  config, installing a plugin, changing terminal, or switching workspace.
- Workarounds tried and whether they helped.

Include only what helps someone reproduce or fix the bug. Issues are public.
Redact tokens, API keys, authorization headers, private URLs, usernames in paths,
and project-specific confidential data unless the user explicitly says it is
safe. Do not include prompts, conversation text, or file contents unless they are
needed to reproduce the bug and the user agrees.

## Issue Format

Use this exact structure unless the repository issue template requires
otherwise:

```markdown
## Summary

<!-- One or two sentences describing the bug and impact. -->

## Environment

- Shuvcode version: <!-- value or Unavailable: reason -->
- Client: <!-- TUI, desktop, run, web, or serve -->
- Model and provider: <!-- provider/model, or Not relevant -->
- OS: <!-- value or Unavailable: reason -->
- Terminal: <!-- value or Unavailable: reason -->
- Shell: <!-- value or Unavailable: reason -->
- Install/channel: <!-- value or Unavailable: reason -->
- Active plugins: <!-- list, none found, or Unavailable: reason -->

## Reproduction

1. <!-- step -->
2. <!-- step -->
3. <!-- step -->

## Expected Behavior

<!-- What should have happened. -->

## Actual Behavior

<!-- What happened instead. Include exact errors when available. -->

## Additional Context

<!-- Log excerpt, config snippets, screenshots, frequency, workarounds, related issues. -->
```

Keep the title short and searchable. Prefer the form:

```text
<area>: <specific failure or symptom>
```

Examples: `tui: skills dialog crashes outside location provider`,
`cli: local service config writes release filename`.

## Publishing With GitHub CLI

Use GitHub CLI from the repository checkout when available:

```sh
gh issue create --repo shuv1337/shuvcode --title "<title>" --body-file <file>
```

Write the body to a temporary markdown file first so quoting, newlines, logs,
and code fences are preserved. Target `shuv1337/shuvcode` unless the issue
belongs in another repository explicitly named by the user. If labels are
obvious and the repo accepts them, add `--label bug`; otherwise omit labels
rather than guessing.

After publishing, report the created issue URL to the user and mention any
diagnostics that were unavailable.
