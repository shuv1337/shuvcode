import "@/index.css"
import { ErrorBoundary, Show, lazy, type ParentProps } from "solid-js"
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
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { ServerProvider, useServer } from "@/context/server"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { NotificationProvider } from "@/context/notification"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { Logo } from "@opencode-ai/ui/logo"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
import { iife } from "@opencode-ai/util/iife"
import { Suspense } from "solid-js"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full flex items-center justify-center text-text-weak">Loading...</div>

declare global {
  interface Window {
    __SHUVCODE__?: { updaterEnabled?: boolean; port?: number; serverReady?: boolean }
    __OPENCODE__?: { updaterEnabled?: boolean; port?: number; serverReady?: boolean; serverUrl?: string }
  }
}

const defaultServerUrl = iife(() => {
  // 1. Query parameter (highest priority)
  const param = new URLSearchParams(document.location.search).get("url")
  if (param) return param

  // 2. Configured server URL (from desktop settings)
  if (window.__OPENCODE__?.serverUrl) return window.__OPENCODE__.serverUrl

  // 3. Known production hosts -> localhost (same as upstream + shuv.ai)
  if (location.hostname.includes("opencode.ai") || location.hostname.includes("shuv.ai"))
    return "http://localhost:4096"

  // 4. Desktop app (Tauri) with injected port
  if (window.__SHUVCODE__?.port) return `http://127.0.0.1:${window.__SHUVCODE__.port}`
  if (window.__OPENCODE__?.port) return `http://127.0.0.1:${window.__OPENCODE__.port}`

  // 5. Dev mode -> same-origin so Vite proxy handles LAN access + CORS
  if (import.meta.env.DEV) {
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  }

  // 6. Default -> same origin (production web command)
  return window.location.origin
})

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
          <DialogProvider>
            <MarkedProvider>
              <DiffComponentProvider component={Diff}>
                <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
              </DiffComponentProvider>
            </MarkedProvider>
          </DialogProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.url} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface() {
  return (
    <ServerProvider defaultUrl={defaultServerUrl}>
      <ServerKey>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
            <Router
              root={(props) => (
                <PermissionProvider>
                  <LayoutProvider>
                    <NotificationProvider>
                      <CommandProvider>
                        <Layout>{props.children}</Layout>
                      </CommandProvider>
                    </NotificationProvider>
                  </LayoutProvider>
                </PermissionProvider>
              )}
            >
              <Route
                path="/"
                component={() => (
                  <Suspense fallback={<Loading />}>
                    <Home />
                  </Suspense>
                )}
              />
              <Route path="/:dir" component={DirectoryLayout}>
                <Route path="/" component={() => <Navigate href="session" />} />
                <Route
                  path="/session/:id?"
                  component={() => (
                    <TerminalProvider>
                      <FileProvider>
                        <PromptProvider>
                          <Suspense fallback={<Loading />}>
                            <Session />
                          </Suspense>
                        </PromptProvider>
                      </FileProvider>
                    </TerminalProvider>
                  )}
                />
              </Route>
            </Router>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </ServerKey>
    </ServerProvider>
  )
}
