import { Component, createMemo, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

interface DialogSessionRenameProps {
  sessionID: string
}

export const DialogSessionRename: Component<DialogSessionRenameProps> = (props) => {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const [store, setStore] = createStore({
    value: "",
    error: undefined as string | undefined,
  })

  // Prefill the input when session data becomes available
  createEffect(() => {
    const s = session()
    if (s?.title && !store.value) {
      setStore("value", s.title)
    }
  })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const trimmed = store.value.trim()

    if (!trimmed) {
      setStore("error", "Session name is required")
      return
    }

    await sdk.client.session.update({
      sessionID: props.sessionID,
      title: trimmed,
    })
    dialog.close()
  }

  return (
    <Dialog title="Rename session">
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 px-5 pb-6">
        <TextField
          autofocus
          label="Session name"
          value={store.value}
          onChange={(value) => setStore({ value, error: undefined })}
          validationState={store.error ? "invalid" : undefined}
          error={store.error}
        />
        <div class="flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button type="submit">Rename</Button>
        </div>
      </form>
    </Dialog>
  )
}
