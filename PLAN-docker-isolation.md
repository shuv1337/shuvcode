# Self-Hosting Mode with Docker Isolation (Revised Plan)

This plan is written to match the current repo behavior and to be secure-by-default. It focuses on **self-hosting the web UI + API behind a single HTTP port**, while keeping existing behavior unchanged unless explicitly enabled.

## Goals

- Provide a supported "self-host" Docker Compose bundle that runs the server and serves the desktop web UI from inside the same container.
- Expose **one HTTP port** to the host for browser access.
- Maintain terminal-in-browser (PTY) access to the container shell.
- Keep default behavior unchanged unless flags/env are set.

## Reality Check (Current Repo)

- UI is currently provided via a **catch-all proxy** in `packages/opencode/src/server/server.ts:2476-2487` (unmatched routes proxy to the desktop UI host).
  - The proxy uses `Installation.isLocal()` to choose between dev URL (`OPENCODE_DESKTOP_URL` or `http://localhost:3000`) and prod URL (`SHUVCODE_DESKTOP_URL` or `https://desktop.shuv.ai`).
  - **Important**: `Installation.isLocal()` checks if `CHANNEL === "local"`, which is a **compile-time constant** set during build (`packages/opencode/script/build.ts:133`). Docker builds will NOT have `CHANNEL === "local"`.
- Server enables **permissive CORS** by default via `cors()` at `packages/opencode/src/server/server.ts:99` (Hono default is `origin: "*"`).
- The active project directory is selected per request via `?directory=` / `x-opencode-directory` at `packages/opencode/src/server/server.ts:174-183`.
  - This is convenient and powerful; in this self-host plan it remains **unrestricted** so agents can use the full container filesystem (mount only what you want accessible).
- PTY is already implemented and powerful:
  - REST endpoints: `packages/opencode/src/server/server.ts:201-321`
  - WebSocket connect: `packages/opencode/src/server/server.ts:322-358`
  - UI connects to WS: `packages/desktop/src/components/terminal.tsx:84-88`
- **Existing env var support**: The fork already uses `SHUVCODE_DESKTOP_URL` for production desktop host (line 2479).

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
- The API is not "internal on another port" in this design. It is reachable on the same origin/port as the UI, which is acceptable if:
  - the service is localhost-only, or
  - the deployment is secured by a reverse proxy and/or network controls when exposed beyond localhost.

## Proposed Environment Variables

| Variable                 | Description                      | Default | Notes                                                                             |
| ------------------------ | -------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `OPENCODE_LOCAL_UI`      | Enable local UI serving          | `false` | **Overrides** the catch-all proxy behavior regardless of `Installation.isLocal()` |
| `OPENCODE_LOCAL_UI_PATH` | Absolute path to UI `dist/`      | unset   | Used when `OPENCODE_LOCAL_UI=true`; if unset, auto-detect or error                |
| `OPENCODE_CORS_ORIGINS`  | Optional explicit CORS allowlist | unset   | Comma-separated origins; applied when `OPENCODE_LOCAL_UI=true`                    |

### Existing Environment Variables (unchanged)

| Variable               | Description                  | Current Default           |
| ---------------------- | ---------------------------- | ------------------------- |
| `OPENCODE_DESKTOP_URL` | Dev-mode desktop proxy URL   | `http://localhost:3000`   |
| `SHUVCODE_DESKTOP_URL` | Production desktop proxy URL | `https://desktop.shuv.ai` |

**Note**: When `OPENCODE_LOCAL_UI=true`, the catch-all proxy is replaced with static file serving, making `OPENCODE_DESKTOP_URL` and `SHUVCODE_DESKTOP_URL` irrelevant for that mode.

## Implementation Plan

### A) Server: Safe local UI serving

Modify the existing catch-all proxy at `packages/opencode/src/server/server.ts:2476-2487`:

1. When `OPENCODE_LOCAL_UI=true`:
   - Serve built assets from `OPENCODE_LOCAL_UI_PATH`.
   - If `OPENCODE_LOCAL_UI_PATH` is not set or directory doesn't exist, throw a clear error at startup.
