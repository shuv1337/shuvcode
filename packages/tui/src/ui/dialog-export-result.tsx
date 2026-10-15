import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DIALOG_INSET, DialogHeader, useDialog, type DialogContext } from "./dialog"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")

  const close = () => {
    props.onClose?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Close export result",
        group: "Dialog",
        run: close,
      },
    ],
  }))

  return (
    <box paddingLeft={DIALOG_INSET} paddingRight={DIALOG_INSET} gap={1}>
      <DialogHeader title="Session exported" onClose={close} />
      <box>
        <text fg={theme.text.base}>{props.path}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.background.action.primary.focused}
          onMouseUp={close}
        >
          <text fg={theme.text.action.primary.focused}>Close</text>
        </box>
      </box>
    </box>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })
