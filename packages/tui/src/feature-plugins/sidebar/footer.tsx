import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { createMemo, Show } from "solid-js"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { abbreviateHome } from "../../runtime"
import { FilePath } from "../../ui/file-path"

function View(props: { context: Plugin.Context }) {
  const { theme } = useTheme()
  const paths = useTuiPaths()
  const directory = createMemo(() =>
    props.context.location ? abbreviateHome(props.context.location.directory, paths.home) : undefined,
  )
  return <Show when={directory()}>{(value) => <FilePath value={value()} maxWidth={38} fg={theme.textMuted} />}</Show>
}

export default Plugin.define({
  id: "opencode.sidebar-footer",
  setup(context) {
    context.ui.slot("sidebar.footer", () => <View context={context} />)
  },
})
