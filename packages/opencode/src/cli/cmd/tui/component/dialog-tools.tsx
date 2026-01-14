import { createMemo, createSignal, onMount } from "solid-js"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"

export function DialogTools() {
  const sdk = useSDK()
  const [tools, setTools] = createSignal<string[]>([])

  onMount(async () => {
    try {
      const response = await sdk.client.tool.ids()
      if (response.data) {
        setTools(response.data)
      }
    } catch {
      // Silently fail - tools list will just be empty
    }
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const toolList = tools()

    return pipe(
      toolList,
      sortBy((id) => id),
      map((id) => ({
        value: id,
        title: id,
        category: undefined,
      })),
    )
  })

  return (
    <DialogSelect
      title="Tools"
      options={options()}
      onSelect={() => {
        // Don't close on select, only on escape
      }}
    />
  )
}
