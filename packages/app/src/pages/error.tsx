import { AsciiLogo } from "@opencode-ai/ui/logo"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Component, createMemo, createSignal, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { Icon } from "@opencode-ai/ui/icon"
import {
  addToServerUrlHistory,
  clearStoredServerUrl,
  getStoredServerUrl,
  hasMixedContentRisk,
  isValidServerUrl,
  setStoredServerUrl,
} from "@/lib/server-url"

export type InitError = {
  name: string
  data: Record<string, unknown>
}

function isInitError(error: unknown): error is InitError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    "data" in error &&
    typeof (error as InitError).data === "object"
  )
}

function formatInitError(error: InitError): string {
  const data = error.data
  switch (error.name) {
    case "MCPFailed":
      return `MCP server "${data.name}" failed. Note, opencode does not support MCP authentication yet.`
    case "ProviderModelNotFoundError": {
      const { providerID, modelID, suggestions } = data as {
        providerID: string
        modelID: string
        suggestions?: string[]
      }
      return [
        `Model not found: ${providerID}/${modelID}`,
        ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
        `Check your config (opencode.json) provider/model names`,
      ].join("\n")
    }
    case "ProviderInitError":
      return `Failed to initialize provider "${data.providerID}". Check credentials and configuration.`
    case "ConfigJsonError":
      return `Config file at ${data.path} is not valid JSON(C)` + (data.message ? `: ${data.message}` : "")
    case "ConfigDirectoryTypoError":
      return `Directory "${data.dir}" in ${data.path} is not valid. Rename the directory to "${data.suggestion}" or remove it. This is a common typo.`
    case "ConfigFrontmatterError":
      return `Failed to parse frontmatter in ${data.path}:\n${data.message}`
    case "ConfigInvalidError": {
      const issues = Array.isArray(data.issues)
        ? data.issues.map(
            (issue: { message: string; path: string[] }) => "↳ " + issue.message + " " + issue.path.join("."),
          )
        : []
      return [`Config file at ${data.path} is invalid` + (data.message ? `: ${data.message}` : ""), ...issues].join(
        "\n",
      )
    }
    case "UnknownError":
      return String(data.message)
    default:
      return data.message ? String(data.message) : JSON.stringify(data, null, 2)
  }
}

function formatErrorChain(error: unknown, depth = 0, parentMessage?: string): string {
  if (!error) return "Unknown error"

  if (isInitError(error)) {
    const message = formatInitError(error)
    if (depth > 0 && parentMessage === message) return ""
    const indent = depth > 0 ? `\n${"─".repeat(40)}\nCaused by:\n` : ""
    return indent + message
  }

  if (error instanceof Error) {
    const isDuplicate = depth > 0 && parentMessage === error.message
    const parts: string[] = []
    const indent = depth > 0 ? `\n${"─".repeat(40)}\nCaused by:\n` : ""

    if (!isDuplicate) {
      // Stack already includes error name and message, so prefer it
      parts.push(indent + (error.stack ?? `${error.name}: ${error.message}`))
    } else if (error.stack) {
      // Duplicate message - only show the stack trace lines (skip message)
      const trace = error.stack.split("\n").slice(1).join("\n").trim()
      if (trace) {
        parts.push(trace)
      }
    }

    if (error.cause) {
      const causeResult = formatErrorChain(error.cause, depth + 1, error.message)
      if (causeResult) {
        parts.push(causeResult)
      }
    }

    return parts.join("\n\n")
  }

  if (typeof error === "string") {
    if (depth > 0 && parentMessage === error) return ""
    const indent = depth > 0 ? `\n${"─".repeat(40)}\nCaused by:\n` : ""
    return indent + error
  }

  const indent = depth > 0 ? `\n${"─".repeat(40)}\nCaused by:\n` : ""
  return indent + JSON.stringify(error, null, 2)
}

function formatError(error: unknown): string {
  return formatErrorChain(error, 0)
}

function isConnectionError(error: unknown): boolean {
  const message = formatError(error).toLowerCase()
  return (
    message.includes("could not connect") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed") ||
    message.includes("network error") ||
    message.includes("failed to fetch")
  )
}

