# V2 HTTP API audit checklist

**Source:** `packages/protocol/openapi.json`  
**Current endpoint count:** 143  
**Last regenerated:** 2026-09-13

## How to use this checklist

Review endpoints in document order. For each endpoint, select one disposition and capture rationale or follow-up work in Notes. Mark **Reviewed** only after the disposition is agreed.

### Review criteria

- Resource and operation naming
- HTTP method and idempotency
- Request parameters and location scope
- Response shape and error taxonomy
- Authentication and authorization
- Current production consumers
- Stability level: public, experimental, or internal
- Whether the generated client API is intuitive

### Disposition legend

- **Keep:** ship unchanged as a supported V2 API
- **Change:** retain after a defined contract change
- **Remove:** exclude from the official V2 API
- **Experimental-only:** retain outside the stable API commitment

## Progress

- [ ] Group 1: Foundation and placement (7)
- [ ] Group 2: Configuration and capability catalogs (17)
- [ ] Group 3: Credentials, integrations, MCP, and web search (22)
- [ ] Group 4: Session lifecycle (12)
- [ ] Group 5: Session execution and inputs (11)
- [ ] Group 6: Session history and recovery (13)
- [ ] Group 7: Inbox, permissions, and forms (19)
- [ ] Group 8: Filesystem, worktrees, and VCS (12)
- [ ] Group 9: PTYs, persistent terminals, and shells (24)
- [ ] Group 10: Events, RPC, and experimental operations (6)

## Resolved during audit

### [x] `GET /api/project/current`

- **Decision:** Remove
- **Replacement:** `GET /api/location`, using `project` from the response.
- **Notes:** The endpoint duplicated `Location.Info.project`; production callers were migrated.

## Group 1: Foundation and placement

**Endpoints:** 7

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 001 | `GET` | `/api/health` | `v2.health.get` |  |  |
| [ ] 002 | `GET` | `/api/server` | `v2.server.get` |  |  |
| [ ] 003 | `GET` | `/api/location` | `v2.location.get` |  |  |
| [ ] 004 | `GET` | `/api/project` | `v2.project.list` |  |  |
| [ ] 005 | `PATCH` | `/api/project/{projectID}` | `v2.project.update` |  |  |
| [ ] 006 | `POST` | `/api/workspace` | `v2.workspace.create` | Proposed remove | Awaiting feedback in `#core`. |
| [ ] 007 | `DELETE` | `/api/workspace/{workspaceID}` | `v2.workspace.destroy` | Proposed remove | Awaiting feedback in `#core`. |

## Group 2: Configuration and capability catalogs

**Endpoints:** 17

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 008 | `GET` | `/api/agent` | `v2.agent.list` |  |  |
| [ ] 009 | `GET` | `/api/agent/{agentID}` | `v2.agent.get` |  |  |
| [ ] 010 | `GET` | `/api/plugin` | `v2.plugin.list` |  |  |
| [ ] 011 | `POST` | `/api/plugin/await-activation` | `v2.plugin.awaitActivation` |  |  |
| [ ] 012 | `POST` | `/api/plugin/check` | `v2.plugin.check` |  |  |
| [ ] 013 | `POST` | `/api/plugin/update` | `v2.plugin.update` |  |  |
| [ ] 014 | `GET` | `/api/model` | `v2.model.list` |  |  |
| [ ] 015 | `GET` | `/api/model/default` | `v2.model.default` |  |  |
| [ ] 016 | `GET` | `/api/provider` | `v2.provider.list` |  |  |
| [ ] 017 | `GET` | `/api/provider/{providerID}` | `v2.provider.get` |  |  |
| [ ] 018 | `GET` | `/api/command` | `v2.command.list` |  |  |
| [ ] 019 | `GET` | `/api/skill` | `v2.skill.list` |  |  |
| [ ] 020 | `GET` | `/api/reference` | `v2.reference.list` |  |  |
| [ ] 021 | `GET` | `/api/config` | `v2.config.get` |  |  |
| [ ] 022 | `GET` | `/api/config/preferences` | `v2.config.preferences` |  |  |
| [ ] 023 | `PATCH` | `/api/config/preferences` | `v2.config.updatePreferences` |  |  |
| [ ] 024 | `GET` | `/api/config/shell` | `v2.config.shells` |  |  |

## Group 3: Credentials, integrations, MCP, and web search

