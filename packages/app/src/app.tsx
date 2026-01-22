import "@/index.css"
import { ErrorBoundary, Show, lazy, type ParentProps } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { I18nProvider } from "@opencode-ai/ui/context"
import { Diff } from "@opencode-ai/ui/diff"
import { Code } from "@opencode-ai/ui/code"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { NotificationProvider } from "@/context/notification"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { LanguageProvider, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { Logo } from "@opencode-ai/ui/logo"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
import { iife } from "@opencode-ai/util/iife"
import { Suspense } from "solid-js"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full" />

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __SHUVCODE__?: { updaterEnabled?: boolean; port?: number; serverReady?: boolean }
    __OPENCODE__?: {
      updaterEnabled?: boolean
      port?: number
      serverReady?: boolean
      serverUrl?: string
      serverPassword?: string
    }
  }
}

const defaultServerUrl = iife(() => {
  // NOTE: The ?url= query parameter was intentionally removed due to CVE-2026-22813 (GHSA-c83v-7274-4vgp)
  // Allowing arbitrary server URLs via query params enables XSS attacks on localhost:4096

  // 1. Configured server URL (from desktop settings)
  if (window.__OPENCODE__?.serverUrl) return window.__OPENCODE__.serverUrl

  // 2. Known production hosts -> localhost (same as upstream + shuv.ai)
  if (location.hostname.includes("opencode.ai") || location.hostname.includes("shuv.ai")) return "http://localhost:4096"

  // 3. Desktop app (Tauri) with injected port
  if (window.__SHUVCODE__?.port) return `http://127.0.0.1:${window.__SHUVCODE__.port}`
  if (window.__OPENCODE__?.port) return `http://127.0.0.1:${window.__OPENCODE__.port}`

  // 4. Dev mode -> same-origin so Vite proxy handles LAN access + CORS
  if (import.meta.env.DEV) {
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  }

  // 5. Default -> same origin (production web command)
  return window.location.origin
})

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return <MarkedProvider nativeParser={platform.parseMarkdown}>{props.children}</MarkedProvider>
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProviderWithNativeParser>
                  <DiffComponentProvider component={Diff}>
                    <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
                  </DiffComponentProvider>
                </MarkedProviderWithNativeParser>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
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

export function AppInterface(props: { defaultUrl?: string }) {
  const getDefaultServerUrl = () => {
    // Use props if provided, otherwise use module-level defaultServerUrl
    if (props.defaultUrl) return props.defaultUrl
    return defaultServerUrl
  }

  return (
    <ServerProvider defaultUrl={getDefaultServerUrl()}>
      <ServerKey>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
            <Router
              root={(props) => (
                <SettingsProvider>
                  <PermissionProvider>
                    <LayoutProvider>
                      <NotificationProvider>
                        <CommandProvider>
                          <Layout>{props.children}</Layout>
                        </CommandProvider>
                      </NotificationProvider>
                    </LayoutProvider>
                  </PermissionProvider>
                </SettingsProvider>
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
                  component={(p) => (
                    <Show when={p.params.id ?? "new"} keyed>
                      <TerminalProvider>
                        <FileProvider>
                          <PromptProvider>
                            <Suspense fallback={<Loading />}>
                              <Session />
                            </Suspense>
                          </PromptProvider>
                        </FileProvider>
                      </TerminalProvider>
                    </Show>
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
