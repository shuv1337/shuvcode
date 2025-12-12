# Self-Hosting Mode with Docker Isolation (Revised Plan)

This plan is written to match the current repo behavior and to be secure-by-default. It focuses on **self-hosting the web UI + API behind a single HTTP port**, while keeping existing behavior unchanged unless explicitly enabled.

## Goals

- Provide a supported “self-host” Docker Compose bundle that runs the server and serves the desktop web UI from inside the same container.
- Expose **one HTTP port** to the host for browser access.
- Maintain terminal-in-browser (PTY) access to the container shell.
- Keep default behavior unchanged unless flags/env are set.

## Reality Check (Current Repo)

- UI is currently provided via a **catch-all proxy** in `packages/opencode/src/server/server.ts:2476` (unmatched routes proxy to the desktop UI host).
- Server enables **permissive CORS** by default via `cors()` at `packages/opencode/src/server/server.ts:99` (Hono default is `origin: "*"`).
- The active project directory is selected per request via `?directory=` / `x-opencode-directory` at `packages/opencode/src/server/server.ts:175`.
  - This is convenient and powerful; in this self-host plan it remains **unrestricted** so agents can use the full container filesystem (mount only what you want accessible).
- PTY is already implemented and powerful:
  - REST endpoints: `packages/opencode/src/server/server.ts:202`
  - WebSocket connect: `packages/opencode/src/server/server.ts:323`
  - UI connects to WS: `packages/desktop/src/components/terminal.tsx:84`

## Decisions Required (Pick Defaults Before Coding)

1. **Default network exposure**
   - Recommended: Docker binds to loopback only (`127.0.0.1`).
   - Optional: Allow LAN binding (`0.0.0.0`) for reverse-proxy/self-host users.
2. **Access control**
   - This plan does **not** add app-level HTTP auth; assume users who expose this beyond localhost will secure it via a reverse proxy (auth/TLS) and/or network controls.
3. **Filesystem access**
   - This plan does **not** enforce directory allowlists; agents are intended to have full filesystem access inside the container (plus whatever host volumes the user mounts).

## Architecture Overview (Reconciled With Reality)

- A single Bun/Hono server serves:
  - API routes (`/session`, `/config`, `/pty`, …)
  - UI assets and SPA fallback (`index.html`)
- The API is not “internal on another port” in this design. It is reachable on the same origin/port as the UI, which is acceptable if:
  - the service is localhost-only, or
  - the deployment is secured by a reverse proxy and/or network controls when exposed beyond localhost.

## Proposed Environment Variables

| Variable                    | Description                      | Default                 |
| --------------------------- | -------------------------------- | ----------------------- |
| `OPENCODE_LOCAL_UI`         | Enable local UI serving          | `false`                 |
| `OPENCODE_LOCAL_UI_PATH`    | Absolute path to UI `dist/`      | unset                   |
| `OPENCODE_LOCAL_UI_DEV_URL` | Dev-server URL fallback          | `http://localhost:3000` |
| `OPENCODE_CORS_ORIGINS`     | Optional explicit CORS allowlist | unset                   |

## Implementation Plan

### A) Server: Safe local UI serving

Modify the existing catch-all proxy at `packages/opencode/src/server/server.ts:2476`:

1. When `OPENCODE_LOCAL_UI=true`:
   - Prefer serving built assets from `OPENCODE_LOCAL_UI_PATH` (or auto-detect).
   - If no dist folder is available, fall back to proxying to `OPENCODE_LOCAL_UI_DEV_URL` (dev server).
2. Use Hono’s static middleware:
   - `serveStatic` from `hono/middleware/serve-static` (it already rejects `..` traversal).
3. Add SPA fallback:
   - If no file matches, serve `index.html`.
4. Restrict UI serving/proxying to `GET`/`HEAD` only (do not forward arbitrary methods).

Notes:

- Do **not** build paths with `path.join(root, "/...")` patterns; leading `/` discards `root` and creates security bugs. Use `serveStatic` and/or `rewriteRequestPath`.

### B) Server: Self-host defaults (CORS + reverse proxy compatibility)

Self-hosting becomes unsafe if the HTTP port is reachable by untrusted clients (PTY is effectively a shell). This plan intentionally does **not** add in-app auth or filesystem restrictions; it focuses on sane defaults that keep compatibility with existing remote UI behavior and common reverse proxy setups.

1. **CORS tightening for local UI mode**
   - When `OPENCODE_LOCAL_UI=true`, UI+API are same-origin; default to **not** using wildcard CORS.
   - If cross-origin clients are required, allow them only via an explicit allowlist (`OPENCODE_CORS_ORIGINS`) rather than default wildcard.
   - Keep existing permissive behavior when _not_ in local UI mode so `desktop.shuv.ai` (remote UI) continues to work.

