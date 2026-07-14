import type { LocationRef } from "@opencode-ai/client"
import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentProps } from "solid-js"
import { useClient } from "./client"
import { useData } from "./data"

const context = createContext<{
  current: Accessor<LocationRef | undefined>
  set: (location?: LocationRef) => void
}>()

export function LocationProvider(props: ParentProps) {
  const client = useClient()
  const data = useData()
  const [current, setCurrent] = createSignal<LocationRef>()

  function sync(location?: LocationRef) {
    if (!location) return
    const defaultLocation = data.location.default()
    const target =
      location.directory === defaultLocation.directory && location.workspaceID === defaultLocation.workspaceID
        ? undefined
        : location
    void data.location.sync(target).catch(() => undefined)
  }

  function set(location?: LocationRef) {
    setCurrent(location)
    if (client.connection.status() === "connected") sync(location)
  }

  onCleanup(client.event.on("server.connected", () => sync(current())))

  return <context.Provider value={{ current, set }}>{props.children}</context.Provider>
}

export function useLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value.current
}

export function useSetLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value.set
}
