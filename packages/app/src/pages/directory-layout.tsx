import { DataProvider } from "@opencode-ai/session-ui/context"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createResource, onCleanup, type ParentProps, Show } from "solid-js"
import { LocalProvider } from "@/context/local"
import { useSync } from "@/context/sync"
import type { ServerConnection } from "@/context/servers"
import { sessionHref } from "@/utils/session-route"
import { useServerSync } from "@/context/server-sync"

export function DirectoryDataProvider(
  props: ParentProps<{
    directory: string
    server: ServerConnection.Key
  }>,
) {
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const serverSync = useServerSync()
  const directory = () => props.directory
  const href = (sessionID: string) => sessionHref(props.server, sessionID)
  const navigateToSession = async (sessionID: string) => {
    const session = serverSync.session
    await Promise.allSettled([session.lineage.resolve(sessionID), session.sync(sessionID)])
    navigate(href(sessionID))
  }

  createResource(
    () => params.id,
    (id) => serverSync.session.hydrate(id).catch(() => {}),
  )

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    serverSync.session.pin(sessionID)
    onCleanup(() => serverSync.session.unpin(sessionID))
  })

  return (
    <Show when={directory()} keyed>
      {(directory) => (
        <DataProvider
          data={sync().data}
          directory={directory}
          sessionID={params.id}
          onNavigateToSession={navigateToSession}
          onSessionHref={href}
        >
          <LocalProvider>{props.children}</LocalProvider>
        </DataProvider>
      )}
    </Show>
  )
}
