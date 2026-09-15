# Live test: v2-rewrite side by side with the running Shuvcode

Written 2026-09-15 PDT for another agent. Read all of it before running
anything. The agent executing this is itself running inside the **old**
Shuvcode (`v2.0.0-alpha-20`, systemd-managed, port 4096), so every mistake
here can kill your own harness.

## What this is

Exercise the compiled `v2-rewrite` build (`b95a7cba` on bookmark
`v2-rewrite`, workspace `/home/shuv/repos/shuvcode-workspaces/v2-rewrite`)
on this host with the **real** preferences, plugins, MCP servers, and repos,
**next to** the old service — not instead of it. This is not the cutover.

Layers L3 (DB convert) and L6 (Claude / Antigravity / Codex plugins) are not
done, so:

- the new server starts with an **empty database**; there are no
  credentials until you add one;
- Claude Pro/Max and Antigravity are **expected to be absent**; do not try
  to make them work;
- `goal-plugin` is **expected to fail to load** (it targets the old fork's
  `@opencode-ai/plugin` and is out of the binary by decision 16);
- the plannotator plugin (`~/repos/plannotator/apps/opencode-plugin/dist/server.js`)
  has unknown compatibility — record what happens, do not fix it.

## Host facts observed on 2026-09-15

- Old binaries: `~/.local/bin/shuvcode` (first on PATH) and
  `~/.npm-global/bin/shuvcode` (launcher). Both are the old version.
- Old service: `systemctl --user` unit `shuvcode.service`, active, listening
  on `<tailscale-ip>:4096`; drop-ins `bun-tmp.conf`, `config-dir.conf`
  (sets `OPENCODE_CONFIG_DIR=~/.config/shuvcode`), `discord.conf`.
- `tailscale serve`: `:10001 → 127.0.0.1:4096` (the live service) and
  `:10000 → 127.0.0.1:8787`. Do not touch either.
- Your shell inherits `OPENCODE_CONFIG_DIR=/home/shuv/.config/shuvcode` and
  `OPENCODE_TERMINAL=1` from the unit. The new binary honours
  `OPENCODE_CONFIG_DIR` too.
- **Collision:** the old service's config dir is `~/.config/shuvcode` (via
  the drop-in) and the new binary's natural config dir is also
  `~/.config/shuvcode` (`Global.app = "shuvcode"`). That directory holds the
  old service's `service.json` (`hostname <tailscale-ip>`, `port 4096`,
  password, `manager: systemd`). If the new binary reads it, it will try to
  bind the old port and fail. The new binary must run with its own config
  dir (below).
- No collision on state/data: old uses `~/.local/state/opencode` and
  `~/.local/share/opencode/opencode.db`; new uses
  `~/.local/state/shuvcode` and `~/.local/share/shuvcode`. Both `shuvcode`
  dirs exist but are empty apart from test leftovers (`log/`, `repos/`,
  `~/.cache/shuvcode/bin`).
- Old DB has credentials for `openrouter` (api key), `xai`, `google`,
  `anthropic` (OAuth/setup-token — unusable without L6), and others.
- bun is 1.4.2. The rewrite workspace is a non-colocated jj workspace (no
  `.git`); build scripts need `OPENCODE_CHANNEL` set.

## Hard rules

- Never `systemctl --user stop|restart|disable shuvcode.service`. Never
  edit the unit or its drop-ins.
- Never run the old `shuvcode service …` commands.
- Never write to `~/.config/shuvcode/` (not `opencode.json`, not
  `service*.json`), `~/.local/share/opencode/`, `~/.local/state/opencode/`.
- Never `npm install -g` anything named `shuvcode` into `~/.npm-global`;
  never put the new binary on PATH as `shuvcode`.
- Never change `tailscale serve` on ports 10000 or 10001. Use 10002 for
  the pairing test and remove it afterwards.
- Never push `v2-rewrite`. Never touch `integration-v2`.
- Do not "fix" plugin or MCP failures in the real config. Record them.
- Every command that touches the new build goes through the wrapper script
  below, so the environment is scrubbed and the config dir is isolated.

## Setup

### 1. Build the full artifact (with web UI)

```sh
cd /home/shuv/repos/shuvcode-workspaces/v2-rewrite/packages/cli
OPENCODE_CHANNEL=latest OPENCODE_VERSION=2.0.3-shuv.1 \
  bun run script/build.ts --single --outdir=/home/shuv/.local/opt/shuvcode-next
ls -la /home/shuv/.local/opt/shuvcode-next/shuvcode-linux-x64/bin/shuvcode
```

