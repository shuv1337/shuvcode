import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { createMemo, Show } from "solid-js"
import { Tips } from "./tips-view"
import { Keymap } from "../../context/keymap"
import { useData } from "../../context/data"
import { hasConnectedProvider } from "../../util/connected-provider"
import { useConfig } from "../../config"
import { useDialog } from "../../ui/dialog"

function View() {
  const config = useConfig()
  const data = useData()
  const dialog = useDialog()
  const hidden = createMemo(() => !(config.data.hints?.tips ?? true))
  const first = createMemo(() => data.session.list().length === 0)
  const connected = createMemo(() => hasConnectedProvider(data.location.integration.list() ?? []))
  const show = createMemo(() => (!first() || !connected()) && !hidden())

  Keymap.createLayer(() => ({
    commands: [
      {
        id: "tips.toggle",
        title: hidden() ? "Show tips" : "Hide tips",
        group: "System",
        run() {
          void config
            .update((draft) => {
              draft.hints = { ...draft.hints, tips: hidden() }
            })
            .catch(() => {})
          dialog.clear()
        },
      },
    ],
  }))

  return (
    <box width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
      <Show when={show()}>
        <Tips connected={connected()} />
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "internal:home-tips",
  setup(context) {
    context.ui.slot("home.bottom", () => <View />)
  },
})
