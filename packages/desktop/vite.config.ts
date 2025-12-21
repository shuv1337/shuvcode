import { defineConfig } from "vite"
import { readFileSync } from "fs"
import { VitePWA } from "vite-plugin-pwa"
import desktopPlugin from "./vite"

import { execSync } from "child_process"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))
const commitHash = process.env.OPENCODE_COMMIT_HASH || (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
  } catch {
    return "unknown"
  }
})()
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
  plugins: [
    desktopPlugin,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon.svg", "favicon-96x96.png", "apple-touch-icon.png"],
      manifest: false, // Use the existing site.webmanifest
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB - allow larger JS bundles
        // Don't cache API routes
        navigateFallbackDenylist: apiRoutes.map((route) => new RegExp(`^${route}`)),
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "jsdelivr-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true, // Enable PWA in development mode for testing
      },
    }),
  ] as any,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_HASH__: JSON.stringify(commitHash),
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
    sourcemap: true,
  },
})
