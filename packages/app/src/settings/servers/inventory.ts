import { createMemo } from "solid-js"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useWslServers } from "@/servers/wsl/context"
import type { WslServerItem } from "@/servers/wsl/types"

export type SettingsServer = {
  key: ServerConnection.Key
  name: string
  connection?: ServerConnection.Any
  wsl?: WslServerItem
}

export function settingsServers(connections: readonly ServerConnection.Any[], wsl: readonly WslServerItem[]) {
  const configured = new Map(wsl.map((item) => [item.config.id, item]))
  const connected = new Set(connections.map(ServerConnection.key))
  return [
    ...connections.map((connection): SettingsServer => {
      const key = ServerConnection.key(connection)
      const item = configured.get(key)
      return {
        key,
        name: item?.config.distro ?? (serverName(connection) || key),
        connection: item && item.runtime.kind !== "ready" ? undefined : connection,
        wsl: item,
      }
    }),
    ...wsl
      .filter((item) => !connected.has(ServerConnection.Key.make(item.config.id)))
      .map(
        (item): SettingsServer => ({
          key: ServerConnection.Key.make(item.config.id),
          name: item.config.distro,
          wsl: item,
        }),
      ),
  ]
}

export function useSettingsServers() {
  const servers = useServers()
  const wsl = useWslServers()
  return createMemo(() => settingsServers(servers.list, wsl.data?.servers ?? []))
}
