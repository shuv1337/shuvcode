# Shared host service

A Shuvcode host runs one managed V2 server for the interactive Shuvcode TUI and
all local or remote clients. The server owns sessions, projects, integrations,
providers, agents, plugins, MCP servers, skills, and instructions. Consumers do
not create caller-specific Shuvcode configuration domains.

## Ownership and paths

- Shuvcode owns `shuvcode.service` and its lifecycle.
- The canonical Shuvcode preferences file is
  `~/.config/shuvcode/opencode.json`. Because Shuvcode intentionally retains
  OpenCode's XDG paths for compatibility, `~/.config/opencode/opencode.json`
  must be a symlink to that file. Neither the unit nor an interactive shell
  sets `OPENCODE_CONFIG_DIR`.
- The remaining files under `~/.config/opencode` are compatibility-owned
  service registration and package data. They are not preferences sources and
  must not replace or rewrite the Shuvcode preferences symlink.
- Shuvcode's normal XDG data and state roots remain canonical for every caller.
- The channel-specific service files under `~/.config/opencode` and
  `~/.local/state/opencode` are private mode `0600`. They contain the
  administrator credential and managed-service registration used by trusted
  loopback clients. Use `shuvcode service` commands instead of selecting a file
  by name.
- Mobile clients receive independently revocable device credentials through
  pairing. A bridge may keep its own client-facing credential domain while
  using the administrator credential on loopback.

Install the user unit from this repository:

```sh
mkdir -p ~/.config/opencode ~/.config/shuvcode
ln -sfn "$HOME/.config/shuvcode/opencode.json" \
  "$HOME/.config/opencode/.opencode.json.shuvcode"
mv -Tf "$HOME/.config/opencode/.opencode.json.shuvcode" \
  "$HOME/.config/opencode/opencode.json"
install -m 0644 deploy/systemd/shuvcode.service ~/.config/systemd/user/
systemctl --user daemon-reload
shuvcode service set hostname 127.0.0.1
shuvcode service set port 4096
shuvcode service set advertised-urls https://<host>.<tailnet>.ts.net:10001
systemctl --user enable --now shuvcode.service
tailscale serve --bg --https=10001 http://127.0.0.1:4096
```

The managed server binds loopback. Configure it while stopped, then publish the
separate advertised URL through the tailnet reverse proxy as shown above.

The bind and advertised URL are deliberately different. Do not widen the bind
to make a reverse-proxy URL reachable.

## Migrating an isolated service

Stop dependent callers and back up both configuration roots. Reconcile desired
preferences into `~/.config/shuvcode/opencode.json`, then atomically point
`~/.config/opencode/opencode.json` at it. Do not select an older dotfiles copy
merely because it already contains required plugins. Preserve the active
service password through `shuvcode service`, then update dependent loopback
clients to the same value without printing it. Remove any systemd drop-in that
sets `OPENCODE_CONFIG_DIR`, reload the user manager, and restart Shuvcode before
its dependants.

Migrate plugins as part of the configuration merge. A V1-shaped document keeps
the singular `plugin` field because the V2 loader migrates the whole document;
a native V2 document uses `plugins`. Do not rename only that field in an
otherwise V1 document: it will be ignored during migration. Replace legacy
plugin entrypoints with their V2 server adapters and verify every required
integration method after restart.

Provider authentication stored only in a legacy credential file is not a V2
integration connection. Reconnect those providers through the V2 TUI after the
shared server is active. Do not copy credential records directly into the V2
database.

## Deploying a binary

Binary deployment must not write, replace, relink, check out, or migrate the
preferences file. On the host, deploy a clean and current `integration-v2`
checkout through the guarded installer:

```sh
./deploy/install-host.sh
```

The installer records the resolved preferences target and hash before changing
the binary and requires both to remain identical after restart. It also refuses
to deploy a dirty checkout, a branch other than `integration-v2`, a commit that
differs from `origin/integration-v2`, or an unsupported Bun version.
Run `./deploy/install-host.sh --check` for the same preflight without building,
installing, or restarting anything.

Treat a preferences migration as a separately reviewed operation. If the
target or hash changes during a binary deploy, abort the deploy and restore the
pre-deploy state before restarting any dependent callers.

## Verification

```sh
systemctl --user show shuvcode.service \
  -p ActiveState -p SubState -p ExecStart -p Environment
test "$(readlink -f ~/.config/opencode/opencode.json)" = \
  "$HOME/.config/shuvcode/opencode.json"
ss -ltnp | rg '127\.0\.0\.1:4096'
tailscale serve status
shuvcode service get
shuvcode pair
```

Verify that interactive TUI sessions and paired mobile sessions appear in the
same session list, and that every configured V2 provider appears through the
model endpoint. For providers supplied by plugins, verify the required login
methods too; an Anthropic subscription deployment must advertise an OAuth
method, not only API-key or environment methods. Logs and verification output
must not contain administrator passwords, invitation tokens, or device
credentials.
