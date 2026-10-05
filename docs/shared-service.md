# Shared host service

A Shuvcode host runs one background V2 server for the interactive TUI and for
every local or remote client. The server owns sessions, projects, integrations,
providers, agents, plugins, MCP servers, skills, and instructions.

Shuvcode uses upstream's portable service model. There is no systemd unit and
no `manager` setting: the first client that needs the server starts it, and the
registration file decides who owns it.

## Paths

`Global.app` is `shuvcode`, so everything lives under the `shuvcode` XDG roots.
File names inside them are upstream formats and stay as upstream:

- `~/.config/shuvcode/opencode.json` — preferences
- `~/.config/shuvcode/service.json` — `shuvcode service set` values
  (`hostname`, `port`, `password`, `cors`, `env`); mode `0600`
- `~/.local/state/shuvcode/service.json` — live registration (`id`, `version`,
  `url`, `pid`, `password`) written by the running server; mode `0600`
- `~/.local/share/shuvcode/opencode.db` — the elected channel database
- `~/.local/share/shuvcode/log/opencode.log`
- `~/.cache/shuvcode/bin/opencode-pty/<version>/` — the persistent-terminal
  sidecar

Preview channels use `service-<channel>.json` and `opencode-<channel>.db`.
`shuvcode debug paths` prints the resolved set. Nothing reads
`~/.config/opencode`; do not set `OPENCODE_CONFIG_DIR` on a Shuvcode host.

## Configure and start

```sh
shuvcode service set hostname 100.126.224.77   # tailnet address, or 0.0.0.0
shuvcode service set port 4919                 # default is 0x1337 already
shuvcode service start
shuvcode service status
```

The default port is `4919` (`0x1337`); the `local` channel uses `4920`.
Configure while the server is stopped; `service set` does not restart it.

`service start`, the TUI, `shuvcode run`, and every other client call the same
`Service.ensure`: if a compatible server is registered, they reuse it;
otherwise they spawn `shuvcode serve --service` and wait for it to register.
The server keeps running after the client exits. Nothing starts it at boot; a
remote-only host needs one `shuvcode service start` after a reboot.

## Restart and upgrade

- `shuvcode service restart` is explicit: it shuts persistent terminals down,
  stops the server, and starts a new one.
- Automatic replacement preserves terminals. When a newer client finds an
  older server (`npm install -g shuvcode@<version>` followed by `shuvcode`),
  the TUI hands the persistent-terminal sidecar off through the registration
  file, stops the old server, and starts the new one; running terminals keep
  their processes and reappear under the new server. Verified on a throwaway
  host with a `2.0.3-shuv.1` → `2.0.3-shuv.2` upgrade: the sidecar and its
  child pids were unchanged across the replacement.
- `shuvcode service stop` stops the server and the sidecar.

## Durable session logs

All CLI `serve` modes retain durable session events in the selected SQLite
database. `GET /api/experimental/session/:sessionID/log` replays those events
after a server restart; `?after=<sequence>` resumes after a previously consumed
event. Ephemeral notifications are not retained.

Event retention follows the session lifetime: deleting a session removes its
event payloads and sequence row. Replay reads at most 512 durable rows per
database page, but retained sessions have no automatic age, row-count, or
byte-size limit. Paging bounds each database read, not disk growth.

From `packages/cli`, `bun test test/event-persist.test.ts` verifies replay after
an abrupt server exit, cursor resumption, and deletion cleanup in isolated
HOME/XDG/database state. To exercise a local compiled build, set
`SHUVCODE_EVENT_TEST_BINARY` to its absolute executable path for the same test.

## Pairing remote clients

```sh
shuvcode pair --url https://shuvdev.tail586a6d.ts.net:4919
```

`pair` prints the advertised URL, the username `opencode`, the service
password, and a QR code for the web and mobile apps. `--url` advertises an
external URL instead of the bind address; point it at whatever reverse proxy
fronts the port (for the tailnet, `tailscale serve --bg --https=4919
http://127.0.0.1:4919`). The password is the one in
`~/.config/shuvcode/service.json`; `shuvcode service set password <value>`
rotates it for every client.

Unauthenticated requests get `401`; `/api/status` reports the server version
and pid.

## Cutover from the systemd-managed host

Preconditions: shuvbot-discord runs on its own host, and the goal-plugin entry
is gone from `~/.config/shuvcode/opencode.json`.

```sh
systemctl --user disable --now shuvcode.service
rm ~/.config/systemd/user/shuvcode.service
rm -r ~/.config/systemd/user/shuvcode.service.d
systemctl --user daemon-reload
rm ~/.config/opencode            # the compatibility symlink
shuvcode service set hostname 100.126.224.77
shuvcode service set port 4919
shuvcode service start
tailscale serve --bg --https=4919 http://127.0.0.1:4919
shuvcode pair --url https://shuvdev.tail586a6d.ts.net:4919
```

`BUN_TMPDIR` is no longer needed: bun 1.4.2 extracts one content-hashed
library per binary and reuses it. Keep `bun-compile-tmp-cleanup.timer` only if
tmpfs pressure returns.
