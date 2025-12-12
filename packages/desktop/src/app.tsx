import "@/index.css"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { Diff } from "@opencode-ai/ui/diff"
import { GlobalSyncProvider } from "./context/global-sync"
import Layout from "@/pages/layout"
import Home from "@/pages/home"
import DirectoryLayout from "@/pages/directory-layout"
import Session from "@/pages/session"
import { LayoutProvider } from "./context/layout"
import { GlobalSDKProvider } from "./context/global-sdk"
import { SessionProvider } from "./context/session"
import { Show } from "solid-js"

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; port?: number }
  }
}

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST || "127.0.0.1"
const port = window.__OPENCODE__?.port ?? import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"

// Determine if we're in development mode (Vite sets this)
const isDev = import.meta.env.DEV

// Check if running on a known production domain (accessed via API server proxy)
// Production hosts use relative "/" path to go through the API proxy
const isProductionHost =
  location.hostname.includes("opencode.ai") ||
  location.hostname.includes("shuv.ai") ||
  location.hostname.includes("localhost")

// URL priority:
// 1. ?url= query parameter (explicit override)
// 2. Tauri injected port (desktop app with local server)
// 3. Production hosts use relative "/" (same-origin via API server proxy)
// 4. Development mode uses explicit host:port
// 5. Other cases (e.g., local IP access) use explicit URL
const url =
  new URLSearchParams(document.location.search).get("url") ||
  (window.__OPENCODE__?.port
    ? `http://${host}:${window.__OPENCODE__.port}`
    : isProductionHost
      ? "/"
      : `http://${host}:${port}`)

export function App() {
  return (
    <MarkedProvider>
      <DiffComponentProvider component={Diff}>
        <GlobalSDKProvider url={url}>
          <GlobalSyncProvider>
            <LayoutProvider>
              <MetaProvider>
                <Font />
                <Router root={Layout}>
                  <Route path="/" component={Home} />
                  <Route path="/:dir" component={DirectoryLayout}>
                    <Route path="/" component={() => <Navigate href="session" />} />
                    <Route
                      path="/session/:id?"
                      component={(p) => (
                        <Show when={p.params.id || true} keyed>
                          <SessionProvider>
                            <Session />
                          </SessionProvider>
                        </Show>
                      )}
                    />
                  </Route>
                </Router>
              </MetaProvider>
            </LayoutProvider>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </DiffComponentProvider>
    </MarkedProvider>
  )
}