**Endpoints:** 22

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 025 | `GET` | `/api/integration` | `v2.integration.list` |  |  |
| [ ] 026 | `GET` | `/api/integration/{integrationID}` | `v2.integration.get` |  |  |
| [ ] 027 | `POST` | `/api/experimental/integration/wellknown` | `v2.experimental.integration.wellknown.add` |  |  |
| [ ] 028 | `POST` | `/api/integration/{integrationID}/connect/key` | `v2.integration.connect.key` |  |  |
| [ ] 029 | `POST` | `/api/integration/{integrationID}/connect/oauth` | `v2.integration.oauth.connect` |  |  |
| [ ] 030 | `GET` | `/api/integration/{integrationID}/connect/oauth/{attemptID}` | `v2.integration.oauth.status` |  |  |
| [ ] 031 | `DELETE` | `/api/integration/{integrationID}/connect/oauth/{attemptID}` | `v2.integration.oauth.cancel` |  |  |
| [ ] 032 | `POST` | `/api/integration/{integrationID}/connect/oauth/{attemptID}/complete` | `v2.integration.oauth.complete` |  |  |
| [ ] 033 | `POST` | `/api/integration/{integrationID}/connect/command` | `v2.integration.command.connect` |  |  |
| [ ] 034 | `GET` | `/api/integration/{integrationID}/connect/command/{attemptID}` | `v2.integration.command.status` |  |  |
| [ ] 035 | `DELETE` | `/api/integration/{integrationID}/connect/command/{attemptID}` | `v2.integration.command.cancel` |  |  |
| [ ] 036 | `GET` | `/api/mcp` | `v2.mcp.list` |  |  |
| [ ] 037 | `PUT` | `/api/mcp/{server}` | `v2.mcp.add` |  |  |
| [ ] 038 | `DELETE` | `/api/mcp/{server}` | `v2.mcp.remove` |  |  |
| [ ] 039 | `POST` | `/api/mcp/{server}/connect` | `v2.mcp.connect` |  |  |
| [ ] 040 | `POST` | `/api/mcp/{server}/disconnect` | `v2.mcp.disconnect` |  |  |
| [ ] 041 | `GET` | `/api/mcp/resource` | `v2.mcp.resource.catalog` |  |  |
| [ ] 042 | `PATCH` | `/api/credential/{credentialID}` | `v2.credential.update` |  |  |
| [ ] 043 | `DELETE` | `/api/credential/{credentialID}` | `v2.credential.remove` |  |  |
| [ ] 044 | `POST` | `/api/credential/{credentialID}/activate` | `v2.credential.activate` |  |  |
| [ ] 045 | `GET` | `/api/websearch/provider` | `v2.websearch.providers` |  |  |
| [ ] 046 | `POST` | `/api/websearch` | `v2.websearch.query` |  |  |

## Group 4: Session lifecycle

**Endpoints:** 12

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 047 | `GET` | `/api/session` | `v2.session.list` |  |  |
| [ ] 048 | `POST` | `/api/session` | `v2.session.create` |  |  |
| [ ] 049 | `GET` | `/api/session/stats` | `v2.session.stats` |  |  |
| [ ] 050 | `GET` | `/api/session/active` | `v2.session.active` |  |  |
| [ ] 051 | `GET` | `/api/session/{sessionID}` | `v2.session.get` |  |  |
| [ ] 052 | `DELETE` | `/api/session/{sessionID}` | `v2.session.remove` |  |  |
| [ ] 053 | `POST` | `/api/session/{sessionID}/fork` | `v2.session.fork` |  |  |
| [ ] 054 | `POST` | `/api/session/{sessionID}/agent` | `v2.session.switchAgent` |  |  |
| [ ] 055 | `POST` | `/api/session/{sessionID}/model` | `v2.session.switchModel` |  |  |
| [ ] 056 | `POST` | `/api/session/{sessionID}/rename` | `v2.session.rename` |  |  |
| [ ] 057 | `POST` | `/api/session/{sessionID}/move` | `v2.session.move` |  |  |
| [ ] 058 | `POST` | `/api/session/{sessionID}/background` | `v2.session.background` |  |  |

## Group 5: Session execution and inputs

**Endpoints:** 11

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 059 | `POST` | `/api/session/{sessionID}/prompt` | `v2.session.prompt` |  |  |
| [ ] 060 | `POST` | `/api/session/{sessionID}/command` | `v2.session.command` |  |  |
| [ ] 061 | `POST` | `/api/session/{sessionID}/skill` | `v2.session.skill` |  |  |
| [ ] 062 | `POST` | `/api/session/{sessionID}/synthetic` | `v2.session.synthetic` |  |  |
| [ ] 063 | `POST` | `/api/session/{sessionID}/shell` | `v2.session.shell` |  |  |
| [ ] 064 | `POST` | `/api/session/{sessionID}/compact` | `v2.session.compact` |  |  |
| [ ] 065 | `POST` | `/api/session/{sessionID}/wait` | `v2.session.wait` |  |  |
| [ ] 066 | `POST` | `/api/session/{sessionID}/generate` | `v2.session.generate` |  |  |
| [ ] 067 | `POST` | `/api/session/{sessionID}/interrupt` | `v2.session.interrupt` |  |  |
| [ ] 068 | `PUT` | `/api/session/{sessionID}/environment` | `v2.session.environment` |  |  |
| [ ] 069 | `POST` | `/api/session/{sessionID}/view` | `v2.session.view` |  |  |