Takes ~4 minutes (the web app is built). Do not pass `--skip-web-ui`; the
pairing test needs the web root. The launcher/npm install model was already
validated on a throwaway VM (plan L2); running the binary directly is fine.

### 2. Isolated config dir with the real preferences

```sh
T=/home/shuv/.local/share/shuvcode-live-test
mkdir -p $T/config
# real preferences, plugins, commands, skills, prompts, themes, tui files —
# but NOT the old service's service*.json
cd ~/.config/shuvcode
cp -a opencode.json plugins commands skills skill prompts themes tui.json tui.jsonc \
      node_modules package.json package-lock.json cli.json $T/config/ 2>/dev/null
ls $T/config
```

`AGENTS.md` in `~/.config/shuvcode` is a symlink to `~/AGENTS.md`; copy it
too (`cp -a AGENTS.md $T/config/`) so global instructions load.

### 3. Wrapper

```sh
cat > /home/shuv/.local/opt/shuvcode-next/run <<'EOF'
#!/usr/bin/env bash
# Runs the v2-rewrite build isolated from the old Shuvcode on this host.
for v in $(env | grep -o '^OPENCODE_[A-Z_]*'); do unset "$v"; done
export OPENCODE_CONFIG_DIR=/home/shuv/.local/share/shuvcode-live-test/config
export OPENCODE_DB=/home/shuv/.local/share/shuvcode-live-test/opencode.db
# The test DB has no credentials; OpenRouter comes from the old DB via env (never printed).
export OPENROUTER_API_KEY="$(sqlite3 "$HOME/.local/share/opencode/opencode.db" \
  "select json_extract(value,'\$.key') from credential where integration_id='openrouter'")"
exec /home/shuv/.local/opt/shuvcode-next/shuvcode-linux-x64/bin/shuvcode "$@"
EOF
chmod 755 /home/shuv/.local/opt/shuvcode-next/run
N=/home/shuv/.local/opt/shuvcode-next/run
$N --version          # expect: shuvcode v2.0.3-shuv.1
$N debug paths        # config must be the live-test dir; db the live-test file;
                      # data/state/cache under ~/.local/{share,state}/shuvcode, ~/.cache/shuvcode
```

`OPENCODE_DB` keeps the test database out of `~/.local/share/shuvcode/`,
which L3 will populate with the converted live DB.

### 4. Service config for the new server

```sh
$N service set hostname 127.0.0.1
$N service set port 4919
cat /home/shuv/.local/share/shuvcode-live-test/config/service.json   # hostname/port/password
```

The password is generated here; it is the pair password later.

## Tests

Record every result in
`/home/shuv/repos/shuvcode-workspaces/v2-rewrite/PLAN-live-test-v2-rewrite-results.md`
(create it; one heading per test, pass/fail, exact observation, timings).
Keep terminal captures short. Use `termctrl` for the TUI (skill
`terminal-control`); use `$N` everywhere.

### T1 — Side-by-side boot

```sh
ss -ltn | grep -E ':4096|:4919'          # only 4096 before
time $N service start                    # prints http://127.0.0.1:4919
$N service status
ss -ltn | grep -E ':4096|:4919'          # both
systemctl --user is-active shuvcode.service   # still active
cat ~/.local/state/shuvcode/service.json | sed -E 's/"password":"[^"]*"/"password":"<redacted>"/'
```

Pass: new server on 4919, old untouched, registration under
`~/.local/state/shuvcode/`, DB created at the `OPENCODE_DB` path, log at
`~/.local/share/shuvcode/log/opencode.log`.

### T2 — Real config loads: plugins and MCP

Start the TUI in a real repo:

```sh
cd /home/shuv/repos/shuvcode-workspaces/v2-rewrite
termctrl start next --host opentui --cols 140 --rows 40 -- $N .
termctrl wait next "Ask anything" ; termctrl show next
```

Then `/plugins` and `/mcps` (or the footer indicators). Record, per entry,
loaded / failed and the message. Expected: `goal-plugin` fails;
`herdr-agent-state-v1.js` is disabled by the `-` prefix (must not appear as
failed); plannotator plugin unknown; MCP servers `cua-driver`, `executor`,
`skills-mcp`, `shuvshow`, `macos-cua` — compare with the same list in the
old TUI (`shuvcode` in another termctrl session) and note any that connect
on old but fail on new.

