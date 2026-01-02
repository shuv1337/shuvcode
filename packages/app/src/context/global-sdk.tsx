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

    async function connectEventStream() {
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
        for await (const event of events.stream) {
          if (streamAbort.signal.aborted) break
          emitter.emit(event.directory ?? "global", event.payload)
        }
      } catch (error: any) {
        if (error.name === "AbortError" || streamAbort.signal.aborted) return
        console.error("Event stream error:", error)
      }

      if (!abort.signal.aborted && !streamAbort.signal.aborted) {
        setTimeout(() => {
          if (!abort.signal.aborted) {
            connectEventStream()
          }
        }, 1000)
      }
    }

    connectEventStream()

    // Reconnect when tab regains visibility - browsers kill background SSE connections
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !abort.signal.aborted) {
        connectEventStream()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    onCleanup(() => {
      abort.abort()
      if (currentStreamAbort) {
        currentStreamAbort.abort()
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    })

    const sdk = createOpencodeClient({
      baseUrl: server.url,
      signal: AbortSignal.timeout(1000 * 60 * 10),
      fetch: platform.fetch,
      throwOnError: true,
    })

    return { url: server.url, client: sdk, event: emitter }
  },
})