2. Use Hono's static middleware for Bun:
   - **Important**: Use `serveStatic` from `hono/bun` (NOT `hono/middleware/serve-static` which doesn't exist for Bun runtime).
   - It already rejects `..` traversal attempts.
3. Add SPA fallback:
   - If no file matches, serve `index.html`.
4. Restrict UI serving to `GET`/`HEAD` only (do not forward arbitrary methods).

#### Implementation Example

```typescript
import { serveStatic } from "hono/bun"

// At the catch-all route location (replacing lines 2476-2487)
const localUI = process.env.OPENCODE_LOCAL_UI === "true"
const uiPath = process.env.OPENCODE_LOCAL_UI_PATH

if (localUI) {
  if (!uiPath) {
    throw new Error("OPENCODE_LOCAL_UI_PATH must be set when OPENCODE_LOCAL_UI=true")
  }

  // Serve static files
  app.use(
    "/*",
    serveStatic({
      root: uiPath,
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
    }),
  )

  // SPA fallback - serve index.html for unmatched routes
  app.get("/*", async (c) => {
    const file = Bun.file(`${uiPath}/index.html`)
    if (await file.exists()) {
      return c.html(await file.text())
    }
    return c.notFound()
  })
} else {
  // Existing proxy behavior
  app.all("/*", async (c) => {
    const desktopHost = Installation.isLocal()
      ? process.env.OPENCODE_DESKTOP_URL || "http://localhost:3000"
      : process.env.SHUVCODE_DESKTOP_URL || "https://desktop.shuv.ai"
    // ... existing proxy code
  })
}
```

#### Notes

- Do **not** build paths with `path.join(root, "/...")` patterns; leading `/` discards `root` and creates security bugs.
- The `serveStatic` from `hono/bun` uses Bun's native file serving which is highly performant.

### B) Server: Self-host defaults (CORS + reverse proxy compatibility)

Self-hosting becomes unsafe if the HTTP port is reachable by untrusted clients (PTY is effectively a shell). This plan intentionally does **not** add in-app auth or filesystem restrictions; it focuses on sane defaults that keep compatibility with existing remote UI behavior and common reverse proxy setups.

1. **CORS tightening for local UI mode**
   - When `OPENCODE_LOCAL_UI=true`, UI+API are same-origin; default to **not** using wildcard CORS.
   - If cross-origin clients are required, allow them only via an explicit allowlist (`OPENCODE_CORS_ORIGINS`) rather than default wildcard.
   - Keep existing permissive behavior when _not_ in local UI mode so `desktop.shuv.ai` (remote UI) continues to work.

#### CORS Implementation

Replace the current `.use(cors())` at line 99 with conditional CORS:

```typescript
import { cors } from "hono/cors"

const localUI = process.env.OPENCODE_LOCAL_UI === "true"
const corsOrigins = process.env.OPENCODE_CORS_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean)

  // Use startup-time configuration (not per-request) for performance
  .use(
    localUI
      ? cors({
          origin: corsOrigins?.length ? corsOrigins : [],
          credentials: true,
        })
      : cors(), // Default wildcard for remote UI compatibility
  )
```

2. **Reverse proxy notes (documentation)**
   - Document reverse proxy requirements:
     - Forward WebSocket upgrade for `/pty/:ptyID/connect` (`packages/opencode/src/server/server.ts:322-358`).
     - Preserve `Host` and pass `X-Forwarded-Proto` if/when absolute URL construction is needed.

3. **Health check endpoint (new)**
   - Add `GET /health` returning `200 OK` for Docker/K8s health probes:
   ```typescript
   .get('/health', (c) => c.json({ status: 'ok' }))
   ```

### C) CLI: Flags for `web` and `serve`

Add flags to both commands:

- `packages/opencode/src/cli/cmd/web.ts` (command at line 29, options at lines 31-43)
- `packages/opencode/src/cli/cmd/serve.ts` (command at line 4, options at lines 7-18)

Proposed flags:

- `--local-ui` (boolean) — enables local UI serving
- `--ui-path <path>` (string; implies `--local-ui`) — path to UI dist folder
- `--no-open` (boolean; for `web` only) — skip auto-opening browser

Implementation detail:

- Set env vars **before** calling `Server.listen(...)`:
  ```typescript
  if (args.localUi || args.uiPath) {
    process.env.OPENCODE_LOCAL_UI = "true"
  }
  if (args.uiPath) {
    process.env.OPENCODE_LOCAL_UI_PATH = path.resolve(args.uiPath)
  }
  ```

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

- Bun is pinned by root `package.json` (`packageManager: "bun@1.3.3"`) and enforced by `packages/script/src/index.ts:12-13`.
- Desktop and opencode both depend on workspace packages (e.g. `packages/desktop/package.json:32-35`, `packages/opencode/package.json:69-72`).
- Build script (`packages/opencode/script/build.ts:91-156`) produces multiple binary variants.

Proposed approach:

1. Pin Bun image version to match root `package.json` (currently `bun@1.3.3`).
2. Copy workspace root + `packages/` required for build; run `bun install` at repo root so `catalog:` and `workspace:*` resolve correctly.
3. Build UI: `bun --cwd packages/desktop run build`.
4. Build binary: `bun --cwd packages/opencode run script/build.ts --single`.
5. Runtime image includes dev tools (git, ssh, ripgrep, node, python as desired) and copies:
   - `/app/packages/desktop/dist` → `/app/desktop/dist`
   - Binary path depends on base image:
     - **Alpine (musl)**: `/app/packages/opencode/dist/shuvcode-linux-x64-baseline-musl/bin/opencode`
     - **Debian/Ubuntu (glibc)**: `/app/packages/opencode/dist/shuvcode-linux-x64/bin/opencode`

**Important**: The `--single` flag filters builds to the current platform. For cross-compilation in Docker, either:

- Build inside the target container, OR
- Remove `--single` and copy the correct variant

#### Example Dockerfile (Alpine-based)

```dockerfile
FROM oven/bun:1.3.3-alpine AS builder

WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY packages/desktop/package.json packages/desktop/
COPY packages/opencode/package.json packages/opencode/
COPY packages/util/package.json packages/util/
COPY packages/sdk/js/package.json packages/sdk/js/
COPY packages/ui/package.json packages/ui/
COPY packages/plugin/package.json packages/plugin/
COPY packages/script/package.json packages/script/

RUN bun install --frozen-lockfile

COPY . .

# Build desktop UI
RUN bun --cwd packages/desktop run build

# Build CLI binary (--single for current platform)
RUN bun --cwd packages/opencode run script/build.ts --single

FROM alpine:3.19 AS runtime

RUN apk add --no-cache libgcc libstdc++ ripgrep git openssh-client

# Copy built assets
COPY --from=builder /app/packages/desktop/dist /app/desktop/dist
COPY --from=builder /app/packages/opencode/dist/shuvcode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

ENV OPENCODE_LOCAL_UI=true
ENV OPENCODE_LOCAL_UI_PATH=/app/desktop/dist

WORKDIR /projects
EXPOSE 4096

ENTRYPOINT ["opencode", "serve", "--port", "4096", "--hostname", "0.0.0.0"]
```

Also note:

- There is an existing minimal Dockerfile at `packages/opencode/Dockerfile`. This plan adds a separate self-host bundle; it does not replace the existing Docker packaging unless explicitly decided later.

### E) Testing & Acceptance Criteria

Add tests to `packages/opencode/test/server/` directory (new):

#### Unit Tests

- **Static UI serving**:
  - `GET /` → serves `index.html` (200)
  - `GET /assets/app.js` → serves static asset (200)
  - `GET /../../../etc/passwd` → rejected (404, not file contents)
  - `GET /nonexistent-route` → serves `index.html` (SPA fallback)
  - `POST /assets/app.js` → rejected (405 Method Not Allowed)

- **CORS behavior**:
  - `OPENCODE_LOCAL_UI=false` + cross-origin request → `Access-Control-Allow-Origin: *`
  - `OPENCODE_LOCAL_UI=true` + no `OPENCODE_CORS_ORIGINS` → no CORS headers (same-origin only)
  - `OPENCODE_LOCAL_UI=true` + `OPENCODE_CORS_ORIGINS=https://example.com` → allows that origin

- **Health endpoint**:
  - `GET /health` → `200 { "status": "ok" }`

#### Integration Tests

- **Docker smoke test** (can be manual or CI):
  - `docker compose up` starts container without errors
  - `curl http://localhost:4096/` returns HTML with `<div id="app">`
  - `curl http://localhost:4096/health` returns `{"status":"ok"}`
  - WebSocket connects to `/pty/:id/connect` successfully
  - Terminal input/output works from the UI

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

> **⚠️ WARNING**: Self-host mode provides **full shell access** via the PTY endpoints. Only expose to trusted networks or behind authenticated reverse proxies.

Container isolation reduces blast radius, but self-host mode is still powerful:

- **PTY endpoints are a shell**: REST API at `packages/opencode/src/server/server.ts:201-321` and WebSocket at lines 322-358 provide full terminal access.
- **Directory selection is unrestricted**: The middleware at `packages/opencode/src/server/server.ts:174-183` allows any directory. Mount only what you want the agent to access.
- **Network exposure**: If binding to `0.0.0.0`, assume the service is reachable by other machines; do not expose it to untrusted networks without an authenticating reverse proxy (or equivalent network controls).

### Recommended Hardening (docker-compose.yml)

```yaml
services:
  shuvcode:
    # ... other config ...
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    read_only: true
    tmpfs:
      - /tmp:mode=1777
      - /root/.cache:mode=0755
```

### Reverse Proxy Example (nginx)

```nginx
location / {
    proxy_pass http://127.0.0.1:4096;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Add authentication
    auth_basic "shuvcode";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

## Implementation Phases

### Phase 1: Server-side static serving (env var gated)

- [ ] Add `OPENCODE_LOCAL_UI` and `OPENCODE_LOCAL_UI_PATH` env var handling
- [ ] Implement static file serving with `serveStatic` from `hono/bun`
- [ ] Implement SPA fallback to `index.html`
- [ ] Add conditional CORS based on `OPENCODE_LOCAL_UI`
- [ ] Add `/health` endpoint
- [ ] Add unit tests for static serving and CORS

### Phase 2: CLI flags

- [ ] Add `--local-ui` and `--ui-path` flags to `web` command
- [ ] Add `--local-ui` and `--ui-path` flags to `serve` command
- [ ] Add `--no-open` flag to `web` command

### Phase 3: Docker bundle

- [ ] Create `docker/self-host/` directory structure
- [ ] Create `Dockerfile` with multi-stage build
- [ ] Create `docker-compose.yml` with secure defaults
- [ ] Create `.dockerignore`
- [ ] Create `README.md` with usage instructions
- [ ] Test Docker build and runtime

### Phase 4: Documentation and integration tests

- [ ] Add integration tests for Docker smoke test
- [ ] Update main README with self-hosting section
- [ ] Document reverse proxy configuration

## Codebase References

| Component              | File                                           | Lines             |
| ---------------------- | ---------------------------------------------- | ----------------- |
| Catch-all proxy        | `packages/opencode/src/server/server.ts`       | 2476-2487         |
| CORS middleware        | `packages/opencode/src/server/server.ts`       | 99                |
| Directory selection    | `packages/opencode/src/server/server.ts`       | 174-183           |
| PTY REST API           | `packages/opencode/src/server/server.ts`       | 201-321           |
| PTY WebSocket          | `packages/opencode/src/server/server.ts`       | 322-358           |
| Terminal component     | `packages/desktop/src/components/terminal.tsx` | 84-88             |
| Installation.isLocal() | `packages/opencode/src/installation/index.ts`  | 61-63             |
| Build script           | `packages/opencode/script/build.ts`            | 18, 80-82, 91-156 |
| Web command            | `packages/opencode/src/cli/cmd/web.ts`         | 29-84             |
| Serve command          | `packages/opencode/src/cli/cmd/serve.ts`       | 4-32              |
| Existing Dockerfile    | `packages/opencode/Dockerfile`                 | 1-11              |

## Approval Status

**✅ READY TO IMPLEMENT**

All critical issues from the plan review have been addressed:

1. ✅ Fixed `serveStatic` import path to `hono/bun`
2. ✅ Documented interaction with existing `SHUVCODE_DESKTOP_URL` env var
3. ✅ Clarified how `OPENCODE_LOCAL_UI` overrides `Installation.isLocal()` behavior
4. ✅ Updated Dockerfile to use `shuvcode-linux-x64-baseline-musl` for Alpine
5. ✅ Added concrete code examples for static file serving implementation
6. ✅ Added health check endpoint
7. ✅ Added detailed test scenarios
8. ✅ Added reverse proxy configuration example
