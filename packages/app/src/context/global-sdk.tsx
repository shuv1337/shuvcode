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

    const eventSdk = createOpencodeClient({
      baseUrl: server.url,
      signal: abort.signal,
      fetch: platform.fetch,
    })
    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    void (async () => {
      const events = await eventSdk.global.event()
      for await (const event of events.stream) {
        emitter.emit(event.directory ?? "global", event.payload)
      }
    })().catch((error) => {
      if (error.name === "AbortError") return
      console.error("Event stream error:", error)
    })

    onCleanup(() => abort.abort())

    const sdk = createOpencodeClient({
      baseUrl: server.url,
      fetch: platform.fetch,
      throwOnError: true,
    })

    return { url: server.url, client: sdk, event: emitter }
  },
})
