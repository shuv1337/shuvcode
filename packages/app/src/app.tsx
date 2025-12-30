import "@/index.css"
import { ErrorBoundary, Show, type ParentProps } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { Diff } from "@opencode-ai/ui/diff"
import { Code } from "@opencode-ai/ui/code"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { ServerProvider, useServer } from "@/context/server"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { NotificationProvider } from "@/context/notification"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import Layout from "@/pages/layout"
import Home from "@/pages/home"
import DirectoryLayout from "@/pages/directory-layout"
import Session from "@/pages/session"
import { ErrorPage } from "./pages/error"
import { iife } from "@opencode-ai/util/iife"
import { getStoredServerUrl, setStoredServerUrl, isValidServerUrl, addToServerUrlHistory } from "@/lib/server-url"

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; port?: number }
  }
}

// URL priority:
// 1. ?url= query parameter (explicit override) - persist if valid
// 2. Stored URL override from localStorage
// 3. Tauri injected port (desktop app with local server)
// 4. Same-origin mode uses relative "/" to hit the proxy
// 5. Other cases fall back to explicit host:port (dev mode)
const OPENCODE_THEME_STORAGE_KEYS = [
  "opencode-theme-id",
  "opencode-color-scheme",
  "opencode-theme-css-light",
  "opencode-theme-css-dark",
]

if (typeof window !== "undefined") {
  for (const key of OPENCODE_THEME_STORAGE_KEYS) {
    localStorage.removeItem(key)
  }
  document.getElementById("oc-theme")?.remove()
  document.getElementById("oc-theme-preload")?.remove()
  document.documentElement.removeAttribute("data-color-scheme")
}

const defaultServerUrl = iife(() => {
  // 1. Query parameter (highest priority) - persist if valid
  const queryUrl = new URLSearchParams(document.location.search).get("url")
  if (queryUrl && isValidServerUrl(queryUrl)) {
    setStoredServerUrl(queryUrl)
    addToServerUrlHistory(queryUrl)
    return queryUrl
  }

  // 2. Stored URL override
  const storedUrl = getStoredServerUrl()
  if (storedUrl) return storedUrl

  // 3-5. Existing logic (preserved exactly)
  const host = import.meta.env.VITE_OPENCODE_SERVER_HOST || location.hostname || "127.0.0.1"
  const port = window.__OPENCODE__?.port ?? import.meta.env.VITE_OPENCODE_SERVER_PORT ?? location.port ?? "4096"

  // Check if we should use same-origin requests (relative "/" URL)
  // This is needed when:
  // - Running behind a reverse proxy (HTTPS) that proxies API requests
  // - Running on known production hosts
  // - Running the web command (API and frontend served from same server)
  // In local dev mode with HTTP, we can hit the API server directly
  const isSecure = location.protocol === "https:"
  const isKnownHost =
    location.hostname.includes("opencode.ai") ||
    location.hostname.includes("shuv.ai") ||
    location.hostname.endsWith(".local")
  const isLoopback = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname)
  // When accessed via non-loopback IP (e.g., LAN IP), we're still on the same server
  // so we should use same-origin mode. Dev mode with Vite needs explicit host:port.
  const isWebCommand = !import.meta.env.DEV

  // Use same-origin when:
  // - On HTTPS (must use same-origin to avoid mixed content)
  // - On known production hosts
  // - On loopback in non-dev mode (production build)
  // - On any host in non-dev mode (web command serves API and frontend together)
  const useSameOrigin = isSecure || isKnownHost || (isLoopback && !import.meta.env.DEV) || isWebCommand

  // 3. Tauri desktop
  if (window.__OPENCODE__?.port) {
    return `http://${host}:${window.__OPENCODE__.port}`
  }

  // 4. Same-origin mode
  if (useSameOrigin) {
    return "/"
  }

  // 5. Explicit host:port (dev mode)
  return `http://${host}:${port}`
})

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.url} keyed>
      {props.children}
    </Show>
  )
}

export function App() {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider defaultTheme="nightowl">
        <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
          <DialogProvider>
            <MarkedProvider>
              <DiffComponentProvider component={Diff}>
                <CodeComponentProvider component={Code}>
                  <ServerProvider defaultUrl={defaultServerUrl}>
                    <ServerKey>
                      <GlobalSDKProvider>
                        <GlobalSyncProvider>
                          <LayoutProvider>
                            <NotificationProvider>
                              <Router
                                root={(props) => (
                                  <CommandProvider>
                                    <Layout>{props.children}</Layout>
                                  </CommandProvider>
                                )}
                              >
                                <Route path="/" component={Home} />
                                <Route path="/:dir" component={DirectoryLayout}>
                                  <Route path="/" component={() => <Navigate href="session" />} />
                                  <Route
                                    path="/session/:id?"
                                    component={(p) => (
                                      <Show when={p.params.id ?? "new"} keyed>
                                        <TerminalProvider>
                                          <PromptProvider>
                                            <Session />
                                          </PromptProvider>
                                        </TerminalProvider>
                                      </Show>
                                    )}
                                  />
                                </Route>
                              </Router>
                            </NotificationProvider>
                          </LayoutProvider>
                        </GlobalSyncProvider>
                      </GlobalSDKProvider>
                    </ServerKey>
                  </ServerProvider>
                </CodeComponentProvider>
              </DiffComponentProvider>
            </MarkedProvider>
          </DialogProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </MetaProvider>
  )
}
