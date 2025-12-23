import { Component, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { useGlobalSDK } from "@/context/global-sdk"
import type { Session } from "@opencode-ai/sdk/v2/client"

interface DialogSessionRenameGlobalProps {
  session: Session
}

export const DialogSessionRenameGlobal: Component<DialogSessionRenameGlobalProps> = (props) => {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

  const [store, setStore] = createStore({
    value: props.session.title ?? "",
    error: undefined as string | undefined,
  })

  // Prefill with session title on mount
  createEffect(() => {
    if (props.session.title && !store.value) {
      setStore("value", props.session.title)
    }
  })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const trimmed = store.value.trim()

    if (!trimmed) {
      setStore("error", "Session name is required")
      return
    }

    await globalSDK.client.session.update({
      directory: props.session.directory,
      sessionID: props.session.id,
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
