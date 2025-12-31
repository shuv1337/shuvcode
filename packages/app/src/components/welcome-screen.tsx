import { createEffect, createMemo, createSignal, onCleanup, Show, For } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { AsciiLogo } from "@opencode-ai/ui/logo"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { normalizeServerUrl, serverDisplayName, useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { isHostedEnvironment, hasUrlQueryParam, getUrlQueryParam } from "@/utils/hosted"

type ServerStatus = { healthy: boolean; version?: string }

async function checkHealth(url: string, fetch?: typeof globalThis.fetch): Promise<ServerStatus> {
  const sdk = createOpencodeClient({
    baseUrl: url,
    fetch,
    signal: AbortSignal.timeout(3000),
  })
  return sdk.global
    .health()
    .then((x) => ({ healthy: x.data?.healthy === true, version: x.data?.version }))
    .catch(() => ({ healthy: false }))
}

export interface WelcomeScreenProps {
  attemptedUrl?: string
  onRetry?: () => void
}

export function WelcomeScreen(props: WelcomeScreenProps) {
  const server = useServer()
  const platform = usePlatform()
  const [store, setStore] = createStore({
    url: "",
    connecting: false,
    error: "",
    status: {} as Record<string, ServerStatus | undefined>,
  })

  const urlOverride = getUrlQueryParam()
  const isLocalhost = () => {
    const url = props.attemptedUrl || ""
    return url.includes("localhost") || url.includes("127.0.0.1")
  }

  const items = createMemo(() => {
    const list = server.list
    return list.filter((x) => x !== props.attemptedUrl)
  })

  async function refreshHealth() {
    const results: Record<string, ServerStatus> = {}
    await Promise.all(
      items().map(async (url) => {
        results[url] = await checkHealth(url, platform.fetch)
      }),
    )
    setStore("status", reconcile(results))
  }

  createEffect(() => {
    if (items().length === 0) return
    refreshHealth()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  async function handleConnect(url: string, persist = false) {
    const normalized = normalizeServerUrl(url)
    if (!normalized) return

    setStore("connecting", true)
    setStore("error", "")

    const result = await checkHealth(normalized, platform.fetch)
    setStore("connecting", false)

    if (!result.healthy) {
      setStore("error", "Could not connect to server")
      return
    }

    if (persist) {
      server.add(normalized)
    } else {
      server.setActive(normalized)
    }
    props.onRetry?.()
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const value = normalizeServerUrl(store.url)
    if (!value) return
    await handleConnect(value, true)
  }

  return (
    <div class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center bg-background-base font-sans p-4">
      <div class="w-full max-w-lg flex flex-col items-center justify-center gap-6">
        <AsciiLogo scale={1.0} class="opacity-40 shrink-0" />

        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">Welcome to Shuvcode</h1>
          <p class="text-sm text-text-weak">
            {urlOverride
              ? `Could not connect to the server at ${urlOverride}`
              : "Connect to a Shuvcode server to get started"}
          </p>
        </div>

        {/* Local Server Section */}
        <div class="w-full bg-background-subtle rounded-lg p-4 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <Icon name="console" class="text-icon-base" />
            <h2 class="text-sm font-medium text-text-strong">Local Server</h2>
          </div>

          <Show when={isLocalhost()}>
            <div class="text-xs text-text-weak bg-background-base rounded p-3 font-mono">
              <p class="mb-2">Start a local server by running:</p>
              <code class="text-text-interactive-base">shuvcode</code>
              <p class="mt-2 text-text-weak">or</p>
              <code class="text-text-interactive-base">npx shuvcode</code>
            </div>
          </Show>

          <Button
            variant="secondary"
            size="normal"
            onClick={() => handleConnect(props.attemptedUrl || "http://localhost:4096")}
            disabled={store.connecting}
          >
            {store.connecting ? "Connecting..." : "Retry Connection"}
          </Button>
        </div>

        {/* Remote Server Section */}
        <div class="w-full bg-background-subtle rounded-lg p-4 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <Icon name="square-arrow-top-right" class="text-icon-base" />
            <h2 class="text-sm font-medium text-text-strong">Remote Server</h2>
          </div>

          <form onSubmit={handleSubmit} class="flex flex-col gap-2">
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0">
                <TextField
                  type="text"
                  label="Server URL"
                  hideLabel
                  placeholder="https://your-server.example.com"
                  value={store.url}
                  onChange={(v) => {
                    setStore("url", v)
                    setStore("error", "")
                  }}
                  validationState={store.error ? "invalid" : "valid"}
                  error={store.error}
                />
              </div>
              <Button type="submit" variant="primary" size="large" disabled={store.connecting || !store.url.trim()}>
                Connect
              </Button>
            </div>
          </form>

          <p class="text-xs text-text-weak">
            Note: Connecting to a remote server means trusting that server with your data.
          </p>
        </div>

        {/* Saved Servers Section */}
        <Show when={items().length > 0}>
          <div class="w-full bg-background-subtle rounded-lg p-4 flex flex-col gap-3">
            <h2 class="text-sm font-medium text-text-strong">Saved Servers</h2>
            <div class="flex flex-col gap-2">
              <For each={items()}>
                {(url) => (
                  <button
                    type="button"
                    class="flex items-center gap-3 p-2 rounded hover:bg-background-base transition-colors text-left"
                    onClick={() => handleConnect(url)}
                    disabled={store.status[url]?.healthy === false}
                  >
                    <div
                      classList={{
                        "size-2 rounded-full shrink-0": true,
                        "bg-icon-success-base": store.status[url]?.healthy === true,
                        "bg-icon-critical-base": store.status[url]?.healthy === false,
                        "bg-border-weak-base": store.status[url] === undefined,
                      }}
                    />
                    <span
                      class="truncate text-sm"
                      classList={{ "text-text-weak": store.status[url]?.healthy === false }}
                    >
                      {serverDisplayName(url)}
                    </span>
                    <Show when={store.status[url]?.version}>
                      <span class="text-xs text-text-weak ml-auto">{store.status[url]?.version}</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Troubleshooting Section */}
        <Show when={isHostedEnvironment()}>
          <details class="w-full text-xs text-text-weak">
            <summary class="cursor-pointer hover:text-text-base">Troubleshooting</summary>
            <div class="mt-2 p-3 bg-background-subtle rounded-lg flex flex-col gap-2">
              <p>
                <strong>Server not running:</strong> Make sure you have a Shuvcode server running locally or accessible
                remotely.
              </p>
              <p>
                <strong>CORS blocked:</strong> The server must allow requests from{" "}
                <code class="text-text-interactive-base">{location.origin}</code>. Local servers automatically allow
                this domain.
              </p>
              <p>
                <strong>Mixed content:</strong> If connecting to an <code>http://</code> server from this{" "}
                <code>https://</code> page, your browser may block the connection. Use <code>https://</code> for remote
                servers.
              </p>
            </div>
          </details>
        </Show>

        <Show when={platform.version}>
          <p class="text-xs text-text-weak">Version: {platform.version}</p>
        </Show>
      </div>
    </div>
  )
}
