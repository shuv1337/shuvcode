import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useRoute } from "../../context/route"
import { useLocal } from "../../context/local"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const ide = createMemo(() => Object.values(sync.data.ide).find((x) => x.status === "connected"))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })

  // Only render if there's something to show
  const hasContent = createMemo(() => permissions().length > 0 || ide() || local.selection.formatted())

  return (
    <Show when={hasContent()}>
      <box flexDirection="row" justifyContent="flex-end" gap={2} flexShrink={0}>
        <Show when={permissions().length > 0}>
          <text fg={theme.warning}>
            <span style={{ fg: theme.warning }}>◉</span> {permissions().length} Permission
            {permissions().length > 1 ? "s" : ""}
          </text>
        </Show>
        <Show when={ide()}>
          <text fg={theme.text}>
            <span style={{ fg: theme.success }}>◆ </span>
            {ide()!.name}
          </text>
        </Show>
        <Show when={local.selection.formatted()}>
          <text fg={theme.text}>
            <span style={{ fg: theme.accent }}>[] </span>
            {local.selection.formatted()}
          </text>
        </Show>
      </box>
    </Show>
  )
}