Pass: the catalog loads and the home screen appears within ~10s even with
failures (watchlist B4). Any MCP that works on old and fails on new is a
finding, not a fix.

### T3 — Credential and provider

The DB is empty; the wrapper injects `OPENROUTER_API_KEY` from the old DB.

```sh
$N auth list                      # openrouter via environment; no anthropic/google (expected, L6)
$N models 2>/dev/null | grep -i openrouter | head
```

Optional, to exercise the interactive key flow: in a termctrl session run
`$N auth login openrouter`, paste the same key at the secret prompt, then
`$N auth list` should show it as a stored credential too.

Pass: OpenRouter models are listed; `anthropic` and `google` are absent.

### T4 — Prompt with tool use in a real repo

In the TUI from T2 (or `$N run`), pick an OpenRouter model, then:

```
Read packages/util/src/global.ts and tell me the value of `app`. Then run `jj log -r @ --no-graph -T description` and paste the output.
```

Pass: `read` and `bash` tools run, permission prompts follow the real
`permissions` config, answer contains `"shuvcode"` and the commit message.
Record token/cost footer and the time to first token.

### T5 — Non-interactive and continue

```sh
cd /home/shuv/repos/shuvcode-workspaces/v2-rewrite
$N run -m openrouter/<model-id> "Reply with exactly: ok"
$N session list | head
termctrl start next2 --host opentui --cols 120 --rows 36 -- $N --continue .
```

Pass: `run` prints `ok`; `--continue` reopens the last session; session
count matches (watchlist B3 on the real host).

### T6 — Pairing over the tailnet (temporary port 10002)

```sh
tailscale serve --bg --https=10002 http://127.0.0.1:4919
tailscale serve status | grep 10002
$N pair --url https://<host>.<tailnet>.ts.net:10002
```

Send the URL to the phone with `sharkctl notify --url https://<host>.<tailnet>.ts.net:10002 "v2-rewrite pair test: open and log in with the printed password"`
and, locally, `curl -s -o /dev/null -w '%{http_code}\n' https://<host>.<tailnet>.ts.net:10002/api/status`
(expect 401) and with `-u opencode:<password>` (expect 200, version
`2.0.3-shuv.1`, pid of the new server). Open the URL in the local browser
(`xdg-open`) and confirm the web UI loads and lists the T4 session.

Pass: web UI reachable through the tailnet with the pair credentials, old
`:10001` unaffected.

Teardown for this test (do it even if it fails):

```sh
tailscale serve --https=10002 off
tailscale serve status        # 10000 and 10001 only
```

### T7 — Cold start on this host

With the new server stopped (`$N service stop`), start the TUI in a repo
and time home screen and model footer (watchlist B1 on the real host,
compiled binary, real config):

```sh
$N service stop; sleep 1
date +%s.%N > /tmp/opencode/t0
termctrl start cold --host opentui --cols 120 --rows 36 -- $N /home/shuv/repos/shuvcode-workspaces/v2-rewrite
# poll termctrl show cold until "Ask anything" then until a model name in the footer; compute deltas from t0
```

Pass: home < 10s, model within ~1s of home. Record both numbers.

### T8 — Old service is unharmed

```sh
systemctl --user is-active shuvcode.service
curl -s -o /dev/null -w '%{http_code}\n' http://<tailscale-ip>:4096/api/status   # 401 or 200, not connection refused
ls -la ~/.config/shuvcode/service.json ~/.config/shuvcode/opencode.json   # mtimes unchanged from before T1
```

Pass: unchanged. If anything here changed, stop and report before
continuing.

## Teardown

```sh
termctrl stop next; termctrl stop next2; termctrl stop cold   # whichever exist
$N service stop
ss -ltn | grep 4919            # nothing
tailscale serve status         # 10000 and 10001 only
```

Leave `/home/shuv/.local/opt/shuvcode-next` and
`/home/shuv/.local/share/shuvcode-live-test` in place for inspection; note
their sizes in the results. Do not delete `~/.local/share/shuvcode` or
`~/.local/state/shuvcode` (L3 relocates into them).

## Report

- Results file as above, committed on `v2-rewrite` with
  `jj commit -m 'docs: record live side-by-side test results'` from the
  rewrite workspace (`jj` only; no git; no push).
- Append any failing check to the plan (`PLAN-fresh-v2-rewrite.md`) as a
  named item under the layer that owns it, the same way the L0 gate did.
- `sharkctl notify` a one-line summary with the pass/fail count when done.
