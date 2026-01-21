## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Running Desktop in Development

To run the desktop app in development mode, you need **two terminals**:

1. **Terminal 1 - API Server** (from repo root):

   ```bash
   bun run dev serve --port 4096
   ```

2. **Terminal 2 - Desktop App** (from packages/desktop):
   ```bash
   bun run dev
   ```

The desktop dev server runs at http://localhost:3000 and connects to the API at port 4096.

**Note**: The `--port 4096` flag is required because the server defaults to a random port (for multi-instance support in Tauri). The `.env.development` file sets `VITE_OPENCODE_SERVER_PORT=4096` so the desktop app knows where to connect.

## Code Style

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