2. **Reverse proxy notes (documentation)**
   - Document reverse proxy requirements:
     - Forward WebSocket upgrade for `/pty/:ptyID/connect` (`packages/opencode/src/server/server.ts:323`).
     - Preserve `Host` and pass `X-Forwarded-Proto` if/when absolute URL construction is needed.

### C) CLI: Flags for `web` and `serve`

Add flags to both:

- `packages/opencode/src/cli/cmd/web.ts:29`
- `packages/opencode/src/cli/cmd/serve.ts:4`

Proposed flags:

- `--local-ui` (boolean)
- `--ui-path <path>` (string; implies `--local-ui`)
- `--ui-dev-url <url>` (string; implies `--local-ui`)
- `--no-open` (boolean; for `web` only)

Implementation detail:

- Set env vars **before** calling `Server.listen(...)`.

### D) Docker: Self-host bundle (workspace-correct build)

Create a new bundle under `docker/self-host/`:

- `docker/self-host/docker-compose.yml`
- `docker/self-host/Dockerfile`
- `docker/self-host/.dockerignore` (exclude host `node_modules`, `dist`, etc.)
- `docker/self-host/README.md`

#### `docker-compose.yml` (secure defaults)

- Bind to localhost by default:
  - `127.0.0.1:4096:4096`
- Support optional LAN binding (for reverse proxy / LAN-only setups):
  - `0.0.0.0:4096:4096`
  - Provide either:
    - an env-var override like `SHUVCODE_BIND_ADDR` in the ports mapping (e.g. `${SHUVCODE_BIND_ADDR:-127.0.0.1}:4096:4096`), or
    - a `docker-compose.lan.yml` override file.
- Mount:
  - `${PROJECTS_DIR}:/projects`
  - `~/.config/opencode:/root/.config/opencode`
  - `~/.local/share/opencode:/root/.local/share/opencode`
- Set:
  - `OPENCODE_LOCAL_UI=true`
  - `OPENCODE_LOCAL_UI_PATH=/app/desktop/dist`
- Optional:
  - If exposing beyond localhost, recommend securing via reverse proxy auth/TLS (or equivalent network controls).

#### `Dockerfile` (pinned + workspace-aware)

Constraints from repo:

- Bun is pinned by root `package.json` and enforced by `packages/script/src/index.ts:12`.
- Desktop and opencode both depend on workspace packages (e.g. `packages/desktop/package.json:32`, `packages/opencode/package.json:69`).

Proposed approach:

1. Pin Bun image version to match root `package.json` (currently bun@1.3.3).
2. Copy workspace root + `packages/` required for build; run `bun install` at repo root so `catalog:` and `workspace:*` resolve correctly.
3. Build UI: `bun --cwd packages/desktop run build`.
4. Build binary: `bun --cwd packages/opencode run script/build.ts --single`.
5. Runtime image includes dev tools (git, ssh, ripgrep, node, python as desired) and copies:
   - `/app/packages/desktop/dist` → `/app/desktop/dist`
   - `/app/packages/opencode/dist/shuvcode-linux-x64/bin/opencode` → `/usr/local/bin/opencode`

Also note:

- There is an existing minimal Dockerfile at `packages/opencode/Dockerfile:1`. This plan adds a separate self-host bundle; it does not replace the existing Docker packaging unless explicitly decided later.

### E) Testing & Acceptance Criteria

Add/ensure coverage for:

- Static UI serving:
  - asset requests succeed (e.g. `/assets/...`)
  - SPA routes fall back to `index.html`
  - traversal attempts are rejected (e.g. `/../etc/passwd`)
- Self-host behavior:
  - CORS is not wildcard by default in local UI mode
- Docker smoke:
  - `docker compose up` serves UI on `http://localhost:4096`
  - terminal works (PTY WS connects) from the UI

## Usage (Updated)

### Local (no Docker)

```bash
# Build UI once
bun --cwd packages/desktop run build

# Serve UI from dist via the server
opencode web --port 4096 --local-ui --ui-path packages/desktop/dist
```

### Docker (recommended, localhost-only)

```bash
cd docker/self-host
PROJECTS_DIR=~/code docker compose up -d
```

### Docker (LAN binding for reverse proxy)

```bash
cd docker/self-host
PROJECTS_DIR=~/code SHUVCODE_BIND_ADDR=0.0.0.0 docker compose up -d
```

## Security Notes (Updated)

Container isolation reduces blast radius, but self-host mode is still powerful:

- PTY endpoints (`packages/opencode/src/server/server.ts:202`, `packages/opencode/src/server/server.ts:323`) are effectively a shell.
- Directory selection (`packages/opencode/src/server/server.ts:175`) is intentionally unrestricted; mount only what you want the agent to access.
- If binding to `0.0.0.0`, assume the service is reachable by other machines; do not expose it to untrusted networks without an authenticating reverse proxy (or equivalent network controls).

Optional hardening (compose):

```yaml
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
read_only: true
tmpfs:
  - /tmp
```
