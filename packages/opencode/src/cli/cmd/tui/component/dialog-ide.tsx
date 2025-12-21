import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"

function Status(props: { connected: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.connected) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Connected</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disconnected</span>
}

export function DialogIde() {
  const local = useLocal()
  const sync = useSync()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    const ideData = sync.data.ide
    const loadingIde = loading()
    const projectDir = process.cwd()

    return pipe(
      ideData ?? {},
      entries(),
      sortBy(
        ([key]) => {
          const folders = local.ide.getWorkspaceFolders(key)
          // Exact match - highest priority
          if (folders.some((folder: string) => folder === projectDir)) return 0
          // IDE workspace contains current directory (we're in a subdirectory of IDE workspace)
          if (folders.some((folder: string) => projectDir.startsWith(folder + "/"))) return 1
          return 2
        },
        ([, status]) => status.name,
      ),
      map(([key, status]) => {
        return {
          value: key,
          title: status.name,
          description: local.ide.getWorkspaceFolders(key)[0],
          footer: <Status connected={local.ide.isConnected(key)} loading={loadingIde === key} />,
          category: undefined,
        }
      }),
    )
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return

        setLoading(option.value)
        try {
          await local.ide.toggle(option.value)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return <DialogSelect ref={setRef} title="IDEs" options={options()} keybind={keybinds()} onSelect={() => {}} />
}
