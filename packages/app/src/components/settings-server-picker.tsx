import { QueryClientProvider } from "@tanstack/solid-query"
import { type ParentProps, Show } from "solid-js"
import { useGlobal } from "@/context/global"
import { ModelsProvider } from "@/context/models"
import { ServerConnection } from "@/context/server"
import { ServerSDKProvider } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"

export function SettingsServerScope(props: ParentProps) {
  const global = useGlobal()
  return (
    <Show when={global.settings.server.selected()} keyed fallback={props.children}>
      {(server) => <SettingsServerDataScope server={server}>{props.children}</SettingsServerDataScope>}
    </Show>
  )
}

export function SettingsServerDataScope(props: ParentProps<{ server: ServerConnection.Any }>) {
  const global = useGlobal()
  const serverCtx = () => global.ensureServerCtx(props.server)
  return (
    <QueryClientProvider client={serverCtx().queryClient}>
      <ServerSDKProvider server={props.server}>
        <ServerSyncProvider server={props.server}>
          <ModelsProvider>{props.children}</ModelsProvider>
        </ServerSyncProvider>
      </ServerSDKProvider>
    </QueryClientProvider>
  )
}
