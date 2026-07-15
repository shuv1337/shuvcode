import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"

function Commands(props: { context: Plugin.Context }) {
  const dialog = useDialog()
  Keymap.createLayer(() => ({
    mode: "global",
    commands: [
      {
        id: "app.scrap",
        title: "Open scrap screen",
        group: "Debug",
        palette: true,
        run() {
          props.context.ui.router.navigate({ type: "plugin", name: "scrap" })
          dialog.clear()
        },
      },
    ],
  }))
  return null
}

function Scrap(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()

  Keymap.createLayer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back home",
        group: "Scrap",
        run() {
          props.context.ui.router.navigate({ type: "home" })
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background}>
      <box flexGrow={1} />
      <box
        height={1}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
      >
        <text fg={theme.textMuted}>~/code/anomalyco/opencode</text>
        <box flexGrow={1} />
        <text fg={theme.textMuted}>esc home</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.scrap",
  setup(context) {
    context.ui.router.register({ name: "scrap", render: () => <Scrap context={context} /> })
    context.ui.slot("app", () => <Commands context={context} />)
  },
})
