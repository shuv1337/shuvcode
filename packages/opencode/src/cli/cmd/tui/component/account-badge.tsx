import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme, type Theme } from "../context/theme"

const PLAN_LABELS = new Map([
  ["free", "Free"],
  ["plus", "Plus"],
  ["pro", "Pro"],
  ["team", "Team"],
  ["enterprise", "Enterprise"],
])

function resolvePlanColor(theme: Theme, plan?: string | null) {
  switch (plan?.toLowerCase()) {
    case "free":
      return theme.textMuted
    case "plus":
      return theme.info
    case "pro":
      return theme.success
    case "team":
      return theme.warning
    case "enterprise":
      return theme.accent
    default:
      return theme.primary
  }
}

export function AccountBadge() {
  const sync = useSync()
  const { theme } = useTheme()

  const authInfo = createMemo(() => sync.data.provider_auth_info.openai)

  return () => {
    const info = authInfo()
    if (!info?.authenticated || !info.email) return null

    const planLabel = info.plan ? (PLAN_LABELS.get(info.plan.toLowerCase()) ?? info.plan) : null
    const planColor = resolvePlanColor(theme, info.plan)

    return (
      <box flexDirection="row" gap={1} alignItems="center">
        <text>{info.email}</text>
        {planLabel && <text fg={planColor}>[{planLabel}]</text>}
      </box>
    )
  }
}
