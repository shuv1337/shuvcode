# Shared host service

A Shuvcode host runs one managed V2 server for the interactive Shuvcode TUI and
all local or remote clients. The server owns sessions, projects, integrations,
providers, agents, plugins, MCP servers, skills, and instructions. Consumers do
not create caller-specific Shuvcode configuration domains.

## Ownership and paths

- Shuvcode owns `shuvcode.service` and its lifecycle.
- The canonical configuration root is `~/.config/opencode`; neither the unit nor
  an interactive shell sets `OPENCODE_CONFIG_DIR`.
- Shuvcode's normal XDG data and state roots remain canonical for every caller.
- `~/.config/opencode/service.json` is private mode `0600` and contains the
  administrator credential used by trusted loopback clients.
- Mobile clients receive independently revocable device credentials through
  pairing. A bridge may keep its own client-facing credential domain while
  using the administrator credential on loopback.

Install the user unit from this repository:

```sh
install -m 0644 deploy/systemd/shuvcode.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now shuvcode.service
```

The managed server binds loopback. Publish a separate advertised URL when a
tailnet reverse proxy is used:

```sh
shuvcode service set hostname 127.0.0.1
shuvcode service set port 4096
shuvcode service set advertised-urls https://<host>.<tailnet>.ts.net:10001
systemctl --user restart shuvcode.service
tailscale serve --bg --https=10001 http://127.0.0.1:4096
```

The bind and advertised URL are deliberately different. Do not widen the bind
to make a reverse-proxy URL reachable.

## Migrating an isolated service

Stop dependent callers, back up both configuration roots, and merge the desired
server configuration into `~/.config/opencode`. Preserve the active service
password by moving it into the canonical `service.json`, then update dependent
loopback clients to the same value without printing it. Remove any systemd
drop-in that sets `OPENCODE_CONFIG_DIR`, reload the user manager, and restart
Shuvcode before its dependants.

Provider authentication stored only in a legacy credential file is not a V2
integration connection. Reconnect those providers through the V2 TUI after the
shared server is active. Do not copy credential records directly into the V2
database.

## Verification

```sh
systemctl --user show shuvcode.service \
  -p ActiveState -p SubState -p ExecStart -p Environment
ss -ltnp | rg '127\.0\.0\.1:4096'
tailscale serve status
shuvcode service get
shuvcode pair
```

Verify that interactive TUI sessions and paired mobile sessions appear in the
same session list, and that every configured V2 provider appears through the
model endpoint. Logs and verification output must not contain administrator
passwords, invitation tokens, or device credentials.
