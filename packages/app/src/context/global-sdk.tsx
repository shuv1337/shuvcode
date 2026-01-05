import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import { usePlatform } from "./platform"
import { useServer } from "./server"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const platform = usePlatform()
    const server = useServer()
    const abort = new AbortController()

    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    let currentStreamAbort: AbortController | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let lastEventAt = Date.now()
    let connectionState: "connecting" | "open" | "retrying" | "closed" = "connecting"
    const heartbeatIntervalMs = 30_000
    const isStale = () => Date.now() - lastEventAt > heartbeatIntervalMs * 2

    async function connectEventStream() {
      // Clear any pending reconnection timeout to prevent race condition
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = null
      }

      connectionState = "connecting"
      lastEventAt = Date.now()

      // Abort any existing stream
      if (currentStreamAbort) {
        currentStreamAbort.abort()
      }

      currentStreamAbort = new AbortController()
      const streamAbort = currentStreamAbort

      const eventSdk = createOpencodeClient({
        baseUrl: server.url,
        signal: streamAbort.signal,
        fetch: platform.fetch,
      })

      try {
        const events = await eventSdk.global.event()
        connectionState = "open"
        for await (const event of events.stream) {
          if (streamAbort.signal.aborted) break
          lastEventAt = Date.now()
          emitter.emit(event.directory ?? "global", event.payload)
        }
      } catch (error: any) {
        if (error.name === "AbortError" || streamAbort.signal.aborted) return
        console.error("Event stream error:", error)
      }

      // Schedule reconnection if not aborted
      if (!abort.signal.aborted && !streamAbort.signal.aborted) {
        connectionState = "retrying"
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null
          if (!abort.signal.aborted) {
            connectEventStream()
          }
        }, 1000)
      } else {
        connectionState = "closed"
      }
    }

    connectEventStream()

    // Reconnect when tab regains visibility if the stream is stale
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible" || abort.signal.aborted) return
      if (isStale() || connectionState === "retrying" || connectionState === "closed") {
        connectEventStream()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    onCleanup(() => {
      // Clear pending reconnection timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      connectionState = "closed"
      // Abort main controller
      abort.abort()
      // Abort current stream
      if (currentStreamAbort) {
        currentStreamAbort.abort()
      }
      // Remove event listener
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    })

    const sdk = createOpencodeClient({
      baseUrl: server.url,
      fetch: platform.fetch,
      throwOnError: true,
    })

    return { url: server.url, client: sdk, event: emitter }
  },
})
