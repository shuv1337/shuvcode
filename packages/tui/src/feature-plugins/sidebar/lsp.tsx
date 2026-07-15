import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { useTheme } from "../../context/theme"

function View() {
  const { theme } = useTheme()
  return (
    <box>
      <text fg={theme.text}>
        <b>LSP</b>
      </text>
      <text fg={theme.textMuted}>LSP status unavailable</text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar-lsp",
  setup(context) {
    context.ui.slot("sidebar.content", () => <View />)
  },
})
