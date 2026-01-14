import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../context/theme"

export function AccountBadge() {
  const sync = useSync()
  const { theme } = useTheme()

  const authInfo = createMemo(() => sync.data.provider_auth_info.openai)

  return () => {
    const info = authInfo()
    if (!info?.authenticated || !info.email) return null

    return (
      <box flexDirection="row" gap={1} alignItems="center">
        <text>{info.email}</text>
        {info.plan && <text fg={theme.primary}>[{info.plan.charAt(0).toUpperCase() + info.plan.slice(1)}]</text>}
      </box>
    )
  }
}