## Group 6: Session history and recovery

**Endpoints:** 13

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 070 | `POST` | `/api/session/import` | `v2.session.import` |  |  |
| [ ] 071 | `GET` | `/api/session/{sessionID}/export` | `v2.session.export` |  |  |
| [ ] 072 | `POST` | `/api/session/{sessionID}/revert/stage` | `v2.session.revert.stage` |  |  |
| [ ] 073 | `POST` | `/api/session/{sessionID}/revert/clear` | `v2.session.revert.clear` |  |  |
| [ ] 074 | `POST` | `/api/session/{sessionID}/revert/commit` | `v2.session.revert.commit` |  |  |
| [ ] 075 | `GET` | `/api/session/{sessionID}/context` | `v2.session.context` |  |  |
| [ ] 076 | `GET` | `/api/session/{sessionID}/diff` | `v2.session.diff` |  |  |
| [ ] 077 | `GET` | `/api/session/{sessionID}/instructions/entries` | `v2.session.instructions.entry.list` |  |  |
| [ ] 078 | `PUT` | `/api/session/{sessionID}/instructions/entries/{key}` | `v2.session.instructions.entry.put` |  |  |
| [ ] 079 | `DELETE` | `/api/session/{sessionID}/instructions/entries/{key}` | `v2.session.instructions.entry.remove` |  |  |
| [ ] 080 | `GET` | `/api/experimental/session/{sessionID}/log` | `v2.session.log` |  |  |
| [ ] 081 | `GET` | `/api/session/{sessionID}/message/{messageID}` | `v2.session.message` |  |  |
| [ ] 082 | `GET` | `/api/session/{sessionID}/message` | `v2.message.list` |  |  |

## Group 7: Inbox, permissions, and forms

**Endpoints:** 19

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 083 | `GET` | `/api/session/{sessionID}/inbox` | `v2.session.inbox.list` |  |  |
| [ ] 084 | `DELETE` | `/api/session/{sessionID}/inbox/{inboxID}` | `v2.session.inbox.cancel` |  |  |
| [ ] 085 | `POST` | `/api/session/{sessionID}/inbox/{inboxID}/steer` | `v2.session.inbox.steer` |  |  |
| [ ] 086 | `POST` | `/api/session/{sessionID}/inbox/{inboxID}/queue` | `v2.session.inbox.queue` |  |  |
| [ ] 087 | `GET` | `/api/form/request` | `v2.form.request.list` |  |  |
| [ ] 088 | `GET` | `/api/session/{sessionID}/form` | `v2.session.form.list` |  |  |
| [ ] 089 | `POST` | `/api/session/{sessionID}/form` | `v2.session.form.create` |  |  |
| [ ] 090 | `GET` | `/api/session/{sessionID}/form/{formID}` | `v2.session.form.get` |  |  |
| [ ] 091 | `GET` | `/api/session/{sessionID}/form/{formID}/state` | `v2.session.form.state` |  |  |
| [ ] 092 | `POST` | `/api/session/{sessionID}/form/{formID}/reply` | `v2.session.form.reply` |  |  |
| [ ] 093 | `POST` | `/api/session/{sessionID}/form/{formID}/cancel` | `v2.session.form.cancel` |  |  |
| [ ] 094 | `GET` | `/api/permission/request` | `v2.permission.request.list` |  |  |
| [ ] 095 | `GET` | `/api/permission/saved` | `v2.permission.saved.list` |  |  |
| [ ] 096 | `DELETE` | `/api/permission/saved/{id}` | `v2.permission.saved.remove` |  |  |
| [ ] 097 | `POST` | `/api/session/{sessionID}/permission` | `v2.session.permission.create` |  |  |
| [ ] 098 | `GET` | `/api/session/{sessionID}/permission` | `v2.session.permission.list` |  |  |
| [ ] 099 | `GET` | `/api/session/{sessionID}/permission/{requestID}` | `v2.session.permission.get` |  |  |
| [ ] 100 | `POST` | `/api/session/{sessionID}/permission/{requestID}/reply` | `v2.session.permission.reply` |  |  |
| [ ] 101 | `PUT` | `/api/session/{sessionID}/permission/rules` | `v2.session.permission.rules` |  |  |

## Group 8: Filesystem, worktrees, and VCS

