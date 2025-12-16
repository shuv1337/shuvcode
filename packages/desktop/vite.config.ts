import { defineConfig } from "vite"
import { readFileSync } from "fs"
import desktopPlugin from "./vite"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))
const apiPort = process.env.VITE_OPENCODE_SERVER_PORT ?? "4096"
const apiTarget = `http://127.0.0.1:${apiPort}`

// All API route prefixes from the opencode server
const apiRoutes = [
  "/agent",
  "/auth",
  "/command",
  "/config",
  "/doc",
  "/event",
  "/experimental",
  "/file",
  "/find",
  "/formatter",
  "/global",
  "/instance",
  "/log",
  "/lsp",
  "/mcp",
  "/path",
  "/project",
  "/provider",
  "/pty",
  "/session",
  "/tui",
  "/vcs",
]

export default defineConfig({
  plugins: [desktopPlugin] as any,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: Object.fromEntries(
      apiRoutes.map((route) => [
        route,
        {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      ]),
    ),
  },
  build: {
    target: "esnext",
  },
})
