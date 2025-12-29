import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { usePlatform } from "@/context/platform"
import {
  getStoredServerUrl,
  setStoredServerUrl,
  clearStoredServerUrl,
  getServerUrlHistory,
  addToServerUrlHistory,
  isValidServerUrl,
  hasMixedContentRisk,
} from "@/lib/server-url"

export const DialogServerSettings: Component = () => {
  const platform = usePlatform()

  // Get current stored URL (if any)
  const storedUrl = getStoredServerUrl()
  const history = getServerUrlHistory()

  // Track the input value
  const [inputUrl, setInputUrl] = createSignal("")
  const [isSubmitting, setIsSubmitting] = createSignal(false)

  // Current effective URL display
  const currentUrl = createMemo(() => {
    if (storedUrl) return storedUrl
    // Show what the default URL would be
    return window.location.origin === "file://" ? "http://localhost:4096" : window.location.origin
  })

  const hasOverride = createMemo(() => !!storedUrl)

  // Validation
  const inputValid = createMemo(() => {
    const url = inputUrl().trim()
    if (!url) return false
    return isValidServerUrl(url)
  })

  const showMixedContentWarning = createMemo(() => {
    const url = inputUrl().trim()
    if (!url) return false
    return hasMixedContentRisk(url)
  })

  // Set a new server URL
  async function handleSetUrl() {
    const url = inputUrl().trim()
    if (!isValidServerUrl(url)) {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: "Invalid URL",
        description: "Please enter a valid HTTP or HTTPS URL.",
      })
      return
    }

    setIsSubmitting(true)
    setStoredServerUrl(url)
    addToServerUrlHistory(url)

    showToast({
      variant: "success",
      icon: "circle-check",
      title: "Server URL updated",
      description: "Reloading to apply changes...",
    })

    // Short delay to show the toast, then reload
    setTimeout(() => {
      platform.restart?.() ?? window.location.reload()
    }, 500)
  }

  // Select a URL from history
  function handleSelectHistory(url: string) {
    setInputUrl(url)
  }

  // Clear the override and reload
  function handleClearOverride() {
    clearStoredServerUrl()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: "Server URL reset",
      description: "Reloading to apply changes...",
    })

    setTimeout(() => {
      platform.restart?.() ?? window.location.reload()
    }, 500)
  }

  return (
    <Dialog title="Server settings">
      <div class="flex flex-col gap-6 px-4 pb-4">
        {/* Current URL display */}
        <div class="flex flex-col gap-2">
          <div class="text-12-medium text-text-weak uppercase tracking-wide">Current server URL</div>
          <div class="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-raised-base">
            <span class="flex-1 truncate text-14-regular text-text-strong font-mono">{currentUrl()}</span>
            <Show when={hasOverride()}>
              <Icon name="check" size="small" class="text-icon-success-base shrink-0" />
            </Show>
            <Show when={!hasOverride()}>
              <span class="text-12-regular text-text-weak shrink-0">(default)</span>
            </Show>
          </div>
        </div>

        {/* Set custom URL */}
        <div class="flex flex-col gap-2">
          <div class="text-12-medium text-text-weak uppercase tracking-wide">Set custom URL</div>
          <div class="flex gap-2">
            <TextField
              value={inputUrl()}
              onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => setInputUrl(e.currentTarget.value)}
              placeholder="http://localhost:4096"
              class="flex-1 font-mono"
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter" && inputValid()) {
                  handleSetUrl()
                }
              }}
            />
            <Button onClick={handleSetUrl} disabled={!inputValid() || isSubmitting()}>
              Set
            </Button>
          </div>

          {/* Mixed content warning */}
          <Show when={showMixedContentWarning()}>
            <div class="flex items-start gap-2 p-2 rounded-md bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-12-regular">
              <Icon name="circle-ban-sign" size="small" class="shrink-0 mt-0.5" />
              <span>
                This HTTP URL will be blocked by your browser (mixed content). Use{" "}
                <code class="font-mono bg-surface-base px-1 rounded">localhost</code> or an HTTPS URL instead.
              </span>
            </div>
          </Show>
        </div>

        {/* History */}
        <Show when={history.length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-12-medium text-text-weak uppercase tracking-wide">Recent URLs</div>
            <div class="flex flex-col gap-1 rounded-md bg-surface-raised-base overflow-hidden">
              <For each={history}>
                {(url) => {
                  const isSafe = !hasMixedContentRisk(url)
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised-base-hover transition-colors"
                      onClick={() => handleSelectHistory(url)}
                    >
                      <span class="flex-1 truncate text-14-regular text-text-strong font-mono">{url}</span>
                      <Show when={isSafe}>
                        <Icon name="check" size="small" class="text-icon-success-base shrink-0" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* Clear override button */}
        <Show when={hasOverride()}>
          <div class="pt-2 border-t border-border-weak-base">
            <Button variant="ghost" onClick={handleClearOverride} class="w-full justify-center">
              Clear override and use default
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