interface ErrorPageProps {
  error: unknown
}

export const ErrorPage: Component<ErrorPageProps> = (props) => {
  const platform = usePlatform()

  const hasServerOverride = createMemo(() => !!getStoredServerUrl())
  const showResetButton = createMemo(() => isConnectionError(props.error) && hasServerOverride())
  const showServerConfig = createMemo(() => isConnectionError(props.error))
  const [serverUrl, setServerUrl] = createSignal(getStoredServerUrl() ?? "")
  const inputValid = createMemo(() => {
    const url = serverUrl().trim()
    return url.length > 0 && isValidServerUrl(url)
  })
  const showInvalidUrl = createMemo(() => {
    const url = serverUrl().trim()
    return url.length > 0 && !isValidServerUrl(url)
  })
  const showMixedContentWarning = createMemo(() => {
    const url = serverUrl().trim()
    if (!url) return false
    return hasMixedContentRisk(url)
  })

  function resetServerUrl() {
    clearStoredServerUrl()
    platform.restart?.() ?? window.location.reload()
  }

  function applyServerUrl() {
    const url = serverUrl().trim()
    if (!isValidServerUrl(url)) return
    setStoredServerUrl(url)
    addToServerUrlHistory(url)
    platform.restart?.() ?? window.location.reload()
  }

  return (
    <div class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center bg-background-base font-sans">
      <div class="w-2/3 max-w-3xl flex flex-col items-center justify-center gap-8">
        <AsciiLogo scale={1.1} class="opacity-25 shrink-0" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">Something went wrong</h1>
          <p class="text-sm text-text-weak">An error occurred while loading the application.</p>
        </div>
        <TextField
          value={formatError(props.error)}
          readOnly
          copyable
          multiline
          class="max-h-96 w-full font-mono text-xs no-scrollbar whitespace-pre"
          label="Error Details"
          hideLabel
        />
        <Show when={showServerConfig()}>
          <div class="flex flex-col gap-3 w-full">
            <div class="text-xs text-text-weak uppercase tracking-wide text-left">Server</div>
            <div class="flex w-full gap-2">
              <TextField
                value={serverUrl()}
                onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => setServerUrl(e.currentTarget.value)}
                placeholder="http://localhost:4096"
                class="flex-1 font-mono"
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" && inputValid()) {
                    applyServerUrl()
                  }
                }}
              />
              <Button size="large" onClick={applyServerUrl} disabled={!inputValid()}>
                Set & Restart
              </Button>
            </div>
            <Show when={showInvalidUrl()}>
              <p class="text-xs text-text-weak text-left">Enter a valid HTTP or HTTPS URL.</p>
            </Show>
            <Show when={showMixedContentWarning()}>
              <div class="flex items-start gap-2 p-2 rounded-md bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs">
                <Icon name="circle-ban-sign" size="small" class="shrink-0 mt-0.5" />
                <span>
                  This HTTP URL will be blocked by your browser (mixed content). Use{" "}
                  <code class="font-mono bg-surface-base px-1 rounded">localhost</code> or an HTTPS URL instead.
                </span>
              </div>
            </Show>
          </div>
        </Show>
        <div class="flex flex-col items-center gap-3">
          <Button size="large" onClick={platform.restart}>
            Restart
          </Button>
          <Show when={showResetButton()}>
            <Button size="large" variant="ghost" onClick={resetServerUrl}>
              Reset server URL
            </Button>
            <p class="text-xs text-text-weak">
              Using custom server URL. Reset to use default.
            </p>
          </Show>
        </div>
        <div class="flex flex-col items-center gap-2">
          <div class="flex items-center justify-center gap-1">
            Please report this error to the shuvcode team
            <button
              type="button"
              class="flex items-center text-text-interactive-base gap-1"
              onClick={() => platform.openLink("https://shuv.ai")}
            >
              <div>on Discord</div>
              <Icon name="discord" class="text-text-interactive-base" />
            </button>
          </div>
          <Show when={platform.version}>
            <p class="text-xs text-text-weak">Version: {platform.version}</p>
          </Show>
        </div>
      </div>
    </div>
  )
}
