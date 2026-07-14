import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { useTheme } from "../../context/theme"

function View() {
  const { theme } = useTheme()
  return <text fg={theme.textMuted}>Sidebar footer unavailable</text>
}

export default Plugin.define({
  id: "opencode.sidebar-footer",
  setup(context) {
    context.ui.slot("sidebar.footer", () => <View />)
  },
})
