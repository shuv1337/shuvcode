import "@/index.css"
import { ErrorBoundary, Show, Suspense, lazy, type JSX, type ParentProps } from "solid-js"
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
import { normalizeServerUrl, ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { CommentsProvider } from "@/context/comments"
import { NotificationProvider } from "@/context/notification"
import { ModelsProvider } from "@/context/models"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { LanguageProvider, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { HighlightsProvider } from "@/context/highlights"
import { iife } from "@opencode-ai/util/iife"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full" />

const HomeRoute = () => (
  <Suspense fallback={<Loading />}>
    <Home />
  </Suspense>
)

const SessionRoute = () => (
  <SessionProviders>
    <Suspense fallback={<Loading />}>
      <Session />
    </Suspense>
  </SessionProviders>
)

const SessionIndexRoute = () => <Navigate href="session" />

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
      serverUrl?: string
      serverPassword?: string
      deepLinks?: string[]
      wsl?: boolean
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

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>{props.children}</Layout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {props.appChildren}
      {props.children}
    </AppShellProviders>
  )
}

const getStoredDefaultServerUrl = (platform: ReturnType<typeof usePlatform>) => {
  if (platform.platform !== "web") return
  const result = platform.getDefaultServerUrl?.()
  if (result instanceof Promise) return
  if (!result) return
  return normalizeServerUrl(result)
}

const resolveDefaultServerUrl = (props: {
  defaultUrl?: string
  storedDefaultServerUrl?: string
  hostname: string
  origin: string
  isDev: boolean
  devHost?: string
  devPort?: string
}) => {
  if (props.defaultUrl) return props.defaultUrl
  if (props.storedDefaultServerUrl) return props.storedDefaultServerUrl
  if (props.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (props.isDev) return `http://${props.devHost ?? "localhost"}:${props.devPort ?? "4096"}`
  return props.origin
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider defaultTheme="nightowl">
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

export function AppInterface(props: { defaultUrl?: string; children?: JSX.Element; isSidecar?: boolean }) {
  const platform = usePlatform()
  const storedDefaultServerUrl = getStoredDefaultServerUrl(platform)
  const defaultServerUrl = resolveDefaultServerUrl({
    defaultUrl: props.defaultUrl,
    storedDefaultServerUrl,
    hostname: location.hostname,
    origin: window.location.origin,
    isDev: import.meta.env.DEV,
    devHost: import.meta.env.VITE_OPENCODE_SERVER_HOST,
    devPort: import.meta.env.VITE_OPENCODE_SERVER_PORT,
  })

  return (
    <ServerProvider defaultUrl={defaultServerUrl} isSidecar={props.isSidecar}>
      <ServerKey>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
            <Router
              root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
            >
              <Route path="/" component={HomeRoute} />
              <Route path="/:dir" component={DirectoryLayout}>
                <Route path="/" component={SessionIndexRoute} />
                <Route path="/session/:id?" component={SessionRoute} />
              </Route>
            </Router>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </ServerKey>
    </ServerProvider>
  )
}
