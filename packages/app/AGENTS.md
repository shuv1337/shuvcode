## Debugging

- To test the opencode app, use the playwright MCP server, the app is already
  running at http://localhost:3000
- NEVER try to restart the app, or the server process, EVER.

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
