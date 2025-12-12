import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Installation } from "@/installation"

// "shuv"
const LOGO_LEFT = [`     ▄             `, `█▀▀▀ █▀▀█ █  █ █  █`, `▀▀▀█ █░░█ █░░█ █░░█`, `▀▀▀▀ ▀  ▀ ▀▀▀▀  ▀▀ `]

// "code"
const LOGO_RIGHT = [`             ▄     `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]
export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted} selectable={false}>
              {line}
            </text>
            <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
              {LOGO_RIGHT[index()]}
            </text>
          </box>
        )}
      </For>
      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted}>{Installation.displayVersion()}</text>
      </box>
    </box>
  )
}
