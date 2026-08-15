import type { LocationGetOutput, LocationRef } from "@opencode-ai/client"
import { createContext, createMemo, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import { useClient } from "./client"
import { useData } from "./data"

const context = createContext<{
  readonly current: LocationGetOutput | undefined
  // The target location as set, available before the server-synced info in `current` arrives.
  readonly ref: LocationRef | undefined
  readonly error: { readonly location: LocationRef; readonly cause: unknown } | undefined
  set: (location?: LocationRef) => void
}>()

export function LocationProvider(props: ParentProps) {
  const client = useClient()
  const data = useData()
  const [ref, setRef] = createSignal<LocationRef>()
  const [error, setError] = createSignal<{ readonly location: LocationRef; readonly cause: unknown }>()
  let generation = 0
  const current = createMemo(() => data.location.info(ref()))

  function sync(location?: LocationRef) {
    if (!location) return
    const attempt = ++generation
    const defaultLocation = data.location.default()
    const target =
      location.directory === defaultLocation.directory && location.workspaceID === defaultLocation.workspaceID
        ? undefined
        : location
    setError(undefined)
    void data.location.sync(target).catch((cause) => {
      const current = ref()
      if (
        generation !== attempt ||
        current?.directory !== location.directory ||
        current.workspaceID !== location.workspaceID
      )
        return
      setError({ location, cause })
    })
  }

  function set(location?: LocationRef) {
    setRef(location)
    // Catalog reads are plain HTTP and do not depend on the event stream, so fetch
    // immediately. Waiting for the handshake left the model and provider lists empty
    // for as long as it took to connect, which reads as "no models exist".
    sync(location)
  }

  // Resync after a reconnect, which may have missed updates. DataProvider drops the
  // cached completion whenever the stream is down, so this is a no-op when the fetch
  // above already succeeded and nothing was missed.
  onCleanup(client.event.on("server.connected", () => sync(ref())))

  return (
    <context.Provider
      value={{
        get current() {
          return current()
        },
        get ref() {
          return ref()
        },
        get error() {
          return error()
        },
        set,
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export function useLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value
}
