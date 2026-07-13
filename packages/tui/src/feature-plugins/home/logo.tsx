import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import type { BuiltinTuiPlugin } from "../builtins"
import { useTheme } from "../../context/theme"
import { tint } from "../../theme/color"
import { logo, marks } from "../../shuv-logo"

const id = "internal:shuvcode-logo"

function ShuvcodeLogo() {
  const { theme } = useTheme()

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (marks.includes(char)) {
        const text = char === "_" ? " " : "▀"
        const color = char === "~" ? shadow : fg
        return (
          <text fg={color} bg={char === "_" ? shadow : undefined} attributes={attrs} selectable={false}>
            {text}
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  return (
    <box>
      <For each={logo.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(line, theme.textMuted, false)}</box>
            <box flexDirection="row">{renderLine(logo.right[index()], theme.text, true)}</box>
          </box>
        )}
      </For>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 0,
    slots: {
      home_logo() {
        return <ShuvcodeLogo />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }

export default plugin
