import "@/index.css"
import { Show } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { Diff } from "@opencode-ai/ui/diff"
import { Code } from "@opencode-ai/ui/code"
import { GlobalSyncProvider } from "@/context/global-sync"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { NotificationProvider } from "@/context/notification"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import Layout from "@/pages/layout"
import Home from "@/pages/home"
import DirectoryLayout from "@/pages/directory-layout"
import Session from "@/pages/session"

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; port?: number }
  }
}

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST || location.hostname || "127.0.0.1"
const port = window.__OPENCODE__?.port ?? import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"

// Check if we should use same-origin requests (relative "/" URL)
// This is needed when:
// - Running behind a reverse proxy (HTTPS) that proxies API requests
// - Running on known production hosts
// In local dev mode with HTTP, we can hit the API server directly
const isSecure = location.protocol === "https:"
const isKnownHost =
  location.hostname.includes("opencode.ai") ||
  location.hostname.includes("shuv.ai") ||
  location.hostname.endsWith(".local")
const isLoopback = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname)

// Use same-origin when:
// - On HTTPS (must use same-origin to avoid mixed content)
// - On known production hosts
// - On loopback in non-dev mode (production build)
const useSameOrigin = isSecure || isKnownHost || (isLoopback && !import.meta.env.DEV)

// URL priority:
// 1. ?url= query parameter (explicit override)
// 2. Tauri injected port (desktop app with local server)
// 3. Same-origin mode uses relative "/" to hit the proxy
// 4. Other cases fall back to explicit host:port
const url =
  new URLSearchParams(document.location.search).get("url") ||
  (window.__OPENCODE__?.port
    ? `http://${host}:${window.__OPENCODE__.port}`
    : useSameOrigin
      ? "/"
      : `http://${host}:${port}`)

export function App() {
  return (
    <DialogProvider>
      <MarkedProvider>
        <DiffComponentProvider component={Diff}>
          <CodeComponentProvider component={Code}>
            <GlobalSDKProvider url={url}>
              <GlobalSyncProvider>
                <LayoutProvider>
                  <NotificationProvider>
                    <MetaProvider>
                      <Font />
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
                              <Show when={p.params.id || true} keyed>
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
                    </MetaProvider>
                  </NotificationProvider>
                </LayoutProvider>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </CodeComponentProvider>
        </DiffComponentProvider>
      </MarkedProvider>
    </DialogProvider>
  )
}