**Endpoints:** 12

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 102 | `GET` | `/api/fs/read/*` | `v2.fs.read` |  |  |
| [ ] 103 | `GET` | `/api/fs/list` | `v2.fs.list` |  |  |
| [ ] 104 | `GET` | `/api/fs/find` | `v2.fs.find` |  |  |
| [ ] 105 | `GET` | `/api/worktree` | `v2.worktree.list` |  |  |
| [ ] 106 | `POST` | `/api/worktree` | `v2.worktree.create` |  |  |
| [ ] 107 | `DELETE` | `/api/worktree` | `v2.worktree.remove` |  |  |
| [ ] 108 | `POST` | `/api/worktree/refresh` | `v2.worktree.refresh` |  |  |
| [ ] 109 | `GET` | `/api/vcs` | `v2.vcs.get` |  |  |
| [ ] 110 | `GET` | `/api/vcs/base` | `v2.vcs.base` |  |  |
| [ ] 111 | `GET` | `/api/vcs/status` | `v2.vcs.status` |  |  |
| [ ] 112 | `GET` | `/api/vcs/branches` | `v2.vcs.branches` |  |  |
| [ ] 113 | `GET` | `/api/vcs/diff` | `v2.vcs.diff` |  |  |

## Group 9: PTYs, persistent terminals, and shells

**Endpoints:** 24

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 114 | `GET` | `/api/pty` | `v2.pty.list` |  |  |
| [ ] 115 | `POST` | `/api/pty` | `v2.pty.create` |  |  |
| [ ] 116 | `GET` | `/api/pty/{ptyID}` | `v2.pty.get` |  |  |
| [ ] 117 | `PUT` | `/api/pty/{ptyID}` | `v2.pty.update` |  |  |
| [ ] 118 | `DELETE` | `/api/pty/{ptyID}` | `v2.pty.remove` |  |  |
| [ ] 119 | `POST` | `/api/pty/{ptyID}/connect-token` | `v2.pty.connect.token` |  |  |
| [ ] 120 | `GET` | `/api/pty/{ptyID}/connect` | `v2.pty.connect` |  |  |
| [ ] 121 | `GET` | `/api/experimental/session/{sessionID}/terminal/read` | `server.experimental.persistentPty.read` |  |  |
| [ ] 122 | `GET` | `/api/experimental/session/{sessionID}/terminal` | `server.experimental.persistentPty.list` |  |  |
| [ ] 123 | `POST` | `/api/experimental/session/{sessionID}/terminal` | `server.experimental.persistentPty.create` |  |  |
| [ ] 124 | `POST` | `/api/experimental/persistent-pty/shutdown` | `server.experimental.persistentPty.shutdown` |  |  |
| [ ] 125 | `POST` | `/api/experimental/persistent-pty/handoff` | `server.experimental.persistentPty.handoff` |  |  |
| [ ] 126 | `GET` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.get` |  |  |
| [ ] 127 | `PUT` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.update` |  |  |
| [ ] 128 | `DELETE` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.remove` |  |  |
| [ ] 129 | `GET` | `/api/experimental/persistent-pty/{ptyID}/snapshot` | `server.experimental.persistentPty.snapshot` |  |  |
| [ ] 130 | `POST` | `/api/experimental/persistent-pty/{ptyID}/connect-token` | `server.experimental.persistentPty.connectToken` |  |  |
| [ ] 131 | `GET` | `/api/experimental/persistent-pty/{ptyID}/connect` | `v2.persistentPty.connect` |  |  |
| [ ] 132 | `GET` | `/api/shell` | `v2.shell.list` |  |  |
| [ ] 133 | `POST` | `/api/shell` | `v2.shell.create` |  |  |
| [ ] 134 | `GET` | `/api/shell/{id}` | `v2.shell.get` |  |  |
| [ ] 135 | `DELETE` | `/api/shell/{id}` | `v2.shell.remove` |  |  |
| [ ] 136 | `PATCH` | `/api/shell/{id}/timeout` | `v2.shell.timeout` |  |  |
| [ ] 137 | `GET` | `/api/shell/{id}/output` | `v2.shell.output` |  |  |

## Group 10: Events, RPC, and experimental operations

**Endpoints:** 6

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 138 | `POST` | `/api/generate` | `v2.generate.text` |  |  |
| [ ] 139 | `POST` | `/api/rpc/{rpcID}/{method}` | `v2.rpc.call` |  |  |
| [ ] 140 | `GET` | `/api/event` | `v2.event.subscribe` |  |  |
| [ ] 141 | `GET` | `/api/debug/location` | `v2.debug.location.list` |  |  |
| [ ] 142 | `DELETE` | `/api/debug/location` | `v2.debug.location.evict` |  |  |
| [ ] 143 | `GET` | `/api/experimental/migration/v1` | `v2.experimental.migration.v1.status` |  |  |
