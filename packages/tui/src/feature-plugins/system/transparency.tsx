import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:theme-transparency"
const key = "theme_transparent"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "theme.transparency.toggle",
        title: "Toggle transparent background",
        category: "Appearance",
        namespace: "palette",
        run() {
          api.kv.set(key, !api.kv.get(key, false))
          api.ui.dialog.clear()
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }

export default plugin